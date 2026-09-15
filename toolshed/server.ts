import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	CallToolRequestSchema,
	CancelledNotificationSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolveCaller } from "./auth.js";
import {
	beginAuditEvent,
	completeAuditEvent,
	type FinalAuditStatus,
} from "./audit.js";
import {
	AccessDeniedError,
	ToolNotFoundError,
	ToolshedDispatcher,
} from "./dispatcher.js";
import { checkHealth } from "./health.js";
import { handleToolCall } from "./handlers.js";
import { META_TOOLS } from "./meta-tools.js";
import type { ToolRegistry } from "./registry.js";
import type { Caller, ToolCallResult } from "./types.js";

export type CallerResolver = (
	authorizationHeader: string | undefined,
) => Promise<Caller | null>;

export interface ToolshedAppOptions {
	dispatcher: ToolshedDispatcher;
	registry: ToolRegistry;
	resolveCaller?: CallerResolver;
	lifecycle?: RequestLifecycle;
}

export class RequestLifecycle {
	private active = 0;
	private draining = false;
	private readonly abortController = new AbortController();
	private readonly idleWaiters = new Set<() => void>();

	begin(): (() => void) | null {
		if (this.draining) {
			return null;
		}
		this.active++;
		let ended = false;
		return () => {
			if (ended) return;
			ended = true;
			this.active--;
			if (this.active === 0) {
				for (const resolve of this.idleWaiters) resolve();
				this.idleWaiters.clear();
			}
		};
	}

	startDraining(): void {
		this.draining = true;
	}

	abortActive(): void {
		this.abortController.abort();
	}

	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	async waitForIdle(timeoutMs: number): Promise<boolean> {
		if (this.active === 0) return true;
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timeout);
				resolve(true);
			};
			const timeout = setTimeout(() => {
				this.idleWaiters.delete(done);
				resolve(false);
			}, timeoutMs);
			this.idleWaiters.add(done);
		});
	}
}

export function createApp(options: ToolshedAppOptions) {
	const { dispatcher, registry, resolveCaller: resolveCallerFn } = options;
	const auth = resolveCallerFn ?? resolveCaller;
	const lifecycle = options.lifecycle ?? new RequestLifecycle();
	const inFlight = new InFlightRequests();
	const app = new Hono();
	const allowedOrigins = configuredOrigins();

	if (allowedOrigins.size > 0) {
		app.use(
			"*",
			cors({
				origin: (origin) => (allowedOrigins.has(origin) ? origin : ""),
				allowMethods: ["POST", "OPTIONS"],
				allowHeaders: [
					"Content-Type",
					"Authorization",
					"mcp-protocol-version",
				],
			}),
		);
	}

	app.use("/mcp", async (c, next) => {
		const origin = c.req.header("Origin");
		if (origin && !allowedOrigins.has(origin)) {
			return c.json({ error: "Origin not allowed" }, 403);
		}
		const host = normalizeHost(c.req.header("Host"));
		if (host && !configuredHosts().has(host)) {
			return c.json({ error: "Host not allowed" }, 403);
		}
		await next();
	});

	app.get("/ready", async (c) => {
		const status = await checkHealth(registry);
		return c.json(
			status.ok
				? { status: "ok", toolCount: status.toolCount }
				: { status: "unavailable" },
			status.ok ? 200 : 503,
		);
	});

	app.get("/health", async (c) => {
		const caller = await safelyResolveCaller(auth, c.req.header("Authorization"));
		if (!caller || caller instanceof Response || caller.role !== "admin") {
			return caller instanceof Response ? caller : mcpUnauthorizedResponse();
		}
		const status = await checkHealth(registry, true);
		return c.json(status, status.ok ? 200 : 503);
	});

	app.get("/mcp", () => new Response(null, { status: 405 }));
	app.delete("/mcp", () => new Response(null, { status: 405 }));
	app.post("/mcp", async (c) => {
		const finishRequest = lifecycle.begin();
		if (!finishRequest) {
			return mcpServiceUnavailableResponse("Service is draining");
		}
		try {
			const caller = await safelyResolveCaller(
				auth,
				c.req.header("Authorization"),
			);
			if (caller instanceof Response) return caller;
			if (!caller) return mcpUnauthorizedResponse();

			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			});
			const server = buildMcpServer(
				dispatcher,
				caller,
				inFlight,
				lifecycle.signal,
			);
			try {
				await server.connect(transport);
				return await transport.handleRequest(c.req.raw);
			} finally {
				await server.close();
			}
		} finally {
			finishRequest();
		}
	});

	return app;
}

function buildMcpServer(
	dispatcher: ToolshedDispatcher,
	caller: Caller,
	inFlight: InFlightRequests,
	shutdownSignal: AbortSignal,
): Server {
	const server = new Server(
		{ name: "mcp-toolshed", version: "0.1.0" },
		{ capabilities: { tools: {} }, instructions: "Use search_tools, then get_tool_schema, then call the selected tool." },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: META_TOOLS.map(({ risk: _risk, tags: _tags, providerId: _providerId, upstreamName: _upstreamName, ...tool }) => tool),
	}));

	server.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
		if (notification.params.requestId !== undefined) {
			inFlight.cancel(caller.id, notification.params.requestId);
		}
	});

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const { name, arguments: args } = request.params;
		const started = Date.now();
		const toolArgs = (args ?? {}) as Record<string, unknown>;
		const controller = new AbortController();
		const signal = AbortSignal.any([
			extra.signal,
			shutdownSignal,
			controller.signal,
		]);
		const unregister = inFlight.register(caller.id, extra.requestId, controller);
		const writeOperation = dispatcher.toolRisk(name) === "write";
		let auditId: number | undefined;

		try {
			try {
				auditId = await beginAuditEvent({
					caller,
					toolName: name,
					arguments: toolArgs,
				});
			} catch {
				if (writeOperation) {
					return toolError("Audit storage unavailable; write was not executed");
				}
			}

			const result = await handleToolCall(
				dispatcher,
				caller,
				name,
				toolArgs,
				signal,
			);
			await finishAudit(auditId, {
				status: result.isError ? "error" : "success",
				errorMessage: result.isError ? firstText(result) : undefined,
				durationMs: Date.now() - started,
			});
			return result;
		} catch (error) {
			const denied = error instanceof AccessDeniedError;
			const notFound = error instanceof ToolNotFoundError;
			const uncertain =
				writeOperation &&
				error instanceof Error &&
				["AbortError", "ProviderTimeoutError", "ProviderUnavailableError"].includes(
					error.name,
				);
			await finishAudit(auditId, {
				status: denied ? "denied" : uncertain ? "unknown" : "error",
				errorMessage: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - started,
			});
			if (denied) return toolError(`Access denied: ${error.message}`);
			if (notFound) return toolError(error.message);
			return toolError(error instanceof Error ? error.message : "tool call failed");
		} finally {
			unregister();
		}
	});

	return server;
}

class InFlightRequests {
	private readonly requests = new Map<string, Set<AbortController>>();

	register(
		callerId: number,
		requestId: string | number,
		controller: AbortController,
	): () => void {
		const key = `${callerId}:${String(requestId)}`;
		const controllers = this.requests.get(key) ?? new Set<AbortController>();
		controllers.add(controller);
		this.requests.set(key, controllers);
		return () => {
			controllers.delete(controller);
			if (controllers.size === 0) this.requests.delete(key);
		};
	}

	cancel(callerId: number, requestId: string | number): void {
		const key = `${callerId}:${String(requestId)}`;
		for (const controller of this.requests.get(key) ?? []) controller.abort();
	}
}

async function safelyResolveCaller(
	resolver: CallerResolver,
	header: string | undefined,
): Promise<Caller | null | Response> {
	try {
		return await resolver(header);
	} catch (error) {
		console.error("caller resolution failed:", error);
		return mcpServiceUnavailableResponse("Authentication service unavailable");
	}
}

async function finishAudit(
	id: number | undefined,
	result: {
		status: FinalAuditStatus;
		errorMessage?: string;
		durationMs: number;
	},
): Promise<void> {
	if (id === undefined) return;
	await completeAuditEvent(id, result).catch((error) => {
		console.error("failed to finalize audit event:", error);
	});
}

function firstText(result: ToolCallResult): string | undefined {
	const part = result.content.find((entry) => entry.type === "text");
	return part?.type === "text" ? part.text : undefined;
}

function toolError(message: string): ToolCallResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

function mcpUnauthorizedResponse(): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: { code: -32001, message: "Unauthorized" },
			id: null,
		}),
		{ status: 401, headers: { "content-type": "application/json" } },
	);
}

function mcpServiceUnavailableResponse(message: string): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: { code: -32002, message },
			id: null,
		}),
		{ status: 503, headers: { "content-type": "application/json" } },
	);
}

function configuredOrigins(): Set<string> {
	return csv(process.env.TOOLSHED_ALLOWED_ORIGINS ?? "");
}

function configuredHosts(): Set<string> {
	const hosts = csv(process.env.TOOLSHED_ALLOWED_HOSTS ?? "");
	hosts.add("localhost");
	hosts.add("127.0.0.1");
	const renderHost = normalizeHost(process.env.RENDER_EXTERNAL_HOSTNAME);
	if (renderHost) hosts.add(renderHost);
	return hosts;
}

function csv(value: string): Set<string> {
	return new Set(value.split(",").map((part) => part.trim()).filter(Boolean));
}

function normalizeHost(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		return new URL(
			value.includes("://") ? value : `http://${value}`,
		).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolveCaller } from "./auth.js";
import { writeAuditEvent } from "./audit.js";
import { MCP_INSTRUCTIONS } from "./constants.js";
import {
	AccessDeniedError,
	ToolNotFoundError,
	ToolshedDispatcher,
} from "./dispatcher.js";
import { checkHealth } from "./health.js";
import { handleToolCall } from "./handlers.js";
import { META_TOOLS } from "./meta-tools.js";
import type { ToolRegistry } from "./registry.js";
import type { Caller } from "./types.js";

export type CallerResolver = (
	authorizationHeader: string | undefined,
) => Promise<Caller | null>;

export interface ToolshedAppOptions {
	dispatcher: ToolshedDispatcher;
	registry: ToolRegistry;
	resolveCaller?: CallerResolver;
}

function mcpUnauthorizedResponse(): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: { code: -32001, message: "Unauthorized" },
			id: null,
		}),
		{
			status: 401,
			headers: { "content-type": "application/json" },
		},
	);
}

function mcpServiceUnavailableResponse(): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: { code: -32002, message: "Authentication service unavailable" },
			id: null,
		}),
		{
			status: 503,
			headers: { "content-type": "application/json" },
		},
	);
}

export function createApp(options: ToolshedAppOptions) {
	const { dispatcher, registry, resolveCaller: resolveCallerFn } = options;
	const auth = resolveCallerFn ?? resolveCaller;
	const app = new Hono();
	const corsOrigin = process.env.TOOLSHED_CORS_ORIGIN?.trim();

	if (corsOrigin) {
		app.use(
			"*",
			cors({
				origin: corsOrigin,
				allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
				allowHeaders: [
					"Content-Type",
					"Authorization",
					"mcp-session-id",
					"Last-Event-ID",
					"mcp-protocol-version",
				],
				exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
			}),
		);
	}

	app.get("/health", async (c) => {
		const status = await checkHealth(registry);
		return c.json(status, status.ok ? 200 : 503);
	});

	app.get("/ready", async (c) => {
		const status = await checkHealth(registry);
		if (!status.ok) {
			return c.json(status, 503);
		}
		return c.json({ status: "ok", toolCount: status.toolCount });
	});

	app.all("/mcp", async (c) => {
		let caller: Caller | null;
		try {
			caller = await auth(c.req.header("Authorization"));
		} catch (error) {
			console.error("caller resolution failed:", error);
			return mcpServiceUnavailableResponse();
		}
		if (!caller) {
			return mcpUnauthorizedResponse();
		}

		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
		});
		const server = buildMcpServer(dispatcher, caller);
		try {
			await server.connect(transport);
			return await transport.handleRequest(c.req.raw);
		} finally {
			await server.close();
		}
	});

	return app;
}

function buildMcpServer(dispatcher: ToolshedDispatcher, caller: Caller): Server {
	const server = new Server(
		{ name: "mcp-toolshed", version: "0.1.0" },
		{
			capabilities: { tools: {} },
			instructions: MCP_INSTRUCTIONS,
		},
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: META_TOOLS.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		const started = Date.now();
		const toolArgs = (args ?? {}) as Record<string, unknown>;

		try {
			const result = await handleToolCall(dispatcher, caller, name, toolArgs);
			const providerError = Boolean(result.isError);
			await writeAuditEvent({
				caller,
				toolName: name,
				arguments: toolArgs,
				status: providerError ? "error" : "success",
				errorMessage: providerError ? result.content[0]?.text : undefined,
				durationMs: Date.now() - started,
			});
			return result;
		} catch (error) {
			const denied = error instanceof AccessDeniedError;
			const notFound = error instanceof ToolNotFoundError;
			await writeAuditEvent({
				caller,
				toolName: name,
				arguments: toolArgs,
				status: denied ? "denied" : "error",
				errorMessage: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - started,
			});
			if (denied) {
				return {
					content: [{ type: "text", text: `Access denied: ${error.message}` }],
					isError: true,
				};
			}
			if (notFound) {
				return {
					content: [{ type: "text", text: error.message }],
					isError: true,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: error instanceof Error ? error.message : "tool call failed",
					},
				],
				isError: true,
			};
		}
	});

	return server;
}

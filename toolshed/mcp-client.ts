import type { McpRemoteProviderConfig, ToolCallResult } from "./types.js";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 60_000;

interface JsonRpcResponse {
	id?: number;
	result?: unknown;
	error?: { code: number; message: string };
}

interface McpTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

export class McpRemoteClient {
	private sessionId?: string;
	private nextId = 1;
	private ready?: Promise<void>;
	private protocolVersion = DEFAULT_PROTOCOL_VERSION;

	constructor(
		private readonly url: string,
		private readonly headers: Record<string, string>,
	) {}

	static fromConfig(config: McpRemoteProviderConfig): McpRemoteClient {
		const headers: Record<string, string> = {};
		if (config.auth) {
			const token = process.env[config.auth.env]?.trim();
			if (!token) {
				throw new Error(
					`provider ${config.id}: missing env ${config.auth.env}`,
				);
			}
			const prefix = config.auth.prefix ?? "Bearer ";
			headers[config.auth.header] = `${prefix}${token}`;
		}
		return new McpRemoteClient(config.url, headers);
	}

	async listTools(signal?: AbortSignal): Promise<McpTool[]> {
		await this.initialize(signal);
		const tools: McpTool[] = [];
		let cursor: string | undefined;
		do {
			const result = await this.rpc(
				"tools/list",
				cursor ? { cursor } : {},
				DEFAULT_TIMEOUT_MS,
				signal,
			);
			const page = result as {
				tools?: McpTool[];
				nextCursor?: string;
			};
			tools.push(...(page.tools ?? []));
			cursor = page.nextCursor;
		} while (cursor);
		return tools;
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<ToolCallResult> {
		try {
			await this.initialize(signal);
			const result = await this.rpc("tools/call", {
				name,
				arguments: args,
			}, DEFAULT_TIMEOUT_MS, signal);
			return normalizeToolResult(result);
		} catch (error) {
			this.invalidateSession();
			throw error;
		}
	}

	private initialize(signal?: AbortSignal): Promise<void> {
		this.ready ??= this.handshake(signal).catch((error) => {
			this.ready = undefined;
			throw error;
		});
		return this.ready;
	}

	private async handshake(signal?: AbortSignal): Promise<void> {
		const result = await this.rpc("initialize", {
			protocolVersion: DEFAULT_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "mcp-toolshed", version: "0.1.0" },
		}, DEFAULT_TIMEOUT_MS, signal);
		if (
			result &&
			typeof result === "object" &&
			typeof (result as { protocolVersion?: unknown }).protocolVersion ===
				"string"
		) {
			this.protocolVersion = (
				result as { protocolVersion: string }
			).protocolVersion;
		}
		await this.send({
			jsonrpc: "2.0",
			method: "notifications/initialized",
		}, DEFAULT_TIMEOUT_MS, signal);
	}

	private async rpc(
		method: string,
		params: Record<string, unknown>,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal?: AbortSignal,
	): Promise<unknown> {
		const id = this.nextId++;
		const messages = await this.send(
			{ jsonrpc: "2.0", id, method, params },
			timeoutMs,
			signal,
		);
		if (!messages) {
			throw new Error(`${method} returned no body`);
		}
		const message = messages.find((candidate) => candidate.id === id);
		if (!message) {
			throw new Error(`no MCP response for request ${id}`);
		}
		if (message.error) {
			throw new Error(`${method} failed: ${message.error.message}`);
		}
		return message.result;
	}

	private async send(
		body: Record<string, unknown>,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal?: AbortSignal,
	): Promise<JsonRpcResponse[] | null> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": this.protocolVersion,
			...this.headers,
		};
		if (this.sessionId) {
			headers["mcp-session-id"] = this.sessionId;
		}

		const response = await fetch(this.url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
				: AbortSignal.timeout(timeoutMs),
		});

		const session = response.headers.get("mcp-session-id");
		if (session) {
			this.sessionId = session;
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			if (response.status === 404 && this.sessionId) {
				this.invalidateSession();
			}
			throw new Error(
				`MCP ${this.url} responded ${response.status}: ${detail.slice(0, 300)}`,
			);
		}
		if (response.status === 202) {
			return null;
		}

		const text = await response.text();
		if (!text.trim()) {
			return null;
		}
		return (response.headers.get("content-type") ?? "").includes(
			"text/event-stream",
		)
			? parseSse(text)
			: parseJsonRpcMessages(text);
	}

	private invalidateSession(): void {
		this.sessionId = undefined;
		this.ready = undefined;
		this.protocolVersion = DEFAULT_PROTOCOL_VERSION;
	}
}

function parseJsonRpcMessages(text: string): JsonRpcResponse[] {
	const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
	return Array.isArray(parsed) ? parsed : [parsed];
}

function parseSse(text: string): JsonRpcResponse[] {
	const messages: JsonRpcResponse[] = [];
	for (const event of text.split(/\r?\n\r?\n/)) {
		const payload = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n")
			.trim();
		if (payload) {
			messages.push(JSON.parse(payload) as JsonRpcResponse);
		}
	}
	return messages;
}

function normalizeToolResult(result: unknown): ToolCallResult {
	if (!result || typeof result !== "object") {
		return { content: [{ type: "text", text: String(result ?? "") }] };
	}
	const record = result as {
		content?: Array<{ type: string; text?: string }>;
		isError?: boolean;
	};
	if (Array.isArray(record.content)) {
		return {
			content: record.content.map((part) => ({
				type: "text",
				text: part.text ?? JSON.stringify(part),
			})),
			isError: record.isError,
		};
	}
	return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

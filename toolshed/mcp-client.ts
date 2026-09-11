import type { McpRemoteProviderConfig, ToolCallResult } from "./types.js";

const PROTOCOL_VERSION = "2025-06-18";
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

	async listTools(): Promise<McpTool[]> {
		await this.initialize();
		const tools: McpTool[] = [];
		let cursor: string | undefined;
		do {
			const result = await this.rpc(
				"tools/list",
				cursor ? { cursor } : {},
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
	): Promise<ToolCallResult> {
		await this.initialize();
		const result = await this.rpc("tools/call", {
			name,
			arguments: args,
		});
		return normalizeToolResult(result);
	}

	private initialize(): Promise<void> {
		this.ready ??= this.handshake();
		return this.ready;
	}

	private async handshake(): Promise<void> {
		await this.rpc("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "mcp-toolshed", version: "0.1.0" },
		});
		await this.send({
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
	}

	private async rpc(
		method: string,
		params: Record<string, unknown>,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<unknown> {
		const id = this.nextId++;
		const messages = await this.send(
			{ jsonrpc: "2.0", id, method, params },
			timeoutMs,
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
	): Promise<JsonRpcResponse[] | null> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": PROTOCOL_VERSION,
			...this.headers,
		};
		if (this.sessionId) {
			headers["mcp-session-id"] = this.sessionId;
		}

		const response = await fetch(this.url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});

		const session = response.headers.get("mcp-session-id");
		if (session) {
			this.sessionId = session;
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
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
			: [JSON.parse(text) as JsonRpcResponse];
	}
}

function parseSse(text: string): JsonRpcResponse[] {
	const messages: JsonRpcResponse[] = [];
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) {
			continue;
		}
		const payload = line.slice(6).trim();
		if (!payload) {
			continue;
		}
		messages.push(JSON.parse(payload) as JsonRpcResponse);
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

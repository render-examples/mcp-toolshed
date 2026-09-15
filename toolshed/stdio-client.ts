import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpStdioProviderConfig, ToolCallResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TOOL_PAGES = 100;
const MAX_TOOLS = 5_000;

const SAFE_PARENT_ENV = [
	"PATH",
	"HOME",
	"TMPDIR",
	"TMP",
	"TEMP",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
] as const;

export function childEnvironment(
	providerEnv: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of SAFE_PARENT_ENV) {
		const value = process.env[key];
		if (value) {
			env[key] = value;
		}
	}
	return { ...env, ...providerEnv };
}

export class McpStdioClient {
	constructor(private readonly config: McpStdioProviderConfig) {}

	private async connect(signal?: AbortSignal): Promise<Client> {
		const transport = new StdioClientTransport({
			command: this.config.command,
			args: this.config.args,
			env: childEnvironment(this.config.env),
		});
		const client = new Client(
			{ name: "mcp-toolshed", version: "0.1.0" },
			{ capabilities: {} },
		);
		try {
			await client.connect(transport, { signal });
		} catch (error) {
			await client.close().catch(() => undefined);
			throw error;
		}
		return client;
	}

	async listTools(signal?: AbortSignal): Promise<Tool[]> {
		const client = await this.connect(signal);
		try {
			const tools: Tool[] = [];
			const seenCursors = new Set<string>();
			let cursor: string | undefined;
			for (let page = 0; page < MAX_TOOL_PAGES; page++) {
				const result = await client.listTools(
					cursor ? { cursor } : undefined,
					requestOptions(signal, this.config.timeoutMs),
				);
				tools.push(...result.tools);
				if (tools.length > MAX_TOOLS) {
					throw new Error(`stdio tool catalog exceeds ${MAX_TOOLS} tools`);
				}
				if (!result.nextCursor) {
					return tools;
				}
				if (seenCursors.has(result.nextCursor)) {
					throw new Error(
						`stdio tool catalog repeated cursor ${result.nextCursor}`,
					);
				}
				seenCursors.add(result.nextCursor);
				cursor = result.nextCursor;
			}
			throw new Error(`stdio tool catalog exceeds ${MAX_TOOL_PAGES} pages`);
		} finally {
			await client.close().catch(() => undefined);
		}
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<ToolCallResult> {
		const client = await this.connect(signal);
		try {
			return (await client.callTool(
				{ name, arguments: args },
				undefined,
				requestOptions(signal, this.config.timeoutMs),
			)) as ToolCallResult;
		} finally {
			await client.close().catch(() => undefined);
		}
	}

	async close(): Promise<void> {
		// Each operation owns and closes its own client process.
	}
}

function requestOptions(signal: AbortSignal | undefined, timeoutMs?: number) {
	const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return { signal, timeout, maxTotalTimeout: timeout };
}

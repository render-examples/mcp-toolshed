import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpRemoteProviderConfig, ToolCallResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_TOOLS = 5_000;

export class McpRemoteClient {
	private readonly url: URL;

	constructor(
		url: string | URL,
		private readonly headers: Record<string, string>,
		private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
	) {
		this.url =
			typeof url === "string" ? validatedProviderUrl(url) : url;
	}

	static fromConfig(config: McpRemoteProviderConfig): McpRemoteClient {
		const url = validatedProviderUrl(config.url);
		const headers: Record<string, string> = {};
		if (config.auth) {
			const token = process.env[config.auth.env]?.trim();
			if (!token) {
				throw new Error(
					`provider ${config.id}: missing env ${config.auth.env}`,
				);
			}
			headers[config.auth.header] =
				`${config.auth.prefix ?? "Bearer "}${token}`;
		}
		return new McpRemoteClient(url, headers, config.timeoutMs);
	}

	async listTools(signal?: AbortSignal): Promise<Tool[]> {
		return this.withClient(async (client, requestSignal) => {
			const tools: Tool[] = [];
			const seenCursors = new Set<string>();
			let cursor: string | undefined;
			for (let pageNumber = 0; pageNumber < DEFAULT_MAX_PAGES; pageNumber++) {
				const page = await client.listTools(
					cursor ? { cursor } : undefined,
					this.requestOptions(requestSignal),
				);
				tools.push(...page.tools);
				if (tools.length > DEFAULT_MAX_TOOLS) {
					throw new Error(
						`upstream tool catalog exceeds ${DEFAULT_MAX_TOOLS} tools`,
					);
				}
				if (!page.nextCursor) {
					return tools;
				}
				if (seenCursors.has(page.nextCursor)) {
					throw new Error(
						`upstream tool catalog repeated cursor ${page.nextCursor}`,
					);
				}
				seenCursors.add(page.nextCursor);
				cursor = page.nextCursor;
			}
			throw new Error(
				`upstream tool catalog exceeds ${DEFAULT_MAX_PAGES} pages`,
			);
		}, signal);
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<ToolCallResult> {
		return this.withClient(
			async (client, requestSignal) =>
				(await client.callTool(
					{ name, arguments: args },
					undefined,
					this.requestOptions(requestSignal),
				)) as ToolCallResult,
			signal,
		);
	}

	private requestOptions(signal: AbortSignal) {
		return {
			signal,
			timeout: this.timeoutMs,
			maxTotalTimeout: this.timeoutMs,
		};
	}

	private async withClient<T>(
		operation: (client: Client, signal: AbortSignal) => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		const timeout = AbortSignal.timeout(this.timeoutMs);
		const requestSignal = signal
			? AbortSignal.any([signal, timeout])
			: timeout;
		const transport = new StreamableHTTPClientTransport(this.url, {
			requestInit: { headers: this.headers },
			reconnectionOptions: {
				maxReconnectionDelay: 1_000,
				initialReconnectionDelay: 100,
				reconnectionDelayGrowFactor: 1.5,
				maxRetries: 0,
			},
		});
		const client = new Client(
			{ name: "mcp-toolshed", version: "0.1.0" },
			{ capabilities: {} },
		);
		try {
			await client.connect(transport, this.requestOptions(requestSignal));
			return await operation(client, requestSignal);
		} finally {
			await client.close().catch(() => undefined);
		}
	}
}

function validatedProviderUrl(value: string): URL {
	const url = new URL(value);
	const local =
		url.hostname === "localhost" ||
		url.hostname === "127.0.0.1" ||
		url.hostname === "::1";
	if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
		throw new Error(
			`remote MCP URL must use HTTPS (HTTP is allowed only for localhost): ${url.origin}`,
		);
	}
	return url;
}

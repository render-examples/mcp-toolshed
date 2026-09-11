import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpStdioProviderConfig, ToolCallResult } from "./types.js";

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
	private client?: Client;

	constructor(private readonly config: McpStdioProviderConfig) {}

	private async connect(signal?: AbortSignal): Promise<Client> {
		if (this.client) {
			return this.client;
		}
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
		this.client = client;
		return client;
	}

	async listTools(signal?: AbortSignal): Promise<
		Array<{
			name: string;
			description?: string;
			inputSchema?: Record<string, unknown>;
		}>
	> {
		const client = await this.connect(signal);
		try {
			const { tools } = await client.listTools(undefined, { signal });
			return tools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema as Record<string, unknown>,
			}));
		} catch (error) {
			await this.close().catch(() => undefined);
			throw error;
		}
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<ToolCallResult> {
		const client = await this.connect(signal);
		const result = await client.callTool(
			{ name, arguments: args },
			undefined,
			{ signal },
		);
		const content = Array.isArray(result.content)
			? result.content.map((part) => {
					if (part.type === "text") {
						return { type: "text" as const, text: part.text };
					}
					return { type: "text" as const, text: JSON.stringify(part) };
				})
			: [{ type: "text" as const, text: JSON.stringify(result) }];
		return { content, isError: Boolean(result.isError) };
	}

	async close(): Promise<void> {
		await this.client?.close();
		this.client = undefined;
	}
}

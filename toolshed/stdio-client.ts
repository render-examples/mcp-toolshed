import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpStdioProviderConfig, ToolCallResult } from "./types.js";

export class McpStdioClient {
	private client?: Client;

	constructor(private readonly config: McpStdioProviderConfig) {}

	private async connect(): Promise<Client> {
		if (this.client) {
			return this.client;
		}
		const transport = new StdioClientTransport({
			command: this.config.command,
			args: this.config.args,
			env: { ...process.env, ...this.config.env } as Record<string, string>,
		});
		const client = new Client(
			{ name: "mcp-toolshed", version: "0.1.0" },
			{ capabilities: {} },
		);
		await client.connect(transport);
		this.client = client;
		return client;
	}

	async listTools(): Promise<
		Array<{
			name: string;
			description?: string;
			inputSchema?: Record<string, unknown>;
		}>
	> {
		const client = await this.connect();
		const { tools } = await client.listTools();
		return tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema as Record<string, unknown>,
		}));
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<ToolCallResult> {
		const client = await this.connect();
		const result = await client.callTool({ name, arguments: args });
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

import type {
	InlineProviderConfig,
	InlineToolDefinition,
	McpRemoteProviderConfig,
	McpStdioProviderConfig,
	ProviderConfig,
	ResolvedProvider,
	ToolDefinition,
} from "./types.js";
import { ProviderGate } from "./gate.js";
import { McpRemoteClient } from "./mcp-client.js";
import { inferToolRisk } from "./risk.js";
import { McpStdioClient } from "./stdio-client.js";

export function defineMcpRemoteProvider(
	config: Omit<McpRemoteProviderConfig, "type">,
): McpRemoteProviderConfig {
	return { ...config, type: "mcp-remote" };
}

export function defineMcpStdioProvider(
	config: Omit<McpStdioProviderConfig, "type">,
): McpStdioProviderConfig {
	return { ...config, type: "mcp-stdio" };
}

type InlineToolInput = Omit<InlineToolDefinition, "providerId">;

export function defineInlineProvider(
	config: Omit<InlineProviderConfig, "type" | "tools"> & {
		tools: InlineToolInput[];
	},
): InlineProviderConfig {
	return {
		...config,
		type: "inline",
		tools: config.tools.map((tool) => ({
			...tool,
			providerId: config.id,
		})),
	};
}

export function tool(definition: InlineToolInput): InlineToolInput {
	return definition;
}

function prefixName(prefix: string, name: string): string {
	return name.startsWith(`${prefix}.`) ? name : `${prefix}.${name}`;
}

function mapUpstreamTools(
	config: Pick<ProviderConfig, "id" | "toolPrefix" | "risk" | "tags">,
	upstream: Array<{
		name: string;
		description?: string;
		inputSchema?: Record<string, unknown>;
	}>,
): ToolDefinition[] {
	return upstream.map((t) => ({
		name: prefixName(config.toolPrefix, t.name),
		description: t.description ?? "",
		inputSchema: t.inputSchema ?? { type: "object", properties: {} },
		risk: inferToolRisk(t.name, config.risk),
		tags: [...config.tags],
		providerId: config.id,
		upstreamName: t.name,
	}));
}

export async function resolveProvider(
	config: ProviderConfig,
): Promise<ResolvedProvider | null> {
	if (config.enabled && !config.enabled()) {
		console.log(`provider ${config.id}: disabled (missing config)`);
		return null;
	}

	const gate = new ProviderGate();

	if (config.type === "inline") {
		return {
			config,
			tools: config.tools,
			callTool: (tool, args, ctx) =>
				gate.run(async () => {
					const inline = config.tools.find((t) => t.name === tool.name);
					if (!inline) {
						throw new Error(`inline tool not found: ${tool.name}`);
					}
					return inline.handler(args, ctx);
				}),
		};
	}

	if (config.type === "mcp-remote") {
		const client = McpRemoteClient.fromConfig(config);
		const upstream = await client.listTools();
		return {
			config,
			tools: mapUpstreamTools(config, upstream),
			callTool: (tool, args) =>
				gate.run(async () => {
					const upstreamName = tool.upstreamName ?? tool.name;
					return client.callTool(upstreamName, args);
				}),
		};
	}

	const client = new McpStdioClient(config);
	const upstream = await client.listTools();
	return {
		config,
		tools: mapUpstreamTools(config, upstream),
		callTool: (tool, args) =>
			gate.run(async () => {
				const upstreamName = tool.upstreamName ?? tool.name;
				return client.callTool(upstreamName, args);
			}),
		shutdown: () => client.close(),
	};
}

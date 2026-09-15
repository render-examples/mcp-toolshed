import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
	InlineProviderConfig,
	InlineToolDefinition,
	McpRemoteProviderConfig,
	McpStdioProviderConfig,
	ProviderConfig,
	ProviderStatus,
	ResolvedProvider,
	ToolDefinition,
} from "./types.js";
import {
	ProviderBusyError,
	ProviderGate,
	ProviderUnavailableError,
} from "./gate.js";
import { McpRemoteClient } from "./mcp-client.js";
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

export function mapUpstreamTools(
	config: McpRemoteProviderConfig | McpStdioProviderConfig,
	upstream: Tool[],
): ToolDefinition[] {
	const allowed: ToolDefinition[] = [];
	for (const upstreamTool of upstream) {
		const policy = config.toolPolicy[upstreamTool.name];
		if (!policy) {
			console.warn(
				`provider ${config.id}: ignoring unapproved upstream tool ${upstreamTool.name}`,
			);
			continue;
		}
		allowed.push({
			...upstreamTool,
			name: prefixName(config.toolPrefix, upstreamTool.name),
			description: upstreamTool.description ?? "",
			inputSchema: requireArguments(
				upstreamTool.inputSchema,
				policy.requiredArguments,
			),
			risk: policy.risk,
			tags: [...policy.tags],
			providerId: config.id,
			upstreamName: upstreamTool.name,
		});
	}
	return allowed;
}

function requireArguments(
	inputSchema: Tool["inputSchema"],
	requiredArguments: string[] | undefined,
): Tool["inputSchema"] {
	if (!requiredArguments?.length) {
		return inputSchema;
	}
	const existing = Array.isArray(inputSchema.required)
		? inputSchema.required.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
	return {
		...inputSchema,
		required: [...new Set([...existing, ...requiredArguments])],
	};
}

export async function resolveProvider(
	config: ProviderConfig,
	signal?: AbortSignal,
): Promise<ResolvedProvider | null> {
	if (config.enabled && !config.enabled()) {
		console.log(`provider ${config.id}: disabled (missing config)`);
		return null;
	}

	const gate = new ProviderGate();
	let healthy = true;
	let error: string | undefined;
	let toolCount = 0;

	const status = (): ProviderStatus => ({
		id: config.id,
		configured: true,
		healthy,
		toolCount,
		...(error ? { error } : {}),
	});
	const run = async <T>(
		fn: (signal: AbortSignal) => Promise<T>,
		externalSignal?: AbortSignal,
	): Promise<T> => {
		try {
			const result = await gate.run(fn, config.timeoutMs, externalSignal);
			healthy = true;
			error = undefined;
			return result;
		} catch (cause) {
			if (
				!(cause instanceof ProviderBusyError) &&
				!(cause instanceof ProviderUnavailableError) &&
				!(cause instanceof DOMException && cause.name === "AbortError")
			) {
				healthy = false;
				error = cause instanceof Error ? cause.message : String(cause);
			}
			throw cause;
		}
	};

	if (config.type === "inline") {
		await config.initialize?.(signal);
		toolCount = config.tools.length;
		return {
			config,
			tools: config.tools,
			callTool: (tool, args, ctx) =>
				run(async (signal) => {
					const inline = config.tools.find((t) => t.name === tool.name);
					if (!inline) {
						throw new Error(`inline tool not found: ${tool.name}`);
					}
					return inline.handler(args, { ...ctx, signal });
				}, ctx.signal),
			status,
			...(config.initialize
				? {
						probe: (probeSignal?: AbortSignal) =>
							run((gateSignal) =>
								config.initialize!(combineSignals(gateSignal, probeSignal)),
							),
					}
				: {}),
		};
	}

	if (config.type === "mcp-remote") {
		const client = McpRemoteClient.fromConfig(config);
		const upstream = await client.listTools(signal);
		const tools = mapUpstreamTools(config, upstream);
		toolCount = tools.length;
		return {
			config,
			tools,
			callTool: (tool, args, ctx) =>
				run(async (signal) => {
					const upstreamName = tool.upstreamName ?? tool.name;
					return client.callTool(upstreamName, args, signal);
				}, ctx.signal),
			status,
			probe: (probeSignal) =>
				run(async (gateSignal) => {
					await client.listTools(combineSignals(gateSignal, probeSignal));
				}),
		};
	}

	const client = new McpStdioClient(config);
	const upstream = await client.listTools(signal);
	const tools = mapUpstreamTools(config, upstream);
	toolCount = tools.length;
	return {
		config,
		tools,
		callTool: (tool, args, ctx) =>
			run(async (signal) => {
				const upstreamName = tool.upstreamName ?? tool.name;
				return client.callTool(upstreamName, args, signal);
			}, ctx.signal),
		status,
		probe: (probeSignal) =>
			run(async (gateSignal) => {
				await client.listTools(combineSignals(gateSignal, probeSignal));
			}),
		shutdown: () => client.close(),
	};
}

function combineSignals(
	first: AbortSignal,
	second?: AbortSignal,
): AbortSignal {
	return second ? AbortSignal.any([first, second]) : first;
}

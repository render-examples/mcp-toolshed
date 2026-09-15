import type {
	CallToolResult,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";

export type Risk = "read" | "write";

export type RoleName = "analyst" | "implementer" | "admin";

export interface Caller {
	id: number;
	role: RoleName;
	label?: string;
}

export type ToolDefinition = Omit<Tool, "description" | "inputSchema"> & {
	description: string;
	inputSchema: Record<string, unknown>;
	risk: Risk;
	tags: string[];
	providerId: string;
	/** Original tool name on the upstream MCP server (unprefixed). */
	upstreamName?: string;
};

export type ToolCallResult = CallToolResult;

export interface ToolPolicy {
	risk: Risk;
	tags: string[];
	/** Arguments that must be present even when the upstream schema marks them optional. */
	requiredArguments?: string[];
}

export type ToolPolicyManifest = Record<string, ToolPolicy>;

export interface ToolHandlerContext {
	caller: Caller;
	signal?: AbortSignal;
}

export interface InlineToolDefinition extends ToolDefinition {
	handler: (
		args: Record<string, unknown>,
		ctx: ToolHandlerContext,
	) => Promise<ToolCallResult>;
}

export interface BaseProviderConfig {
	id: string;
	toolPrefix: string;
	risk: Risk;
	tags: string[];
	/** Maximum time a provider tool call may run before it is cancelled. */
	timeoutMs?: number;
	/** Return false to skip loading this provider (e.g. missing env). */
	enabled?: () => boolean;
}

export interface McpRemoteProviderConfig extends BaseProviderConfig {
	type: "mcp-remote";
	url: string;
	/** Exact upstream tool allowlist. Unlisted tools are not registered. */
	toolPolicy: ToolPolicyManifest;
	auth?: {
		header: string;
		env: string;
		prefix?: string;
	};
}

export interface McpStdioProviderConfig extends BaseProviderConfig {
	type: "mcp-stdio";
	command: string;
	args: string[];
	env: Record<string, string>;
	/** Exact upstream tool allowlist. Unlisted tools are not registered. */
	toolPolicy: ToolPolicyManifest;
}

export interface InlineProviderConfig extends BaseProviderConfig {
	type: "inline";
	tools: InlineToolDefinition[];
	initialize?: (signal?: AbortSignal) => Promise<void>;
}

export type ProviderConfig =
	| McpRemoteProviderConfig
	| McpStdioProviderConfig
	| InlineProviderConfig;

export interface ResolvedProvider {
	config: ProviderConfig;
	tools: ToolDefinition[];
	callTool: (
		tool: ToolDefinition,
		args: Record<string, unknown>,
		ctx: ToolHandlerContext,
	) => Promise<ToolCallResult>;
	status: () => ProviderStatus;
	probe?: (signal?: AbortSignal) => Promise<void>;
	shutdown?: () => Promise<void>;
}

export interface ProviderStatus {
	id: string;
	configured: boolean;
	healthy: boolean;
	toolCount: number;
	error?: string;
}

export const ROLE_NAMES: readonly RoleName[] = [
	"analyst",
	"implementer",
	"admin",
];

export interface SearchResult {
	name: string;
	description: string;
	risk: Risk;
	tags: string[];
}

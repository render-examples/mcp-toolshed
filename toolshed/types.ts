export type Risk = "read" | "write";

export type RoleName = "analyst" | "implementer" | "deploy-manager" | "admin";

export interface Caller {
	role: RoleName;
	label?: string;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	risk: Risk;
	tags: string[];
	providerId: string;
	/** Original tool name on the upstream MCP server (unprefixed). */
	upstreamName?: string;
}

export interface ToolCallResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

export interface ToolHandlerContext {
	caller: Caller;
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
	/** Return false to skip loading this provider (e.g. missing env). */
	enabled?: () => boolean;
}

export interface McpRemoteProviderConfig extends BaseProviderConfig {
	type: "mcp-remote";
	url: string;
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
}

export interface InlineProviderConfig extends BaseProviderConfig {
	type: "inline";
	tools: InlineToolDefinition[];
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
	shutdown?: () => Promise<void>;
}

export const ROLE_NAMES: readonly RoleName[] = [
	"analyst",
	"implementer",
	"deploy-manager",
	"admin",
];

export interface SearchResult {
	name: string;
	description: string;
	risk: Risk;
	tags: string[];
}

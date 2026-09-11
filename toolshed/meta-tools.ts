import type { ToolDefinition } from "./types.js";

export const META_TOOL_NAMES = ["search_tools", "get_tool_schema"] as const;

export const META_TOOLS: ToolDefinition[] = [
	{
		name: "search_tools",
		description:
			"Search the toolshed catalog by natural-language query. Returns tool names, descriptions, risk level, and tags. RBAC filters results to tools you may discover.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "What you want to do, e.g. 'list render services'",
				},
				limit: {
					type: "number",
					description: "Max results (default 10)",
				},
			},
			required: ["query"],
		},
		risk: "read",
		tags: ["meta"],
		providerId: "toolshed",
	},
	{
		name: "get_tool_schema",
		description:
			"Fetch the full input JSON Schema for a tool discovered via search_tools.",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Fully qualified tool name, e.g. render.list_services",
				},
			},
			required: ["name"],
		},
		risk: "read",
		tags: ["meta"],
		providerId: "toolshed",
	},
];

export function isMetaTool(name: string): boolean {
	return (META_TOOL_NAMES as readonly string[]).includes(name);
}

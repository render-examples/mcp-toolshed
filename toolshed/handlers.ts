import type { ToolshedDispatcher } from "./dispatcher.js";
import { MAX_SEARCH_LIMIT } from "./constants.js";
import { isMetaTool } from "./meta-tools.js";
import type { Caller, ToolCallResult } from "./types.js";

export type McpToolResponse = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

export async function handleToolCall(
	dispatcher: ToolshedDispatcher,
	caller: Caller,
	name: string,
	args: Record<string, unknown>,
): Promise<McpToolResponse> {
	if (name === "search_tools") {
		const query = String(args.query ?? "").trim();
		if (!query) {
			return toolError("query is required and must be non-empty");
		}
		const limit = clampSearchLimit(args.limit);
		const results = dispatcher.searchTools(query, caller, limit);
		return jsonResult({ results });
	}

	if (name === "get_tool_schema") {
		const toolName = String(args.name ?? "").trim();
		if (!toolName) {
			return toolError("name is required");
		}
		const tool = dispatcher.getToolSchema(toolName, caller);
		return jsonResult({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			risk: tool.risk,
			tags: tool.tags,
		});
	}

	if (isMetaTool(name)) {
		return toolError(`unknown meta tool: ${name}`);
	}

	const result = await dispatcher.callTool(name, args, caller);
	return passthroughResult(result);
}

function clampSearchLimit(limit: unknown): number {
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
		return 10;
	}
	return Math.min(Math.floor(limit), MAX_SEARCH_LIMIT);
}

function jsonResult(payload: unknown): McpToolResponse {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
	};
}

function passthroughResult(result: ToolCallResult): McpToolResponse {
	return {
		content: result.content,
		isError: result.isError,
	};
}

function toolError(message: string): McpToolResponse {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
	};
}

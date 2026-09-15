import type { ToolshedDispatcher } from "./dispatcher.js";
import { MAX_SEARCH_LIMIT } from "./constants.js";
import { isMetaTool, META_TOOLS } from "./meta-tools.js";
import type { Caller, ToolCallResult } from "./types.js";
import { validateToolArguments } from "./validate.js";

export type McpToolResponse = {
	content: ToolCallResult["content"];
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
};

export async function handleToolCall(
	dispatcher: ToolshedDispatcher,
	caller: Caller,
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<McpToolResponse> {
	const metaTool = META_TOOLS.find((tool) => tool.name === name);
	if (metaTool) {
		validateToolArguments(metaTool, args);
	}

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
		const tool =
			META_TOOLS.find((candidate) => candidate.name === toolName) ??
			dispatcher.getToolSchema(toolName, caller);
		const {
			providerId: _providerId,
			upstreamName: _upstreamName,
			risk,
			tags,
			...mcpTool
		} = tool;
		return jsonResult({
			...mcpTool,
			risk,
			tags,
		});
	}

	if (isMetaTool(name)) {
		return toolError(`unknown meta tool: ${name}`);
	}

	const result = await dispatcher.callTool(name, args, caller, signal);
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
	return result;
}

function toolError(message: string): McpToolResponse {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
	};
}

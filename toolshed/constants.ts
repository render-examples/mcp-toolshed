export const MAX_SEARCH_LIMIT = 50;
export const MCP_INSTRUCTIONS = `This toolshed exposes provider tools via progressive discovery.
1. Call search_tools with a natural-language query to find tools (RBAC-filtered).
2. Call get_tool_schema with a tool name for its input schema.
3. Call tools/call with that tool name and arguments.
Provider tools are intentionally omitted from tools/list to save context.`;

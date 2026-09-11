import { describe, expect, it } from "vitest";
import { ToolshedDispatcher } from "../toolshed/dispatcher.js";
import { handleToolCall } from "../toolshed/handlers.js";
import { ToolRegistry } from "../toolshed/registry.js";
import type { ResolvedProvider, ToolDefinition } from "../toolshed/types.js";

function mockRegistry(tools: ToolDefinition[]): ToolRegistry {
	const registry = Object.create(ToolRegistry.prototype) as ToolRegistry;
	const providers = new Map<string, ResolvedProvider>();

	for (const tool of tools) {
		if (!providers.has(tool.providerId)) {
			providers.set(tool.providerId, {
				config: {
					id: tool.providerId,
					type: "inline",
					toolPrefix: tool.providerId,
					risk: "read",
					tags: [],
					tools: [],
				},
				tools: [],
				callTool: async () => ({
					content: [{ type: "text", text: "upstream-ok" }],
				}),
				status: () => ({
					id: tool.providerId,
					configured: true,
					healthy: true,
					toolCount: 1,
				}),
			});
		}
	}

	Object.assign(registry, {
		allTools: () => tools,
		getTool: (name: string) => tools.find((t) => t.name === name),
		getProvider: (id: string) => providers.get(id),
		toolCount: () => tools.length,
	});

	return registry;
}

const tools: ToolDefinition[] = [
	{
		name: "render.list_services",
		description: "List Render services",
		inputSchema: { type: "object" },
		risk: "read",
		tags: ["deploy"],
		providerId: "render",
	},
];

describe("handleToolCall", () => {
	const dispatcher = new ToolshedDispatcher(mockRegistry(tools));

	it("rejects empty search query", async () => {
		await expect(
			handleToolCall(dispatcher, { role: "admin" }, "search_tools", {
				query: "",
			}),
		).rejects.toThrow("invalid arguments");
	});

	it("rejects string search limits instead of silently coercing them", async () => {
		await expect(
			handleToolCall(dispatcher, { role: "admin" }, "search_tools", {
				query: "render",
				limit: "30",
			}),
		).rejects.toThrow("invalid arguments");
	});

	it("passes through provider content without double-encoding", async () => {
		const result = await handleToolCall(
			dispatcher,
			{ role: "admin" },
			"render.list_services",
			{},
		);
		expect(result.content[0]?.text).toBe("upstream-ok");
		expect(result.isError).toBeUndefined();
	});

	it("returns schemas for advertised meta-tools", async () => {
		const result = await handleToolCall(
			dispatcher,
			{ role: "admin" },
			"get_tool_schema",
			{ name: "search_tools" },
		);
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content[0]!.text)).toMatchObject({
			name: "search_tools",
			risk: "read",
		});
	});
});

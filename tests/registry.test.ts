import { describe, expect, it } from "vitest";
import { defineInlineProvider } from "../toolshed/provider.js";
import { ToolRegistry } from "../toolshed/registry.js";

describe("ToolRegistry", () => {
	it("throws on tool name collision", async () => {
		const a = defineInlineProvider({
			id: "a",
			toolPrefix: "dup",
			risk: "read",
			tags: [],
			tools: [
				{
					name: "dup.tool",
					description: "one",
					inputSchema: {},
					risk: "read",
					tags: [],
					handler: async () => ({ content: [{ type: "text", text: "a" }] }),
				},
			],
		});
		const b = defineInlineProvider({
			id: "b",
			toolPrefix: "dup",
			risk: "read",
			tags: [],
			tools: [
				{
					name: "dup.tool",
					description: "two",
					inputSchema: {},
					risk: "read",
					tags: [],
					handler: async () => ({ content: [{ type: "text", text: "b" }] }),
				},
			],
		});
		await expect(ToolRegistry.create([a, b])).rejects.toThrow(
			/tool name collision/,
		);
	});
});

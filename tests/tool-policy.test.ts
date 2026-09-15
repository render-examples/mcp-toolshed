import { describe, expect, it, vi } from "vitest";
import { mapUpstreamTools } from "../toolshed/provider.js";
import type { McpRemoteProviderConfig } from "../toolshed/types.js";

const config: McpRemoteProviderConfig = {
	type: "mcp-remote",
	id: "example",
	url: "https://example.com/mcp",
	toolPrefix: "example",
	risk: "write",
	tags: [],
	toolPolicy: {
		list_items: {
			risk: "read",
			tags: ["approved"],
			requiredArguments: ["workspaceId"],
		},
	},
};

describe("explicit tool policy", () => {
	it("registers only approved tools with reviewed metadata", () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const mapped = mapUpstreamTools(config, [
			{
				name: "list_items",
				description: "List items",
				inputSchema: { type: "object", properties: {} },
				outputSchema: { type: "object", properties: {} },
				annotations: { readOnlyHint: true },
			},
			{
				name: "delete_everything",
				description: "Not reviewed",
				inputSchema: { type: "object", properties: {} },
			},
		]);

		expect(mapped).toHaveLength(1);
		expect(mapped[0]).toMatchObject({
			name: "example.list_items",
			risk: "read",
			tags: ["approved"],
			outputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
		});
		expect(mapped[0]?.inputSchema.required).toEqual(["workspaceId"]);
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("delete_everything"),
		);
		warning.mockRestore();
	});
});

import { describe, expect, it } from "vitest";
import { rankByQuery } from "../toolshed/search.js";
import type { ToolDefinition } from "../toolshed/types.js";

const tools: ToolDefinition[] = [
	{
		name: "render.list_services",
		description: "List web services in a Render workspace",
		inputSchema: {},
		risk: "read",
		tags: ["deploy"],
		providerId: "render",
	},
	{
		name: "github.create_pull_request",
		description: "Create a pull request on GitHub",
		inputSchema: {},
		risk: "write",
		tags: ["code"],
		providerId: "github",
	},
];

describe("search", () => {
	it("ranks render tools for deploy queries", () => {
		const results = rankByQuery(tools, "list render services");
		expect(results[0]?.name).toBe("render.list_services");
	});

	it("ranks github tools for pr queries", () => {
		const results = rankByQuery(tools, "create pull request");
		expect(results[0]?.name).toBe("github.create_pull_request");
	});

	it("returns empty when no terms match", () => {
		const results = rankByQuery(tools, "zzzz");
		expect(results).toHaveLength(0);
	});
});

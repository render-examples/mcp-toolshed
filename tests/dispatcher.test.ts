import { describe, expect, it } from "vitest";
import {
	AccessDeniedError,
	ToolshedDispatcher,
} from "../toolshed/dispatcher.js";
import { ToolRegistry } from "../toolshed/registry.js";
import type { ResolvedProvider, ToolDefinition } from "../toolshed/types.js";
import { InvalidToolArgumentsError } from "../toolshed/validate.js";

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
					content: [{ type: "text", text: "ok" }],
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
	});

	return registry;
}

const sampleTools: ToolDefinition[] = [
	{
		name: "render.list_services",
		description: "List services",
		inputSchema: { type: "object" },
		risk: "read",
		tags: ["deploy"],
		providerId: "render",
	},
	{
		name: "github.create_pull_request",
		description: "Open PR",
		inputSchema: {
			type: "object",
			properties: { title: { type: "string", minLength: 1 } },
			required: ["title"],
		},
		risk: "write",
		tags: ["code"],
		providerId: "github",
	},
];

describe("dispatcher", () => {
	it("filters search results by RBAC", () => {
		const dispatcher = new ToolshedDispatcher(mockRegistry(sampleTools));
		const results = dispatcher.searchTools("list services", {
			id: 1,
			role: "analyst",
		});
		expect(results.map((r) => r.name)).toEqual(["render.list_services"]);
	});

	it("denies schema access for out-of-scope tools", () => {
		const dispatcher = new ToolshedDispatcher(mockRegistry(sampleTools));
		expect(() =>
			dispatcher.getToolSchema("github.create_pull_request", {
				id: 1,
				role: "analyst",
			}),
		).toThrow(AccessDeniedError);
	});

	it("validates arguments before invoking a provider", async () => {
		const dispatcher = new ToolshedDispatcher(mockRegistry(sampleTools));
		await expect(
			dispatcher.callTool(
				"github.create_pull_request",
				{},
				{ id: 1, role: "implementer" },
			),
		).rejects.toBeInstanceOf(InvalidToolArgumentsError);
	});
});

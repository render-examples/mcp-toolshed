import { afterEach, describe, expect, it, vi } from "vitest";
import { defineInlineProvider } from "../toolshed/provider.js";
import { ToolRegistry } from "../toolshed/registry.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ToolRegistry", () => {
	it("rejects duplicate provider IDs before initialization", async () => {
		const provider = (name: string) =>
			defineInlineProvider({
				id: "duplicate",
				toolPrefix: name,
				risk: "read",
				tags: [],
				tools: [],
			});
		await expect(
			ToolRegistry.create([provider("first"), provider("second")]),
		).rejects.toThrow("duplicate provider id");
	});

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

	it("reports disabled providers without treating them as unhealthy", async () => {
		const disabled = defineInlineProvider({
			id: "disabled",
			toolPrefix: "disabled",
			risk: "read",
			tags: [],
			enabled: () => false,
			tools: [],
		});
		const registry = await ToolRegistry.create([disabled]);
		expect(registry.providerStatuses()).toEqual([
			{
				id: "disabled",
				configured: false,
				healthy: true,
				toolCount: 0,
			},
		]);
	});

	it("records startup failures and re-probes them", async () => {
		let available = false;
		const remote = defineInlineProvider({
			id: "remote",
			toolPrefix: "remote",
			risk: "read",
			tags: [],
			initialize: async () => {
				if (!available) throw new Error("unavailable");
			},
			tools: [
				{
					name: "remote.list_items",
					description: "List items",
					inputSchema: { type: "object" },
					risk: "read",
					tags: [],
					handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
				},
			],
		});
		const registry = await ToolRegistry.create([remote]);
		expect(registry.providerStatuses()).toEqual([
			expect.objectContaining({
				id: "remote",
				configured: true,
				healthy: false,
				toolCount: 0,
			}),
		]);

		available = true;
		await registry.refreshFailedProviders(0);
		expect(registry.getTool("remote.list_items")).toBeDefined();
		expect(registry.providerStatuses()[0]?.healthy).toBe(true);
	});

	it("marks failed calls unhealthy and recovers after a success", async () => {
		let shouldFail = true;
		const provider = defineInlineProvider({
			id: "stateful",
			toolPrefix: "stateful",
			risk: "read",
			tags: [],
			tools: [
				{
					name: "stateful.read",
					description: "Read state",
					inputSchema: { type: "object" },
					risk: "read",
					tags: [],
					handler: async () => {
						if (shouldFail) {
							throw new Error("provider unavailable");
						}
						return { content: [{ type: "text", text: "ok" }] };
					},
				},
			],
		});
		const registry = await ToolRegistry.create([provider]);
		const resolved = registry.getProvider("stateful")!;
		const definition = registry.getTool("stateful.read")!;
		await expect(
			resolved.callTool(definition, {}, { caller: { id: 1, role: "admin" } }),
		).rejects.toThrow("provider unavailable");
		expect(registry.providerStatuses()[0]?.healthy).toBe(false);

		shouldFail = false;
		await resolved.callTool(definition, {}, { caller: { id: 1, role: "admin" } });
		expect(registry.providerStatuses()[0]?.healthy).toBe(true);
	});

	it("does not activate a provider that recovers during shutdown", async () => {
		let attempts = 0;
		const provider = defineInlineProvider({
			id: "late",
			toolPrefix: "late",
			risk: "read",
			tags: [],
			initialize: async (signal) => {
				attempts++;
				if (attempts === 1) {
					throw new Error("not ready");
				}
				await new Promise<void>((_resolve, reject) => {
					signal?.addEventListener(
						"abort",
						() => reject(new DOMException("aborted", "AbortError")),
						{ once: true },
					);
				});
			},
			tools: [],
		});
		const registry = await ToolRegistry.create([provider]);
		const refresh = registry.refreshFailedProviders(0);
		await Promise.resolve();
		await registry.shutdown();
		await refresh;
		expect(registry.getProvider("late")).toBeUndefined();
	});
});

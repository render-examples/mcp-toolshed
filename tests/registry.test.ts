import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defineInlineProvider,
	defineMcpRemoteProvider,
} from "../toolshed/provider.js";
import { ToolRegistry } from "../toolshed/registry.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

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
		let recoveryRequest = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				if (!available) {
					return new Response("unavailable", { status: 503 });
				}
				recoveryRequest++;
				if (recoveryRequest === 1) {
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							id: 1,
							result: { protocolVersion: "2025-06-18" },
						}),
						{ headers: { "content-type": "application/json" } },
					);
				}
				if (recoveryRequest === 2) {
					return new Response(null, { status: 202 });
				}
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 2,
						result: { tools: [{ name: "list_items" }] },
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}),
		);
		const remote = defineMcpRemoteProvider({
			id: "remote",
			url: "https://example.com/mcp",
			toolPrefix: "remote",
			risk: "write",
			tags: [],
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
			resolved.callTool(definition, {}, { caller: { role: "admin" } }),
		).rejects.toThrow("provider unavailable");
		expect(registry.providerStatuses()[0]?.healthy).toBe(false);

		shouldFail = false;
		await resolved.callTool(definition, {}, { caller: { role: "admin" } });
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

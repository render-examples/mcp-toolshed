import { describe, expect, it } from "vitest";
import { ToolshedDispatcher } from "../toolshed/dispatcher.js";
import { createApp } from "../toolshed/server.js";
import { ToolRegistry } from "../toolshed/registry.js";

function emptyRegistry(): ToolRegistry {
	const registry = Object.create(ToolRegistry.prototype) as ToolRegistry;
	Object.assign(registry, {
		allTools: () => [],
		getTool: () => undefined,
		getProvider: () => undefined,
		toolCount: () => 0,
		shutdown: async () => undefined,
	});
	return registry;
}

describe("createApp", () => {
	it("returns MCP-shaped JSON-RPC error when unauthorized", async () => {
		const app = createApp({
			dispatcher: new ToolshedDispatcher(emptyRegistry()),
			registry: emptyRegistry(),
			resolveCaller: async () => null,
		});
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.jsonrpc).toBe("2.0");
		expect(body.error?.code).toBe(-32001);
	});
});

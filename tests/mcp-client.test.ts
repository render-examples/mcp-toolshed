import { afterEach, describe, expect, it, vi } from "vitest";
import { McpRemoteClient } from "../toolshed/mcp-client.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("McpRemoteClient", () => {
	it("uses the negotiated protocol version and parses multiline SSE data", async () => {
		const requests: RequestInit[] = [];
		const responses = [
			new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: { protocolVersion: "2025-03-26" },
				}),
				{ headers: { "content-type": "application/json" } },
			),
			new Response(null, { status: 202 }),
			new Response(
				[
					"event: message",
					'data: {"jsonrpc":"2.0",',
					'data: "id":2,"result":{"tools":[{"name":"list_things"}]}}',
					"",
					"",
				].join("\n"),
				{ headers: { "content-type": "text/event-stream" } },
			),
		];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
				requests.push(init ?? {});
				return responses.shift()!;
			}),
		);

		const client = new McpRemoteClient("https://example.com/mcp", {});
		const tools = await client.listTools();

		expect(tools).toEqual([{ name: "list_things" }]);
		expect(
			(requests[2]?.headers as Record<string, string>)[
				"mcp-protocol-version"
			],
		).toBe("2025-03-26");
	});

	it("cancels an in-flight initialization handshake", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_url: string | URL | Request, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener(
							"abort",
							() => reject(new DOMException("aborted", "AbortError")),
							{ once: true },
						);
					}),
			),
		);
		const controller = new AbortController();
		const client = new McpRemoteClient("https://example.com/mcp", {});
		const pending = client.listTools(controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});

	it("accepts JSON-RPC array responses", async () => {
		const responses = [
			new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: { protocolVersion: "2025-06-18" },
				}),
				{ headers: { "content-type": "application/json" } },
			),
			new Response(null, { status: 202 }),
			new Response(
				JSON.stringify([
					{
						jsonrpc: "2.0",
						id: 2,
						result: { tools: [{ name: "batch_tool" }] },
					},
				]),
				{ headers: { "content-type": "application/json" } },
			),
		];
		vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
		const client = new McpRemoteClient("https://example.com/mcp", {});
		await expect(client.listTools()).resolves.toEqual([{ name: "batch_tool" }]);
	});
});

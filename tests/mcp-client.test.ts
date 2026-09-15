import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	connect: vi.fn(),
	close: vi.fn(),
	listTools: vi.fn(),
	callTool: vi.fn(),
	clients: [] as unknown[],
	transports: [] as unknown[],
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		constructor() {
			mocks.clients.push(this);
		}
		connect = mocks.connect;
		close = mocks.close;
		listTools = mocks.listTools;
		callTool = mocks.callTool;
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: class {
		constructor(url: URL, options: unknown) {
			mocks.transports.push({ url, options });
		}
	},
}));

import { McpRemoteClient } from "../toolshed/mcp-client.js";

beforeEach(() => {
	for (const mock of [
		mocks.connect,
		mocks.close,
		mocks.listTools,
		mocks.callTool,
	]) {
		mock.mockReset();
	}
	mocks.clients.length = 0;
	mocks.transports.length = 0;
	mocks.connect.mockResolvedValue(undefined);
	mocks.close.mockResolvedValue(undefined);
});

describe("McpRemoteClient", () => {
	it("uses a fresh upstream client for each stateless operation", async () => {
		mocks.listTools.mockResolvedValue({ tools: [{ name: "list_things" }] });
		mocks.callTool.mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		const client = new McpRemoteClient("https://example.com/mcp", {});

		await client.listTools();
		await client.callTool("list_things", {});

		expect(mocks.clients).toHaveLength(2);
		expect(mocks.connect).toHaveBeenCalledTimes(2);
		expect(mocks.close).toHaveBeenCalledTimes(2);
	});

	it("paginates catalogs and rejects repeated cursors", async () => {
		mocks.listTools
			.mockResolvedValueOnce({
				tools: [{ name: "first" }],
				nextCursor: "same",
			})
			.mockResolvedValueOnce({
				tools: [{ name: "second" }],
				nextCursor: "same",
			});
		const client = new McpRemoteClient("https://example.com/mcp", {});

		await expect(client.listTools()).rejects.toThrow("repeated cursor");
	});

	it("preserves structured and non-text tool results", async () => {
		const richResult = {
			content: [
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
			],
			structuredContent: { id: 42 },
			_meta: { traceId: "abc" },
		};
		mocks.callTool.mockResolvedValue(richResult);
		const client = new McpRemoteClient("https://example.com/mcp", {});

		await expect(client.callTool("render_chart", {})).resolves.toEqual(
			richResult,
		);
	});

	it("requires HTTPS except for localhost development", () => {
		expect(() => new McpRemoteClient("http://example.com/mcp", {})).toThrow(
			"must use HTTPS",
		);
		expect(
			() => new McpRemoteClient("http://localhost:3001/mcp", {}),
		).not.toThrow();
	});
});

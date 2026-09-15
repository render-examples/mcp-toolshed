import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "../toolshed/health.js";
import type { ToolRegistry } from "../toolshed/registry.js";
import type { ProviderStatus } from "../toolshed/types.js";

vi.mock("../toolshed/db.js", () => ({
	db: () => ({ query: async () => ({ rows: [{ "?column?": 1 }] }) }),
}));

const originalAllowEmpty = process.env.TOOLSHED_ALLOW_EMPTY;

afterEach(() => {
	if (originalAllowEmpty === undefined) {
		delete process.env.TOOLSHED_ALLOW_EMPTY;
	} else {
		process.env.TOOLSHED_ALLOW_EMPTY = originalAllowEmpty;
	}
});

function registry(
	toolCount: number,
	providers: ProviderStatus[],
): ToolRegistry {
	return {
		toolCount: () => toolCount,
		providerStatuses: () => providers,
		refreshFailedProviders: async () => undefined,
		scheduleProviderRefresh: () => undefined,
	} as ToolRegistry;
}

describe("checkHealth", () => {
	it("reports provider degradation without failing core readiness", async () => {
		const status = await checkHealth(
			registry(8, [
				{
					id: "slack",
					configured: true,
					healthy: false,
					toolCount: 8,
					error: "connection closed",
				},
			]),
		);
		expect(status.ok).toBe(true);
		expect(status.degraded).toBe(true);
		expect(status.providers[0]?.error).toBe("connection closed");
	});

	it("allows intentionally empty local development", async () => {
		process.env.TOOLSHED_ALLOW_EMPTY = "true";
		const status = await checkHealth(
			registry(0, [
				{
					id: "slack",
					configured: false,
					healthy: true,
					toolCount: 0,
				},
			]),
		);
		expect(status.ok).toBe(true);
	});
});

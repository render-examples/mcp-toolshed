import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAuditHealth,
	serializeAuditArguments,
	writeAuditEvent,
} from "../toolshed/audit.js";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
}));

vi.mock("../toolshed/db.js", () => ({
	db: () => ({ query: mocks.query }),
}));

const originalMaxBytes = process.env.TOOLSHED_AUDIT_MAX_ARGUMENT_BYTES;

beforeEach(() => {
	mocks.query.mockReset();
});

afterEach(() => {
	if (originalMaxBytes === undefined) {
		delete process.env.TOOLSHED_AUDIT_MAX_ARGUMENT_BYTES;
	} else {
		process.env.TOOLSHED_AUDIT_MAX_ARGUMENT_BYTES = originalMaxBytes;
	}
});

describe("audit argument serialization", () => {
	it("bounds the stored payload", () => {
		process.env.TOOLSHED_AUDIT_MAX_ARGUMENT_BYTES = "64";
		const serialized = serializeAuditArguments({ body: "x".repeat(100) })!;
		const payload = JSON.parse(serialized) as {
			truncated: boolean;
			preview: string;
		};
		expect(payload.truncated).toBe(true);
		expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(64);
	});

	it("exposes audit write failure and recovery through health state", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mocks.query.mockRejectedValueOnce(new Error("audit database unavailable"));
		await expect(
			writeAuditEvent({
				caller: { id: 1, role: "admin" },
				toolName: "example.tool",
				status: "success",
			}),
		).rejects.toThrow("audit database unavailable");
		expect(getAuditHealth()).toMatchObject({
			healthy: false,
			error: "audit database unavailable",
		});

		mocks.query
			.mockResolvedValueOnce({ rows: [{ id: 1 }] })
			.mockResolvedValueOnce({ rows: [] });
		await writeAuditEvent({
			caller: { id: 1, role: "admin" },
			toolName: "example.tool",
			status: "success",
		});
		expect(mocks.query.mock.calls.at(-2)?.[0]).toContain("'started'");
		expect(mocks.query.mock.calls.at(-2)?.[1]?.[0]).toBe(1);
		expect(mocks.query.mock.calls.at(-1)?.[0]).toContain("UPDATE audit_events");
		expect(getAuditHealth().healthy).toBe(true);
		errorLog.mockRestore();
	});
});

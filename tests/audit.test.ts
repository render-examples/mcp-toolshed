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
		await writeAuditEvent({
			caller: { role: "admin" },
			toolName: "example.tool",
			status: "success",
		});
		expect(getAuditHealth()).toMatchObject({
			healthy: false,
			error: "audit database unavailable",
		});

		mocks.query.mockResolvedValue({ rows: [] });
		await writeAuditEvent({
			caller: { role: "admin" },
			toolName: "example.tool",
			status: "success",
		});
		expect(getAuditHealth().healthy).toBe(true);
		errorLog.mockRestore();
	});
});

import { describe, expect, it } from "vitest";
import { redactArguments } from "../toolshed/redact.js";

describe("redactArguments", () => {
	it("redacts sensitive keys", () => {
		const out = redactArguments({
			id: "123",
			api_key: "secret",
			GITHUB_TOKEN: "tok",
		});
		expect(out.id).toBe("123");
		expect(out.api_key).toBe("[REDACTED]");
		expect(out.GITHUB_TOKEN).toBe("[REDACTED]");
	});

	it("redacts nested secrets and environment key/value records", () => {
		const out = redactArguments({
			deployment: {
				authorization: { token: "nested-token" },
				envVars: [
					{ key: "API_KEY", value: "nested-api-key" },
					{ key: "DATABASE_URL", value: "postgresql://secret" },
					{ name: "PRIVATE_KEY", val: "private-key-data" },
					{ key: "AWS_ACCESS_KEY_ID", value: "access-key" },
					{ key: "PUBLIC_URL", value: "https://example.com" },
				],
			},
		});
		expect(out).toEqual({
			deployment: {
				authorization: "[REDACTED]",
				envVars: [
					{ key: "API_KEY", value: "[REDACTED]" },
					{ key: "DATABASE_URL", value: "[REDACTED]" },
					{ name: "PRIVATE_KEY", val: "[REDACTED]" },
					{ key: "AWS_ACCESS_KEY_ID", value: "[REDACTED]" },
					{ key: "PUBLIC_URL", value: "https://example.com" },
				],
			},
		});
	});

	it("truncates oversized strings", () => {
		const out = redactArguments({ body: "abcdef" }, 3);
		expect(out.body).toBe("abc…[TRUNCATED]");
	});
});

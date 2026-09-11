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
});

import { describe, expect, it } from "vitest";
import { hashApiKey, parseBearerToken } from "../toolshed/auth.js";

describe("authentication helpers", () => {
	it("parses bearer schemes case-insensitively", () => {
		expect(parseBearerToken("bearer secret")).toBe("secret");
		expect(parseBearerToken("  BEARER\tsecret  ")).toBe("secret");
		expect(parseBearerToken("Basic secret")).toBeNull();
	});

	it("hashes API keys deterministically without storing plaintext", () => {
		expect(hashApiKey("secret")).toBe(
			"2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b",
		);
	});
});

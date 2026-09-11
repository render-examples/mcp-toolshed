import { afterEach, describe, expect, it } from "vitest";
import { childEnvironment } from "../toolshed/stdio-client.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
	if (originalDatabaseUrl === undefined) {
		delete process.env.DATABASE_URL;
	} else {
		process.env.DATABASE_URL = originalDatabaseUrl;
	}
});

describe("stdio child environment", () => {
	it("does not inherit unrelated service secrets", () => {
		process.env.DATABASE_URL = "postgresql://secret";
		const env = childEnvironment({ PROVIDER_TOKEN: "provider-only" });
		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.PROVIDER_TOKEN).toBe("provider-only");
		expect(env.PATH).toBe(process.env.PATH);
	});
});

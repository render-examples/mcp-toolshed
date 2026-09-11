import { describe, expect, it } from "vitest";
import { inferToolRisk } from "../toolshed/risk.js";

describe("inferToolRisk", () => {
	it("infers read from list/get prefixes", () => {
		expect(inferToolRisk("list_services", "write")).toBe("read");
		expect(inferToolRisk("get_postgres", "write")).toBe("read");
		expect(inferToolRisk("search_logs", "write")).toBe("read");
	});

	it("keeps write for mutating tools", () => {
		expect(inferToolRisk("create_web_service", "write")).toBe("write");
		expect(inferToolRisk("trigger_deploy", "write")).toBe("write");
	});
});

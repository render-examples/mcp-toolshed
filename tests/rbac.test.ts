import { describe, expect, it } from "vitest";
import { canDiscover, canExecute } from "../toolshed/rbac.js";
import type { ToolDefinition } from "../toolshed/types.js";

const renderList: ToolDefinition = {
	name: "render.list_services",
	description: "List services",
	inputSchema: {},
	risk: "read",
	tags: ["deploy"],
	providerId: "render",
};

const renderCreate: ToolDefinition = {
	name: "render.create_web_service",
	description: "Create service",
	inputSchema: {},
	risk: "write",
	tags: ["deploy"],
	providerId: "render",
};

const githubPr: ToolDefinition = {
	name: "github.create_pull_request",
	description: "Open PR",
	inputSchema: {},
	risk: "write",
	tags: ["code"],
	providerId: "github",
};

describe("rbac", () => {
	it("analyst can discover and execute read tools", () => {
		expect(canDiscover({ id: 1, role: "analyst" }, renderList)).toBe(true);
		expect(canExecute({ id: 1, role: "analyst" }, renderList)).toBe(true);
	});

	it("analyst cannot execute write tools", () => {
		expect(canExecute({ id: 1, role: "analyst" }, renderCreate)).toBe(false);
	});

	it("implementer can execute code tools but not render writes", () => {
		expect(canExecute({ id: 1, role: "implementer" }, githubPr)).toBe(true);
		expect(canExecute({ id: 1, role: "implementer" }, renderCreate)).toBe(false);
	});

});

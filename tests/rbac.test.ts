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

const intelSearch: ToolDefinition = {
	name: "intel.search.hybrid",
	description: "Search canonical intelligence documents",
	inputSchema: {},
	risk: "read",
	tags: ["knowledge"],
	providerId: "intel",
};

describe("rbac", () => {
	it("analyst can discover and execute read tools", () => {
		expect(canDiscover({ role: "analyst" }, renderList)).toBe(true);
		expect(canExecute({ role: "analyst" }, renderList)).toBe(true);
	});

	it("analyst cannot execute write tools", () => {
		expect(canExecute({ role: "analyst" }, renderCreate)).toBe(false);
	});

	it("implementer can execute code tools but not render writes", () => {
		expect(canExecute({ role: "implementer" }, githubPr)).toBe(true);
		expect(canExecute({ role: "implementer" }, renderCreate)).toBe(false);
	});

	it("analyst and implementer can use intelligence read tools", () => {
		expect(canExecute({ role: "analyst" }, intelSearch)).toBe(true);
		expect(canExecute({ role: "implementer" }, intelSearch)).toBe(true);
	});

	it("deploy-manager is limited to render prefix", () => {
		expect(canDiscover({ role: "deploy-manager" }, renderList)).toBe(true);
		expect(canDiscover({ role: "deploy-manager" }, githubPr)).toBe(false);
		expect(canDiscover({ role: "deploy-manager" }, intelSearch)).toBe(false);
	});
});

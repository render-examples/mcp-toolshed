import { roles, type AccessRule } from "../config/rbac.js";
import type { Caller, RoleName, ToolDefinition } from "./types.js";

const RISK_ORDER: Record<string, number> = { read: 0, write: 1 };

export function canDiscover(caller: Caller, tool: ToolDefinition): boolean {
	return matchesRule(caller.role, roles[caller.role].discover, tool);
}

export function canExecute(caller: Caller, tool: ToolDefinition): boolean {
	return matchesRule(caller.role, roles[caller.role].execute, tool);
}

function matchesRule(
	role: RoleName,
	rule: AccessRule,
	tool: ToolDefinition,
): boolean {
	if (RISK_ORDER[tool.risk] > RISK_ORDER[rule.maxRisk]) {
		return false;
	}
	if (role === "admin") {
		return true;
	}
	if (rule.prefixes?.length) {
		return rule.prefixes.some((prefix) => tool.name.startsWith(prefix));
	}
	if (rule.tags?.length) {
		return rule.tags.some((tag) => tool.tags.includes(tag));
	}
	return true;
}

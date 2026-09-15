import type { RoleName, Risk } from "../toolshed/types.js";

export interface RolePolicy {
	discover: AccessRule;
	execute: AccessRule;
}

export interface AccessRule {
	tags?: string[];
	prefixes?: string[];
	maxRisk: Risk;
}

export const roles: Record<RoleName, RolePolicy> = {
	analyst: {
		discover: { tags: ["deploy", "code", "support", "comms", "knowledge"], maxRisk: "read" },
		execute: { tags: ["deploy", "code", "support", "comms", "knowledge"], maxRisk: "read" },
	},
	implementer: {
		discover: { tags: ["deploy", "code", "support", "comms", "knowledge"], maxRisk: "write" },
		execute: { tags: ["code", "support", "comms", "knowledge"], maxRisk: "write" },
	},
	admin: {
		discover: { maxRisk: "write" },
		execute: { maxRisk: "write" },
	},
};

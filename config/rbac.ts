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
		discover: { tags: ["deploy", "code", "support", "comms"], maxRisk: "read" },
		execute: { tags: ["deploy", "code", "support", "comms"], maxRisk: "read" },
	},
	implementer: {
		discover: { tags: ["deploy", "code", "support", "comms"], maxRisk: "write" },
		execute: { tags: ["code", "support", "comms"], maxRisk: "write" },
	},
	"deploy-manager": {
		discover: { prefixes: ["render."], maxRisk: "write" },
		execute: { prefixes: ["render."], maxRisk: "write" },
	},
	admin: {
		discover: { maxRisk: "write" },
		execute: { maxRisk: "write" },
	},
};

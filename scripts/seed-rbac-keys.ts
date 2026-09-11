import { randomBytes } from "node:crypto";
import { hashApiKey } from "../toolshed/auth.js";

const ROLES = ["analyst", "implementer", "deploy-manager"] as const;

console.log("-- RBAC test keys (save these — shown once)\n");

const statements: string[] = [];

for (const role of ROLES) {
	const key = `rbac-${role}-${randomBytes(6).toString("hex")}`;
	const keyHash = hashApiKey(key);
	console.log(`${role}:`);
	console.log(`  TOOLSHED_KEY_${role.toUpperCase().replace("-", "_")}=${key}`);
	console.log(`  hash=${keyHash}\n`);
	statements.push(
		`INSERT INTO api_keys (key_hash, role, label) VALUES ('${keyHash}', '${role}', 'rbac-test-${role}') ON CONFLICT (key_hash) DO NOTHING;`,
	);
}

console.log("-- Run in toolshed Postgres (Render Dashboard → toolshed-db → Connect):\n");
console.log(statements.join("\n"));

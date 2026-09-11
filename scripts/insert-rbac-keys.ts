import { hashApiKey } from "../toolshed/auth.js";
import { closeDb, db } from "../toolshed/db.js";

const keys: Array<[string, string, string]> = [
	[process.env.TOOLSHED_KEY_ANALYST?.trim() ?? "", "analyst", "rbac-test-analyst"],
	[
		process.env.TOOLSHED_KEY_IMPLEMENTER?.trim() ?? "",
		"implementer",
		"rbac-test-implementer",
	],
	[
		process.env.TOOLSHED_KEY_DEPLOY_MANAGER?.trim() ?? "",
		"deploy-manager",
		"rbac-test-deploy-manager",
	],
];

for (const [key, role, label] of keys) {
	if (!key) {
		console.log(`skip ${label} (env not set)`);
		continue;
	}
	const { rowCount } = await db().query(
		`INSERT INTO api_keys (key_hash, role, label)
     VALUES ($1, $2, $3)
     ON CONFLICT (key_hash) DO NOTHING`,
		[hashApiKey(key), role, label],
	);
	console.log(`${rowCount ? "inserted" : "exists"} ${label} (${role})`);
}

const { rows } = await db().query<{ label: string; role: string }>(
	"SELECT label, role FROM api_keys ORDER BY created_at",
);
console.log(JSON.stringify(rows, null, 2));

await closeDb();

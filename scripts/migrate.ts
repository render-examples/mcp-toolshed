import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashApiKey } from "../toolshed/auth.js";
import { closeDb, db } from "../toolshed/db.js";

const migrationsDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"migrations",
);
const files = (await readdir(migrationsDir))
	.filter((name) => name.endsWith(".sql"))
	.sort();

const optionalRoleKeys: Array<[string, string, string]> = [
	["TOOLSHED_KEY_ANALYST", "analyst", "rbac-test-analyst"],
	["TOOLSHED_KEY_IMPLEMENTER", "implementer", "rbac-test-implementer"],
	[
		"TOOLSHED_KEY_DEPLOY_MANAGER",
		"deploy-manager",
		"rbac-test-deploy-manager",
	],
];

const client = await db().connect();
let locked = false;
try {
	await client.query("SELECT pg_advisory_lock(hashtext('mcp-toolshed-migrations'))");
	locked = true;
	await client.query(`
	  CREATE TABLE IF NOT EXISTS schema_migrations (
	    version TEXT PRIMARY KEY,
	    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	  )
	`);

	for (const file of files) {
		const { rows } = await client.query<{ version: string }>(
			"SELECT version FROM schema_migrations WHERE version = $1",
			[file],
		);
		if (rows.length > 0) {
			console.log(`skip ${file} (already applied)`);
			continue;
		}
		console.log(`applying ${file}`);
		await client.query("BEGIN");
		try {
			await client.query(await readFile(join(migrationsDir, file), "utf8"));
			await client.query(
				"INSERT INTO schema_migrations (version) VALUES ($1)",
				[file],
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	}

	const bootstrap = process.env.TOOLSHED_BOOTSTRAP_API_KEY?.trim();
	if (bootstrap) {
		const { rowCount } = await client.query(
			`INSERT INTO api_keys (key_hash, role, label)
	     VALUES ($1, 'admin', 'bootstrap')
	     ON CONFLICT (key_hash) DO NOTHING`,
			[hashApiKey(bootstrap)],
		);
		if (rowCount) {
			console.log("inserted bootstrap api key (role: admin)");
		}
		console.log(
			"note: unset TOOLSHED_BOOTSTRAP_API_KEY after deploy — auth uses api_keys table only",
		);
	}

	for (const [envName, role, label] of optionalRoleKeys) {
		const key = process.env[envName]?.trim();
		if (!key) {
			continue;
		}
		const { rowCount } = await client.query(
			`INSERT INTO api_keys (key_hash, role, label)
	     VALUES ($1, $2, $3)
	     ON CONFLICT (key_hash) DO NOTHING`,
			[hashApiKey(key), role, label],
		);
		if (rowCount) {
			console.log(`inserted api key (role: ${role}, label: ${label})`);
		}
	}
	console.log(`migrations complete (${files.length} file(s) in catalog)`);
} finally {
	if (locked) {
		await client
			.query("SELECT pg_advisory_unlock(hashtext('mcp-toolshed-migrations'))")
			.catch(() => undefined);
	}
	client.release();
	await closeDb();
}

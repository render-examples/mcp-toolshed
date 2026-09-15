import { createHash } from "node:crypto";
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
];

const client = await db().connect();
let locked = false;
try {
	await acquireMigrationLock(client);
	locked = true;
	await client.query("SET statement_timeout = '60s'");
	await client.query("SET lock_timeout = '10s'");
	await client.query(`
	  CREATE TABLE IF NOT EXISTS schema_migrations (
	    version TEXT PRIMARY KEY,
	    checksum TEXT,
	    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	  )
	`);
	await client.query(
		"ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT",
	);

	for (const file of files) {
		const sql = await readFile(join(migrationsDir, file), "utf8");
		const checksum = createHash("sha256").update(sql).digest("hex");
		const { rows } = await client.query<{
			version: string;
			checksum: string | null;
		}>(
			"SELECT version, checksum FROM schema_migrations WHERE version = $1",
			[file],
		);
		if (rows.length > 0) {
			if (rows[0]?.checksum && rows[0].checksum !== checksum) {
				throw new Error(
					`migration checksum mismatch for ${file}; applied migrations are immutable`,
				);
			}
			if (!rows[0]?.checksum) {
				await client.query(
					"UPDATE schema_migrations SET checksum = $2 WHERE version = $1",
					[file, checksum],
				);
			}
			console.log(`skip ${file} (already applied)`);
			continue;
		}
		console.log(`applying ${file}`);
		await client.query("BEGIN");
		try {
			await client.query(sql);
			await client.query(
				"INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
				[file, checksum],
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	}

	const bootstrap = process.env.TOOLSHED_BOOTSTRAP_API_KEY?.trim();
	if (bootstrap) {
		const { rows } = await client.query<{ count: string }>(
			"SELECT count(*)::text AS count FROM api_keys",
		);
		if (rows[0]?.count === "0") {
			await client.query(
				`INSERT INTO api_keys (key_hash, role, label)
		     VALUES ($1, 'admin', 'bootstrap')`,
				[hashApiKey(bootstrap)],
			);
			console.log("inserted bootstrap api key (role: admin)");
		} else {
			console.log(
				"ignored TOOLSHED_BOOTSTRAP_API_KEY because API keys already exist",
			);
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

async function acquireMigrationLock(
	client: import("pg").PoolClient,
): Promise<void> {
	const timeoutMs = positiveInteger(
		process.env.TOOLSHED_MIGRATION_LOCK_TIMEOUT_MS,
		30_000,
	);
	const deadline = Date.now() + timeoutMs;
	do {
		const { rows } = await client.query<{ locked: boolean }>(
			"SELECT pg_try_advisory_lock(hashtext('mcp-toolshed-migrations')) AS locked",
		);
		if (rows[0]?.locked) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	} while (Date.now() < deadline);
	throw new Error(`timed out waiting ${timeoutMs}ms for migration lock`);
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

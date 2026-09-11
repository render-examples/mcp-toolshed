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

await db().query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

for (const file of files) {
	const { rows } = await db().query<{ version: string }>(
		"SELECT version FROM schema_migrations WHERE version = $1",
		[file],
	);
	if (rows.length > 0) {
		console.log(`skip ${file} (already applied)`);
		continue;
	}
	console.log(`applying ${file}`);
	await db().query(await readFile(join(migrationsDir, file), "utf8"));
	await db().query("INSERT INTO schema_migrations (version) VALUES ($1)", [
		file,
	]);
}

const bootstrap = process.env.TOOLSHED_BOOTSTRAP_API_KEY?.trim();
if (bootstrap) {
	const keyHash = hashApiKey(bootstrap);
	const { rowCount } = await db().query(
		`INSERT INTO api_keys (key_hash, role, label)
     VALUES ($1, 'admin', 'bootstrap')
     ON CONFLICT (key_hash) DO NOTHING`,
		[keyHash],
	);
	if (rowCount) {
		console.log("inserted bootstrap api key (role: admin)");
	}
	console.log(
		"note: unset TOOLSHED_BOOTSTRAP_API_KEY after deploy — auth uses api_keys table only",
	);
}

await closeDb();
console.log(`migrations complete (${files.length} file(s) in catalog)`);

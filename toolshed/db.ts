import pg from "pg";

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
	if (!pool) {
		const url = process.env.DATABASE_URL?.trim();
		if (!url) {
			throw new Error("DATABASE_URL is required");
		}
		pool = new pg.Pool({ connectionString: url });
	}
	return pool;
}

export async function closeDb(): Promise<void> {
	await pool?.end();
	pool = undefined;
}

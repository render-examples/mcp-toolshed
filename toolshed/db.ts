import pg from "pg";

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
	if (!pool) {
		const url = process.env.DATABASE_URL?.trim();
		if (!url) {
			throw new Error("DATABASE_URL is required");
		}
		pool = new pg.Pool({
			connectionString: url,
			max: positiveInteger(process.env.TOOLSHED_DB_POOL_MAX, 10),
			connectionTimeoutMillis: 5_000,
			idleTimeoutMillis: 30_000,
		});
		pool.on("error", (error) => {
			console.error("unexpected idle Postgres connection error:", error);
		});
	}
	return pool;
}

export async function closeDb(): Promise<void> {
	await pool?.end();
	pool = undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

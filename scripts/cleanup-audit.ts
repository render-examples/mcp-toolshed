import { closeDb, db } from "../toolshed/db.js";

const retentionDays = positiveInteger(
	process.env.TOOLSHED_AUDIT_RETENTION_DAYS,
	30,
);
const batchSize = positiveInteger(
	process.env.TOOLSHED_AUDIT_CLEANUP_BATCH_SIZE,
	5_000,
);
const maxBatches = positiveInteger(
	process.env.TOOLSHED_AUDIT_CLEANUP_MAX_BATCHES,
	100,
);
const staleMinutes = positiveInteger(
	process.env.TOOLSHED_AUDIT_STALE_MINUTES,
	10,
);

const client = await db().connect();
let locked = false;
try {
	const { rows } = await client.query<{ locked: boolean }>(
		"SELECT pg_try_advisory_lock(hashtext('mcp-toolshed-audit-cleanup')) AS locked",
	);
	locked = rows[0]?.locked === true;
	if (!locked) {
		console.log("audit cleanup skipped: another cleanup holds the lock");
		process.exitCode = 0;
	} else {
		const stale = await client.query(
			`UPDATE audit_events
			    SET status = 'unknown',
			        error_message = COALESCE(error_message, 'execution outcome unknown after process interruption')
			  WHERE status = 'started'
			    AND created_at < now() - ($1 * interval '1 minute')`,
			[staleMinutes],
		);

		let deleted = 0;
		for (let batch = 0; batch < maxBatches; batch++) {
			const result = await client.query(
				`WITH doomed AS (
				   SELECT id
				     FROM audit_events
				    WHERE created_at < now() - ($1 * interval '1 day')
				    ORDER BY id
				    LIMIT $2
				 )
				 DELETE FROM audit_events event
				  USING doomed
				  WHERE event.id = doomed.id`,
				[retentionDays, batchSize],
			);
			deleted += result.rowCount ?? 0;
			if ((result.rowCount ?? 0) < batchSize) break;
		}
		console.log(
			`audit cleanup complete: ${stale.rowCount ?? 0} stale intent(s) marked unknown, ${deleted} expired event(s) deleted`,
		);
	}
} finally {
	if (locked) {
		await client
			.query(
				"SELECT pg_advisory_unlock(hashtext('mcp-toolshed-audit-cleanup'))",
			)
			.catch(() => undefined);
	}
	client.release();
	await closeDb();
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

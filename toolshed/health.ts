import { db } from "./db.js";
import type { ToolRegistry } from "./registry.js";

export interface HealthStatus {
	ok: boolean;
	database: boolean;
	toolCount: number;
	allowEmpty: boolean;
}

export async function checkHealth(registry: ToolRegistry): Promise<HealthStatus> {
	const allowEmpty = process.env.TOOLSHED_ALLOW_EMPTY === "true";
	let database = false;
	try {
		await db().query("SELECT 1");
		database = true;
	} catch {
		database = false;
	}

	const toolCount = registry.toolCount();
	const ok = database && (toolCount > 0 || allowEmpty);

	return { ok, database, toolCount, allowEmpty };
}

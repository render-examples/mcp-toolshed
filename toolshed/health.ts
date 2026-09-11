import { db } from "./db.js";
import { getAuditHealth, type AuditHealth } from "./audit.js";
import type { ToolRegistry } from "./registry.js";
import type { ProviderStatus } from "./types.js";

export interface HealthStatus {
	ok: boolean;
	database: boolean;
	toolCount: number;
	allowEmpty: boolean;
	providers: ProviderStatus[];
	audit: AuditHealth;
}

export async function checkHealth(registry: ToolRegistry): Promise<HealthStatus> {
	const allowEmpty = process.env.TOOLSHED_ALLOW_EMPTY === "true";
	registry.scheduleProviderRefresh();
	let database = false;
	try {
		await db().query("SELECT 1");
		database = true;
	} catch {
		database = false;
	}

	const toolCount = registry.toolCount();
	const providers = registry.providerStatuses();
	const configuredProviders = providers.filter((provider) => provider.configured);
	const providersHealthy = configuredProviders.every(
		(provider) => provider.healthy,
	);
	const audit = getAuditHealth();
	const ok =
		database && audit.healthy && providersHealthy && (toolCount > 0 || allowEmpty);

	return { ok, database, toolCount, allowEmpty, providers, audit };
}

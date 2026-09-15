import { db } from "./db.js";
import {
	getAuditHealth,
	probeAuditStorage,
	type AuditHealth,
} from "./audit.js";
import type { ToolRegistry } from "./registry.js";
import type { ProviderStatus } from "./types.js";

export interface HealthStatus {
	ok: boolean;
	database: boolean;
	toolCount: number;
	allowEmpty: boolean;
	degraded: boolean;
	providers: ProviderStatus[];
	audit: AuditHealth;
}

export async function checkHealth(
	registry: ToolRegistry,
	probeAudit = false,
): Promise<HealthStatus> {
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
	if (probeAudit) {
		await probeAuditStorage().catch(() => undefined);
	}
	const audit = getAuditHealth();
	const ok = database && (toolCount > 0 || allowEmpty);
	const degraded = !providersHealthy || !audit.healthy;

	return {
		ok,
		database,
		toolCount,
		allowEmpty,
		degraded,
		providers,
		audit,
	};
}

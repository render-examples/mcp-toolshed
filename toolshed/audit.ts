import { db } from "./db.js";
import { redactArguments } from "./redact.js";
import type { Caller } from "./types.js";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_ERROR_LENGTH = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;
let auditHealthy = true;
let lastAuditSuccessAt: string | undefined;
let lastAuditErrorAt: string | undefined;
let lastAuditError: string | undefined;

export interface AuditHealth {
	healthy: boolean;
	lastSuccessAt?: string;
	lastErrorAt?: string;
	error?: string;
}

export function getAuditHealth(): AuditHealth {
	return {
		healthy: auditHealthy,
		...(lastAuditSuccessAt ? { lastSuccessAt: lastAuditSuccessAt } : {}),
		...(lastAuditErrorAt ? { lastErrorAt: lastAuditErrorAt } : {}),
		...(lastAuditError ? { error: lastAuditError } : {}),
	};
}

export async function writeAuditEvent(input: {
	caller: Caller;
	toolName: string;
	arguments?: Record<string, unknown>;
	status: "success" | "denied" | "error";
	errorMessage?: string;
	durationMs?: number;
}): Promise<void> {
	try {
		await db().query(
			`INSERT INTO audit_events
        (caller_role, caller_label, tool_name, arguments, status, error_message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				input.caller.role,
				input.caller.label ?? null,
				input.toolName,
				serializeAuditArguments(input.arguments),
				input.status,
				input.errorMessage?.slice(0, MAX_ERROR_LENGTH) ?? null,
				input.durationMs ?? null,
			],
		);
		auditHealthy = true;
		lastAuditSuccessAt = new Date().toISOString();
		lastAuditError = undefined;
	} catch (error) {
		auditHealthy = false;
		lastAuditErrorAt = new Date().toISOString();
		lastAuditError = error instanceof Error ? error.message : String(error);
		console.error("audit write failed:", error);
		return;
	}
	await maybeCleanupAuditEvents().catch((error) => {
		console.error("audit cleanup failed:", error);
	});
}

export function serializeAuditArguments(
	args: Record<string, unknown> | undefined,
): string | null {
	if (!args) {
		return null;
	}
	const serialized = JSON.stringify(redactArguments(args));
	const maxBytes = positiveInteger(
		process.env.TOOLSHED_AUDIT_MAX_ARGUMENT_BYTES,
		DEFAULT_MAX_ARGUMENT_BYTES,
	);
	if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
		return serialized;
	}
	const emptyEnvelope = JSON.stringify({ truncated: true, preview: "" });
	if (Buffer.byteLength(emptyEnvelope, "utf8") > maxBytes) {
		const marker = JSON.stringify("[TRUNCATED]");
		return Buffer.byteLength(marker, "utf8") <= maxBytes
			? marker
			: maxBytes >= 4
				? "null"
				: "0";
	}
	const previewBudget =
		maxBytes - Buffer.byteLength(emptyEnvelope, "utf8");
	let preview = Buffer.from(serialized)
		.subarray(0, previewBudget)
		.toString("utf8");
	let bounded = JSON.stringify({
		truncated: true,
		preview,
	});
	while (Buffer.byteLength(bounded, "utf8") > maxBytes && preview.length) {
		preview = preview.slice(0, -1);
		bounded = JSON.stringify({ truncated: true, preview });
	}
	return bounded;
}

async function maybeCleanupAuditEvents(): Promise<void> {
	const now = Date.now();
	if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
		return;
	}
	lastCleanupAt = now;
	const retentionDays = positiveInteger(
		process.env.TOOLSHED_AUDIT_RETENTION_DAYS,
		DEFAULT_RETENTION_DAYS,
	);
	try {
		await db().query(
			"DELETE FROM audit_events WHERE created_at < now() - ($1 * interval '1 day')",
			[retentionDays],
		);
	} catch (error) {
		lastCleanupAt = 0;
		throw error;
	}
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

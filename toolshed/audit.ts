import { db } from "./db.js";
import { redactArguments } from "./redact.js";
import type { Caller } from "./types.js";

const DEFAULT_MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_ERROR_LENGTH = 10_000;
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

export type FinalAuditStatus = "success" | "denied" | "error" | "unknown";

export function getAuditHealth(): AuditHealth {
	return {
		healthy: auditHealthy,
		...(lastAuditSuccessAt ? { lastSuccessAt: lastAuditSuccessAt } : {}),
		...(lastAuditErrorAt ? { lastErrorAt: lastAuditErrorAt } : {}),
		...(lastAuditError ? { error: lastAuditError } : {}),
	};
}

/** Persist an execution intent before dispatching a provider operation. */
export async function beginAuditEvent(input: {
	caller: Caller;
	toolName: string;
	arguments?: Record<string, unknown>;
}): Promise<number> {
	try {
		const { rows } = await db().query<{ id: string | number }>(
			`INSERT INTO audit_events
        (api_key_id, caller_role, caller_label, tool_name, arguments, status)
       VALUES ($1, $2, $3, $4, $5, 'started')
       RETURNING id`,
			[
				input.caller.id,
				input.caller.role,
				input.caller.label ?? null,
				input.toolName,
				serializeAuditArguments(input.arguments),
			],
		);
		recordAuditSuccess();
		const id = Number(rows[0]?.id);
		if (!Number.isSafeInteger(id) || id < 1) {
			throw new Error("audit insert did not return a valid event id");
		}
		return id;
	} catch (error) {
		recordAuditFailure(error);
		throw error;
	}
}

export async function completeAuditEvent(
	id: number,
	input: {
		status: FinalAuditStatus;
		errorMessage?: string;
		durationMs?: number;
	},
): Promise<void> {
	try {
		await db().query(
			`UPDATE audit_events
			    SET status = $2,
			        error_message = $3,
			        duration_ms = $4
			  WHERE id = $1`,
			[
				id,
				input.status,
				sanitizeErrorMessage(input.errorMessage),
				input.durationMs ?? null,
			],
		);
		recordAuditSuccess();
	} catch (error) {
		recordAuditFailure(error);
		throw error;
	}
}

/** Compatibility helper for non-provider events and tests. */
export async function writeAuditEvent(input: {
	caller: Caller;
	toolName: string;
	arguments?: Record<string, unknown>;
	status: FinalAuditStatus;
	errorMessage?: string;
	durationMs?: number;
}): Promise<void> {
	const id = await beginAuditEvent(input);
	await completeAuditEvent(id, input);
}

export async function probeAuditStorage(): Promise<void> {
	try {
		await db().query("SELECT id FROM audit_events LIMIT 1");
		recordAuditSuccess();
	} catch (error) {
		recordAuditFailure(error);
		throw error;
	}
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
	const previewBudget = maxBytes - Buffer.byteLength(emptyEnvelope, "utf8");
	let preview = Buffer.from(serialized)
		.subarray(0, previewBudget)
		.toString("utf8");
	let bounded = JSON.stringify({ truncated: true, preview });
	while (Buffer.byteLength(bounded, "utf8") > maxBytes && preview.length) {
		preview = preview.slice(0, -1);
		bounded = JSON.stringify({ truncated: true, preview });
	}
	return bounded;
}

function sanitizeErrorMessage(message: string | undefined): string | null {
	if (!message) {
		return null;
	}
	return message
		.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
		.replace(
			/([?&](?:token|key|secret|password)=)[^&\s]+/gi,
			"$1[REDACTED]",
		)
		.slice(0, MAX_ERROR_LENGTH);
}

function recordAuditSuccess(): void {
	auditHealthy = true;
	lastAuditSuccessAt = new Date().toISOString();
	lastAuditError = undefined;
}

function recordAuditFailure(error: unknown): void {
	auditHealthy = false;
	lastAuditErrorAt = new Date().toISOString();
	lastAuditError = error instanceof Error ? error.message : String(error);
	console.error("audit operation failed:", error);
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

import { db } from "./db.js";
import { redactArguments } from "./redact.js";
import type { Caller } from "./types.js";

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
				input.arguments
					? JSON.stringify(redactArguments(input.arguments))
					: null,
				input.status,
				input.errorMessage ?? null,
				input.durationMs ?? null,
			],
		);
	} catch (error) {
		console.error("audit write failed:", error);
	}
}

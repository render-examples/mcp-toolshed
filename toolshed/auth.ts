import { createHash } from "node:crypto";
import { roles } from "../config/rbac.js";
import { db } from "./db.js";
import { ROLE_NAMES, type Caller, type RoleName } from "./types.js";

export function hashApiKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

export function parseBearerToken(header: string | undefined): string | null {
	if (!header?.startsWith("Bearer ")) {
		return null;
	}
	const token = header.slice("Bearer ".length).trim();
	return token || null;
}

function isRoleName(value: string): value is RoleName {
	return (ROLE_NAMES as readonly string[]).includes(value);
}

export async function resolveCaller(
	authorizationHeader: string | undefined,
): Promise<Caller | null> {
	const token = parseBearerToken(authorizationHeader);
	if (!token) {
		return null;
	}

	const { rows } = await db().query<{ role: string; label: string | null }>(
		"SELECT role, label FROM api_keys WHERE key_hash = $1 LIMIT 1",
		[hashApiKey(token)],
	);
	if (!rows[0]) {
		return null;
	}
	if (!isRoleName(rows[0].role) || !roles[rows[0].role]) {
		console.warn(`api_keys: invalid role "${rows[0].role}" — rejecting key`);
		return null;
	}
	return { role: rows[0].role, label: rows[0].label ?? undefined };
}

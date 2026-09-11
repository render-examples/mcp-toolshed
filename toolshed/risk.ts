import type { Risk } from "./types.js";

const READ_TOOL_PATTERN =
	/^(list|get|search|fetch|read|query|describe|show|find|lookup)(_|$)/i;

/** Infer read vs write from upstream tool name; falls back to provider default. */
export function inferToolRisk(upstreamName: string, defaultRisk: Risk): Risk {
	const segment = upstreamName.includes(".")
		? upstreamName.split(".").pop()!
		: upstreamName;
	if (READ_TOOL_PATTERN.test(segment)) {
		return "read";
	}
	return defaultRisk;
}

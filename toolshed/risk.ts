import type { Risk } from "./types.js";

const READ_VERB =
	/(?:^|[._-])(list|get|search|fetch|read|query|describe|show|find|lookup)(?:[._-]|$)/i;
const WRITE_VERB =
	/(?:^|[._-])(create|update|delete|remove|set|add|post|send|merge|trigger|restart|cancel|approve|reject|write|push|fork|archive|restore)(?:[._-]|$)/i;

/** Infer read vs write from upstream tool name; falls back to provider default. */
export function inferToolRisk(upstreamName: string, defaultRisk: Risk): Risk {
	if (WRITE_VERB.test(upstreamName)) {
		return "write";
	}
	if (READ_VERB.test(upstreamName)) {
		return "read";
	}
	return defaultRisk;
}

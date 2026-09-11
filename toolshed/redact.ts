const SENSITIVE_KEY = /(token|secret|password|authorization|api[_-]?key|credential)/i;

export function redactArguments(
	args: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : value;
	}
	return out;
}

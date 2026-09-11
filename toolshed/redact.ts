const SENSITIVE_KEY =
	/(token|secret|password|passphrase|authorization|api[_-]?key|credential|private[_-]?key|access[_-]?key|database[_-]?url|connection[_-]?string|webhook[_-]?url|cookie)/i;
const SECRET_NAME_FIELD = /^(key|name)$/i;
const SECRET_VALUE_FIELD = /^(value|val)$/i;
const DEFAULT_MAX_STRING_LENGTH = 10_000;

export function redactArguments(
	args: Record<string, unknown>,
	maxStringLength = DEFAULT_MAX_STRING_LENGTH,
): Record<string, unknown> {
	return redactValue(args, new WeakSet(), maxStringLength) as Record<
		string,
		unknown
	>;
}

function redactValue(
	value: unknown,
	seen: WeakSet<object>,
	maxStringLength: number,
): unknown {
	if (typeof value === "string") {
		return value.length > maxStringLength
			? `${value.slice(0, maxStringLength)}…[TRUNCATED]`
			: value;
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	if (seen.has(value)) {
		return "[CIRCULAR]";
	}
	seen.add(value);
	if (Array.isArray(value)) {
		return value.map((item) => redactValue(item, seen, maxStringLength));
	}

	const record = value as Record<string, unknown>;
	const namedSecret = Object.entries(record).some(
		([key, candidate]) =>
			SECRET_NAME_FIELD.test(key) &&
			typeof candidate === "string" &&
			SENSITIVE_KEY.test(candidate),
	);
	const out: Record<string, unknown> = {};
	for (const [key, candidate] of Object.entries(record)) {
		out[key] =
			SENSITIVE_KEY.test(key) ||
			(namedSecret && SECRET_VALUE_FIELD.test(key))
				? "[REDACTED]"
				: redactValue(candidate, seen, maxStringLength);
	}
	return out;
}

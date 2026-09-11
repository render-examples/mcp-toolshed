import {
	Ajv,
	type ErrorObject,
	type ValidateFunction,
} from "ajv/dist/ajv.js";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ToolDefinition } from "./types.js";

const options = {
	allErrors: true,
	strict: false,
	validateFormats: false,
} as const;
const ajv = new Ajv(options);
const ajv2019 = new Ajv2019(options);
const ajv2020 = new Ajv2020(options);
const validators = new WeakMap<object, ValidateFunction>();
const DRAFT_2019_KEYWORDS = new Set([
	"$recursiveAnchor",
	"$recursiveRef",
]);
const DRAFT_2020_KEYWORDS = new Set([
	"$dynamicAnchor",
	"$dynamicRef",
	"dependentRequired",
	"dependentSchemas",
	"maxContains",
	"minContains",
	"prefixItems",
	"unevaluatedItems",
	"unevaluatedProperties",
]);

export class InvalidToolArgumentsError extends Error {
	constructor(
		toolName: string,
		public readonly validationErrors: ErrorObject[],
	) {
		super(
			`invalid arguments for ${toolName}: ${ajv.errorsText(validationErrors, {
				separator: "; ",
			})}`,
		);
		this.name = "InvalidToolArgumentsError";
	}
}

export function validateToolArguments(
	tool: ToolDefinition,
	args: Record<string, unknown>,
): void {
	const validate = validatorFor(tool.inputSchema);
	if (!validate(args)) {
		throw new InvalidToolArgumentsError(tool.name, validate.errors ?? []);
	}
}

function validatorFor(schema: Record<string, unknown>): ValidateFunction {
	const cached = validators.get(schema);
	if (cached) {
		return cached;
	}
	const dialect = typeof schema.$schema === "string" ? schema.$schema : "";
	const compiler = dialect.includes("2020-12")
		? ajv2020
		: dialect.includes("2019-09")
			? ajv2019
			: usesKeywords(schema, DRAFT_2019_KEYWORDS)
				? ajv2019
				: usesKeywords(schema, DRAFT_2020_KEYWORDS)
				? ajv2020
				: ajv;
	const compiled = compiler.compile(schema);
	validators.set(schema, compiled);
	return compiled;
}

function usesKeywords(value: unknown, keywords: Set<string>): boolean {
	if (!value || typeof value !== "object") {
		return false;
	}
	if (Array.isArray(value)) {
		return value.some((item) => usesKeywords(item, keywords));
	}
	return Object.entries(value as Record<string, unknown>).some(
		([key, child]) =>
			keywords.has(key) || usesKeywords(child, keywords),
	);
}

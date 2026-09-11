import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../toolshed/types.js";
import {
	InvalidToolArgumentsError,
	validateToolArguments,
} from "../toolshed/validate.js";

describe("validateToolArguments", () => {
	it("supports JSON Schema 2020-12", () => {
		const definition: ToolDefinition = {
			name: "example.modern_schema",
			description: "Modern schema",
			inputSchema: {
				$schema: "https://json-schema.org/draft/2020-12/schema",
				type: "object",
				properties: {
					items: {
						type: "array",
						prefixItems: [{ type: "string" }, { type: "number" }],
					},
				},
				required: ["items"],
			},
			risk: "read",
			tags: [],
			providerId: "example",
		};

		expect(() =>
			validateToolArguments(definition, { items: ["ok", 1] }),
		).not.toThrow();
		expect(() =>
			validateToolArguments(definition, { items: [1, "wrong"] }),
		).toThrow(InvalidToolArgumentsError);
	});

	it("detects modern keywords when the schema omits its dialect", () => {
		const definition: ToolDefinition = {
			name: "example.implicit_modern_schema",
			description: "Implicit modern schema",
			inputSchema: {
				type: "object",
				properties: {
					items: {
						type: "array",
						prefixItems: [{ type: "string" }],
					},
				},
			},
			risk: "read",
			tags: [],
			providerId: "example",
		};
		expect(() => validateToolArguments(definition, { items: [1] })).toThrow(
			InvalidToolArgumentsError,
		);
	});

	it("detects implicit JSON Schema 2019-09 recursion", () => {
		const definition: ToolDefinition = {
			name: "example.recursive_schema",
			description: "Recursive schema",
			inputSchema: {
				$recursiveAnchor: true,
				type: "object",
				properties: {
					value: { type: "string" },
					child: { $recursiveRef: "#" },
				},
			},
			risk: "read",
			tags: [],
			providerId: "example",
		};
		expect(() =>
			validateToolArguments(definition, {
				value: "root",
				child: { value: 123 },
			}),
		).toThrow(InvalidToolArgumentsError);
	});
});

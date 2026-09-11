import { canDiscover, canExecute } from "./rbac.js";
import { rankByQuery } from "./search.js";
import type { ToolRegistry } from "./registry.js";
import type { Caller, ToolCallResult, ToolDefinition } from "./types.js";

export class AccessDeniedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AccessDeniedError";
	}
}

export class ToolNotFoundError extends Error {
	constructor(name: string) {
		super(`tool not found: ${name}`);
		this.name = "ToolNotFoundError";
	}
}

export class ToolshedDispatcher {
	constructor(private readonly registry: ToolRegistry) {}

	searchTools(query: string, caller: Caller, limit = 10) {
		const allowed = this.registry
			.allTools()
			.filter((tool) => canDiscover(caller, tool));
		return rankByQuery(allowed, query, limit);
	}

	getToolSchema(name: string, caller: Caller): ToolDefinition {
		const tool = this.registry.getTool(name);
		if (!tool) {
			throw new ToolNotFoundError(name);
		}
		if (!canDiscover(caller, tool)) {
			throw new AccessDeniedError(`not allowed to view schema for ${name}`);
		}
		return tool;
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		caller: Caller,
	): Promise<ToolCallResult> {
		const tool = this.registry.getTool(name);
		if (!tool) {
			throw new ToolNotFoundError(name);
		}
		if (!canExecute(caller, tool)) {
			throw new AccessDeniedError(`not allowed to execute ${name}`);
		}
		const provider = this.registry.getProvider(tool.providerId);
		if (!provider) {
			throw new Error(`provider not found: ${tool.providerId}`);
		}
		return provider.callTool(tool, args, { caller });
	}
}

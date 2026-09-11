import type { ProviderConfig, ResolvedProvider, ToolDefinition } from "./types.js";
import { resolveProvider } from "./provider.js";

export class ToolCollisionError extends Error {
	constructor(name: string) {
		super(`tool name collision: "${name}" is registered by multiple providers`);
		this.name = "ToolCollisionError";
	}
}

export class ToolRegistry {
	private readonly byName = new Map<string, ToolDefinition>();
	private readonly providers = new Map<string, ResolvedProvider>();

	static async create(configs: ProviderConfig[]): Promise<ToolRegistry> {
		const registry = new ToolRegistry();
		for (const config of configs) {
			try {
				const resolved = await resolveProvider(config);
				if (!resolved) {
					continue;
				}
				registry.providers.set(config.id, resolved);
				for (const tool of resolved.tools) {
					registry.registerTool(tool);
				}
				console.log(
					`provider ${config.id}: loaded ${resolved.tools.length} tool(s)`,
				);
			} catch (error) {
				if (error instanceof ToolCollisionError) {
					throw error;
				}
				console.warn(
					`provider ${config.id}: failed to load — ${error instanceof Error ? error.message : error}`,
				);
			}
		}
		if (registry.byName.size === 0) {
			console.warn(
				"toolshed: no provider tools loaded — check credentials or set TOOLSHED_ALLOW_EMPTY=true",
			);
		}
		return registry;
	}

	private registerTool(tool: ToolDefinition): void {
		if (this.byName.has(tool.name)) {
			throw new ToolCollisionError(tool.name);
		}
		this.byName.set(tool.name, tool);
	}

	allTools(): ToolDefinition[] {
		return [...this.byName.values()];
	}

	toolCount(): number {
		return this.byName.size;
	}

	getTool(name: string): ToolDefinition | undefined {
		return this.byName.get(name);
	}

	getProvider(providerId: string): ResolvedProvider | undefined {
		return this.providers.get(providerId);
	}

	async shutdown(): Promise<void> {
		for (const provider of this.providers.values()) {
			await provider.shutdown?.();
		}
	}
}

export function createRegistry(configs: ProviderConfig[]): Promise<ToolRegistry> {
	return ToolRegistry.create(configs);
}

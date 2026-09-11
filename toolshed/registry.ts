import type {
	ProviderConfig,
	ProviderStatus,
	ResolvedProvider,
	ToolDefinition,
} from "./types.js";
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
	private readonly providerFailures = new Map<string, ProviderStatus>();
	private readonly failedConfigs = new Map<string, ProviderConfig>();
	private readonly lastProviderAttempt = new Map<string, number>();
	private refreshPromise?: Promise<void>;
	private refreshAbort?: AbortController;
	private shuttingDown = false;

	static async create(configs: ProviderConfig[]): Promise<ToolRegistry> {
		const registry = new ToolRegistry();
		for (const config of configs) {
			try {
				const resolved = await resolveProvider(config);
				if (!resolved) {
					registry.providerFailures.set(config.id, {
						id: config.id,
						configured: false,
						healthy: true,
						toolCount: 0,
					});
					continue;
				}
				registry.providerFailures.delete(config.id);
				registry.activateProvider(resolved);
				console.log(
					`provider ${config.id}: loaded ${resolved.tools.length} tool(s)`,
				);
			} catch (error) {
				if (error instanceof ToolCollisionError) {
					throw error;
				}
				registry.providerFailures.set(config.id, {
					id: config.id,
					configured: true,
					healthy: false,
					toolCount: 0,
					error: error instanceof Error ? error.message : String(error),
				});
				registry.failedConfigs.set(config.id, config);
				registry.lastProviderAttempt.set(config.id, Date.now());
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

	private activateProvider(provider: ResolvedProvider): void {
		const names = new Set<string>();
		for (const tool of provider.tools) {
			if (this.byName.has(tool.name) || names.has(tool.name)) {
				throw new ToolCollisionError(tool.name);
			}
			names.add(tool.name);
		}
		for (const tool of provider.tools) {
			this.registerTool(tool);
		}
		this.providers.set(provider.config.id, provider);
		this.providerFailures.delete(provider.config.id);
		this.failedConfigs.delete(provider.config.id);
		this.lastProviderAttempt.delete(provider.config.id);
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

	providerStatuses(): ProviderStatus[] {
		const loaded = [...this.providers.values()].map((provider) =>
			provider.status(),
		);
		return [...loaded, ...this.providerFailures.values()].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
	}

	async refreshFailedProviders(minRetryIntervalMs = 30_000): Promise<void> {
		if (this.shuttingDown) {
			return;
		}
		if (!this.refreshPromise) {
			const controller = new AbortController();
			this.refreshAbort = controller;
			this.refreshPromise = this.refreshProviders(
				minRetryIntervalMs,
				controller.signal,
			).finally(() => {
				if (this.refreshAbort === controller) {
					this.refreshAbort = undefined;
				}
					this.refreshPromise = undefined;
			});
		}
		await this.refreshPromise;
	}

	scheduleProviderRefresh(): void {
		if (this.shuttingDown) {
			return;
		}
		void this.refreshFailedProviders().catch((error) => {
			console.warn(
				`provider refresh failed: ${error instanceof Error ? error.message : error}`,
			);
		});
	}

	private async refreshProviders(
		minRetryIntervalMs: number,
		signal: AbortSignal,
	): Promise<void> {
		const now = Date.now();
		for (const provider of this.providers.values()) {
			if (signal.aborted) {
				return;
			}
			const current = provider.status();
			if (current.healthy || !provider.probe) {
				continue;
			}
			const lastAttempt = this.lastProviderAttempt.get(current.id) ?? 0;
			if (now - lastAttempt < minRetryIntervalMs) {
				continue;
			}
			this.lastProviderAttempt.set(current.id, now);
			try {
				await provider.probe(signal);
				this.lastProviderAttempt.delete(current.id);
			} catch {
				// The provider wrapper records the latest probe error in its status.
			}
		}

		for (const [id, config] of this.failedConfigs) {
			if (signal.aborted) {
				return;
			}
			const lastAttempt = this.lastProviderAttempt.get(id) ?? 0;
			if (now - lastAttempt < minRetryIntervalMs) {
				continue;
			}
			this.lastProviderAttempt.set(id, now);
			try {
				const resolved = await resolveProvider(config, signal);
				if (!resolved) {
					this.providerFailures.set(id, {
						id,
						configured: false,
						healthy: true,
						toolCount: 0,
					});
					this.failedConfigs.delete(id);
					continue;
				}
				if (this.shuttingDown) {
					await resolved.shutdown?.();
					continue;
				}
				this.activateProvider(resolved);
				console.log(`provider ${id}: recovered with ${resolved.tools.length} tool(s)`);
			} catch (error) {
				this.providerFailures.set(id, {
					id,
					configured: true,
					healthy: false,
					toolCount: 0,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		this.failedConfigs.clear();
		this.refreshAbort?.abort();
		await this.refreshPromise?.catch(() => undefined);
		await Promise.allSettled(
			[...this.providers.values()].map((provider) => provider.shutdown?.()),
		);
	}
}

export function createRegistry(configs: ProviderConfig[]): Promise<ToolRegistry> {
	return ToolRegistry.create(configs);
}

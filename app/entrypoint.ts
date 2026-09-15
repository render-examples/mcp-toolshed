import { serve } from "@hono/node-server";
import { loadRegistry } from "../providers/index.js";
import { closeDb } from "../toolshed/db.js";
import { ToolshedDispatcher } from "../toolshed/dispatcher.js";
import { createApp, RequestLifecycle } from "../toolshed/server.js";
import { closeServer } from "../toolshed/shutdown.js";

const port = Number(process.env.PORT ?? 3000);

console.log("loading tool registry…");
const registry = await loadRegistry();
const dispatcher = new ToolshedDispatcher(registry);
const lifecycle = new RequestLifecycle();
const app = createApp({ dispatcher, registry, lifecycle });

console.log(`toolshed ready on 0.0.0.0:${port}`);
console.log(`  health: http://0.0.0.0:${port}/ready`);
console.log(`  mcp:    http://0.0.0.0:${port}/mcp`);
console.log(`  tools:  ${registry.toolCount()} provider tool(s) indexed`);

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port });

let shutdownPromise: Promise<void> | undefined;

function shutdown(signal: string): Promise<void> {
	shutdownPromise ??= performShutdown(signal);
	return shutdownPromise;
}

async function performShutdown(signal: string): Promise<void> {
	console.log(`${signal} received — shutting down`);
	try {
		lifecycle.startDraining();
		const drained = await lifecycle.waitForIdle(65_000);
		if (!drained) {
			console.warn("aborting provider calls that exceeded the drain deadline");
			lifecycle.abortActive();
		}
		await closeServer(server, 10_000);
		await registry.shutdown();
		await closeDb();
		console.log("shutdown complete");
	} catch (error) {
		console.error("shutdown failed:", error);
		process.exitCode = 1;
	}
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

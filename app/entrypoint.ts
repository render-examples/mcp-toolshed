import { serve } from "@hono/node-server";
import { loadRegistry } from "../providers/index.js";
import { closeDb } from "../toolshed/db.js";
import { ToolshedDispatcher } from "../toolshed/dispatcher.js";
import { createApp } from "../toolshed/server.js";

const port = Number(process.env.PORT ?? 3000);

console.log("loading tool registry…");
const registry = await loadRegistry();
const dispatcher = new ToolshedDispatcher(registry);
const app = createApp({ dispatcher, registry });

console.log(`toolshed ready on 0.0.0.0:${port}`);
console.log(`  health: http://0.0.0.0:${port}/ready`);
console.log(`  mcp:    http://0.0.0.0:${port}/mcp`);
console.log(`  tools:  ${registry.toolCount()} provider tool(s) indexed`);

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port });

async function shutdown(signal: string) {
	console.log(`${signal} received — shutting down`);
	server.close();
	await registry.shutdown();
	await closeDb();
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

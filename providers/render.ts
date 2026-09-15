import { defineMcpRemoteProvider } from "../toolshed/provider.js";
import { renderToolPolicy } from "../config/tool-policy.js";

export const render = defineMcpRemoteProvider({
	id: "render",
	url: process.env.RENDER_MCP_URL?.trim() || "https://mcp.render.com/mcp",
	auth: { header: "Authorization", env: "RENDER_API_KEY", prefix: "Bearer " },
	toolPrefix: "render",
	risk: "write",
	tags: ["deploy", "infra"],
	toolPolicy: renderToolPolicy,
	enabled: () => Boolean(process.env.RENDER_API_KEY?.trim()),
});

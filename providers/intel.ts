import { defineMcpRemoteProvider } from "../toolshed/provider.js";

export const intel = defineMcpRemoteProvider({
	id: "intel",
	url: process.env.INTEL_MCP_URL?.trim() || "",
	auth: {
		header: "Authorization",
		env: "INTEL_MCP_API_KEY",
		prefix: "Bearer ",
	},
	toolPrefix: process.env.INTEL_MCP_TOOL_PREFIX?.trim() || "intel",
	risk: "read",
	tags: ["knowledge"],
	timeoutMs: 60_000,
	enabled: () =>
		Boolean(
			process.env.INTEL_MCP_URL?.trim() &&
				process.env.INTEL_MCP_API_KEY?.trim(),
		),
});

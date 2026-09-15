import { defineMcpRemoteProvider } from "../toolshed/provider.js";
import { githubToolPolicy } from "../config/tool-policy.js";

export const github = defineMcpRemoteProvider({
	id: "github",
	url:
		process.env.GITHUB_MCP_URL?.trim() ??
		"https://api.githubcopilot.com/mcp/",
	auth: {
		header: "Authorization",
		env: "GITHUB_TOKEN",
		prefix: "Bearer ",
	},
	toolPrefix: "github",
	risk: "write",
	tags: ["code", "pr"],
	toolPolicy: githubToolPolicy,
	enabled: () => Boolean(process.env.GITHUB_TOKEN?.trim()),
});

import { defineMcpStdioProvider } from "../toolshed/provider.js";

export const github = defineMcpStdioProvider({
	id: "github",
	command: "node",
	args: ["node_modules/@modelcontextprotocol/server-github/dist/index.js"],
	env: {
		GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN?.trim() ?? "",
	},
	toolPrefix: "github",
	risk: "write",
	tags: ["code", "pr"],
	enabled: () => Boolean(process.env.GITHUB_TOKEN?.trim()),
});

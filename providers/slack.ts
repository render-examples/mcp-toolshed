import { defineMcpStdioProvider } from "../toolshed/provider.js";

export const slack = defineMcpStdioProvider({
	id: "slack",
	command: "node",
	args: ["node_modules/@modelcontextprotocol/server-slack/dist/index.js"],
	env: {
		SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN?.trim() ?? "",
	},
	toolPrefix: "slack",
	risk: "write",
	tags: ["comms"],
	enabled: () => Boolean(process.env.SLACK_BOT_TOKEN?.trim()),
});

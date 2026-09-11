import { defineMcpStdioProvider } from "../toolshed/provider.js";

function slackEnv(): Record<string, string> {
	const env: Record<string, string> = {
		SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN?.trim() ?? "",
		SLACK_TEAM_ID: process.env.SLACK_TEAM_ID?.trim() ?? "",
	};
	const channelIds = process.env.SLACK_CHANNEL_IDS?.trim();
	if (channelIds) {
		env.SLACK_CHANNEL_IDS = channelIds;
	}
	return env;
}

export const slack = defineMcpStdioProvider({
	id: "slack",
	command: "node",
	args: ["node_modules/@modelcontextprotocol/server-slack/dist/index.js"],
	env: slackEnv(),
	toolPrefix: "slack",
	risk: "write",
	tags: ["comms"],
	enabled: () =>
		Boolean(
			process.env.SLACK_BOT_TOKEN?.trim() &&
				process.env.SLACK_TEAM_ID?.trim(),
		),
});

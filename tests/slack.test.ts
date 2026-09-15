import { afterEach, describe, expect, it, vi } from "vitest";
import { slack } from "../providers/slack.js";

const originalChannelIds = process.env.SLACK_CHANNEL_IDS;
const originalToken = process.env.SLACK_BOT_TOKEN;
const originalTeamId = process.env.SLACK_TEAM_ID;

afterEach(() => {
	if (originalChannelIds === undefined) {
		delete process.env.SLACK_CHANNEL_IDS;
	} else {
		process.env.SLACK_CHANNEL_IDS = originalChannelIds;
	}
	if (originalToken === undefined) {
		delete process.env.SLACK_BOT_TOKEN;
	} else {
		process.env.SLACK_BOT_TOKEN = originalToken;
	}
	if (originalTeamId === undefined) {
		delete process.env.SLACK_TEAM_ID;
	} else {
		process.env.SLACK_TEAM_ID = originalTeamId;
	}
	vi.unstubAllGlobals();
});

describe("Slack provider", () => {
	it("assigns explicit read and write risk levels", () => {
		const risks = Object.fromEntries(
			slack.tools.map((definition) => [definition.name, definition.risk]),
		);
		expect(risks["slack.list_channels"]).toBe("read");
		expect(risks["slack.get_channel_history"]).toBe("read");
		expect(risks["slack.get_users"]).toBe("read");
		expect(risks["slack.post_message"]).toBe("write");
		expect(risks["slack.add_reaction"]).toBe("write");
	});

	it("enforces the channel allowlist for write calls", async () => {
		process.env.SLACK_CHANNEL_IDS = "C_ALLOWED";
		const handler = slack.tools.find(
			(definition) => definition.name === "slack.post_message",
		)!.handler;
		const result = await handler(
			{ channel_id: "C_BLOCKED", text: "hello" },
			{ caller: { id: 1, role: "admin" } },
		);
		expect(result.isError).toBe(true);
		expect(
			result.content[0]?.type === "text" ? result.content[0].text : undefined,
		).toContain("not allowed");
	});

	it("marks Slack API errors as tool errors", async () => {
		process.env.SLACK_BOT_TOKEN = "xoxb-test";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(JSON.stringify({ ok: false, error: "not_in_channel" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		);
		const handler = slack.tools.find(
			(definition) => definition.name === "slack.get_users",
		)!.handler;
		const result = await handler({}, { caller: { id: 1, role: "admin" } });
		expect(result.isError).toBe(true);
		expect(
			result.content[0]?.type === "text" ? result.content[0].text : undefined,
		).toContain("not_in_channel");
	});

	it("rejects a token from a different workspace", async () => {
		process.env.SLACK_BOT_TOKEN = "xoxb-test";
		process.env.SLACK_TEAM_ID = "T_EXPECTED";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(JSON.stringify({ ok: true, team_id: "T_OTHER" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		);
		await expect(slack.initialize?.()).rejects.toThrow(
			"token belongs to team T_OTHER",
		);
	});
});

import { defineInlineProvider, tool } from "../toolshed/provider.js";
import type { ToolCallResult } from "../toolshed/types.js";

const objectSchema = (
	properties: Record<string, unknown>,
	required: string[] = [],
) => ({
	type: "object",
	properties,
	...(required.length ? { required } : {}),
	additionalProperties: false,
});

const channelId = { type: "string", minLength: 1 };
const text = { type: "string", minLength: 1 };
const limit = { type: "integer", minimum: 1, maximum: 200, default: 100 };

export const slack = defineInlineProvider({
	id: "slack",
	toolPrefix: "slack",
	risk: "write",
	tags: ["comms"],
	timeoutMs: 30_000,
	enabled: () =>
		Boolean(
			process.env.SLACK_BOT_TOKEN?.trim() &&
				process.env.SLACK_TEAM_ID?.trim(),
		),
	initialize: (signal) => verifySlackWorkspace(signal),
	tools: [
		tool({
			name: "slack.list_channels",
			description: "List accessible Slack channels with pagination",
			inputSchema: objectSchema({
				limit,
				cursor: { type: "string" },
			}),
			risk: "read",
			tags: ["comms"],
			handler: async (args, ctx) => {
				const allowed = allowedChannelIds();
				if (allowed.length) {
					const channels = await Promise.all(
						allowed.map((channel) =>
							slackRequest(
								"conversations.info",
								{ channel },
								"GET",
								ctx.signal,
							),
						),
					);
					const failure = channels.find((entry) => entry.ok !== true);
					if (failure) {
						return slackResult(failure);
					}
					return slackResult({
						ok: true,
						channels: channels
							.filter((entry) => entry.ok && entry.channel)
							.map((entry) => entry.channel),
						response_metadata: { next_cursor: "" },
					});
				}
				return slackResult(
					await slackRequest(
						"conversations.list",
						{
							types: "public_channel",
							exclude_archived: true,
							limit: args.limit ?? 100,
							team_id: process.env.SLACK_TEAM_ID,
							...(args.cursor ? { cursor: args.cursor } : {}),
						},
						"GET",
						ctx.signal,
					),
				);
			},
		}),
		tool({
			name: "slack.post_message",
			description: "Post a new message to a Slack channel",
			inputSchema: objectSchema(
				{ channel_id: channelId, text },
				["channel_id", "text"],
			),
			risk: "write",
			tags: ["comms"],
			handler: async (args, ctx) =>
				channelCall(
					String(args.channel_id),
					"chat.postMessage",
					{ channel: args.channel_id, text: args.text },
					ctx.signal,
				),
		}),
		tool({
			name: "slack.reply_to_thread",
			description: "Reply to a Slack message thread",
			inputSchema: objectSchema(
				{
					channel_id: channelId,
					thread_ts: { type: "string", minLength: 1 },
					text,
				},
				["channel_id", "thread_ts", "text"],
			),
			risk: "write",
			tags: ["comms"],
			handler: async (args, ctx) =>
				channelCall(
					String(args.channel_id),
					"chat.postMessage",
					{
						channel: args.channel_id,
						thread_ts: args.thread_ts,
						text: args.text,
					},
					ctx.signal,
				),
		}),
		tool({
			name: "slack.add_reaction",
			description: "Add a reaction emoji to a Slack message",
			inputSchema: objectSchema(
				{
					channel_id: channelId,
					timestamp: { type: "string", minLength: 1 },
					reaction: { type: "string", minLength: 1 },
				},
				["channel_id", "timestamp", "reaction"],
			),
			risk: "write",
			tags: ["comms"],
			handler: async (args, ctx) =>
				channelCall(
					String(args.channel_id),
					"reactions.add",
					{
						channel: args.channel_id,
						timestamp: args.timestamp,
						name: args.reaction,
					},
					ctx.signal,
				),
		}),
		tool({
			name: "slack.get_channel_history",
			description: "Get recent messages from a Slack channel",
			inputSchema: objectSchema(
				{ channel_id: channelId, limit: { ...limit, default: 10 } },
				["channel_id"],
			),
			risk: "read",
			tags: ["comms"],
			handler: async (args, ctx) =>
				channelCall(
					String(args.channel_id),
					"conversations.history",
					{ channel: args.channel_id, limit: args.limit ?? 10 },
					ctx.signal,
					"GET",
				),
		}),
		tool({
			name: "slack.get_thread_replies",
			description: "Get all replies in a Slack message thread",
			inputSchema: objectSchema(
				{
					channel_id: channelId,
					thread_ts: { type: "string", minLength: 1 },
				},
				["channel_id", "thread_ts"],
			),
			risk: "read",
			tags: ["comms"],
			handler: async (args, ctx) =>
				channelCall(
					String(args.channel_id),
					"conversations.replies",
					{ channel: args.channel_id, ts: args.thread_ts },
					ctx.signal,
					"GET",
				),
		}),
		tool({
			name: "slack.get_users",
			description: "List Slack workspace users",
			inputSchema: objectSchema({
				limit,
				cursor: { type: "string" },
			}),
			risk: "read",
			tags: ["comms"],
			handler: async (args, ctx) =>
				slackResult(
					await slackRequest(
						"users.list",
						{
							limit: args.limit ?? 100,
							team_id: process.env.SLACK_TEAM_ID,
							...(args.cursor ? { cursor: args.cursor } : {}),
						},
						"GET",
						ctx.signal,
					),
				),
		}),
		tool({
			name: "slack.get_user_profile",
			description: "Get a Slack user's profile",
			inputSchema: objectSchema(
				{ user_id: { type: "string", minLength: 1 } },
				["user_id"],
			),
			risk: "read",
			tags: ["comms"],
			handler: async (args, ctx) =>
				slackResult(
					await slackRequest(
						"users.profile.get",
						{ user: args.user_id, include_labels: true },
						"GET",
						ctx.signal,
					),
				),
		}),
	],
});

async function channelCall(
	channel: string,
	method: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
	httpMethod: "GET" | "POST" = "POST",
): Promise<ToolCallResult> {
	const allowed = allowedChannelIds();
	if (allowed.length && !allowed.includes(channel)) {
		return {
			content: [{ type: "text", text: `Slack channel ${channel} is not allowed` }],
			isError: true,
		};
	}
	return slackResult(await slackRequest(method, args, httpMethod, signal));
}

async function slackRequest(
	method: string,
	args: Record<string, unknown>,
	httpMethod: "GET" | "POST",
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const token = process.env.SLACK_BOT_TOKEN?.trim();
	if (!token) {
		throw new Error("SLACK_BOT_TOKEN is required");
	}
	const headers = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json; charset=utf-8",
	};
	const url = new URL(`https://slack.com/api/${method}`);
	if (httpMethod === "GET") {
		for (const [key, value] of Object.entries(args)) {
			if (value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		}
	}
	const response = await fetch(url, {
		method: httpMethod,
		headers,
		...(httpMethod === "POST" ? { body: JSON.stringify(args) } : {}),
		signal,
	});
	const payload = (await response.json()) as Record<string, unknown>;
	if (!response.ok) {
		return {
			ok: false,
			error: `Slack HTTP ${response.status}`,
			detail: payload,
		};
	}
	return payload;
}

function slackResult(payload: Record<string, unknown>): ToolCallResult {
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		isError: payload.ok !== true,
	};
}

function allowedChannelIds(): string[] {
	return (process.env.SLACK_CHANNEL_IDS ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
}

async function verifySlackWorkspace(signal?: AbortSignal): Promise<void> {
	const expectedTeamId = process.env.SLACK_TEAM_ID?.trim();
	if (!expectedTeamId) {
		throw new Error("SLACK_TEAM_ID is required");
	}
	const payload = await slackRequest(
		"auth.test",
		{},
		"POST",
		signal
			? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
			: AbortSignal.timeout(10_000),
	);
	if (payload.ok !== true) {
		throw new Error(`Slack authentication failed: ${String(payload.error)}`);
	}
	if (payload.team_id !== expectedTeamId) {
		throw new Error(
			`Slack token belongs to team ${String(payload.team_id)}, expected ${expectedTeamId}`,
		);
	}
}

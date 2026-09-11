import { defineInlineProvider, tool } from "../toolshed/provider.js";

export const custom = defineInlineProvider({
	id: "custom",
	toolPrefix: "custom",
	risk: "read",
	tags: ["support"],
	enabled: () =>
		Boolean(
			process.env.TICKET_API_URL?.trim() &&
				process.env.TICKET_API_KEY?.trim(),
		),
	tools: [
		tool({
			name: "custom.ticket.lookup",
			description: "Look up an internal support ticket by ID",
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "Ticket ID" },
				},
				required: ["id"],
			},
			risk: "read",
			tags: ["support"],
			async handler({ id }, ctx) {
				const base = process.env.TICKET_API_URL?.trim();
				const key = process.env.TICKET_API_KEY?.trim();
				if (!base || !key) {
					return {
						content: [
							{
								type: "text",
								text: "TICKET_API_URL and TICKET_API_KEY must be set",
							},
						],
						isError: true,
					};
				}
				const res = await fetch(
					`${base.replace(/\/$/, "")}/tickets/${encodeURIComponent(String(id))}`,
					{
						headers: { Authorization: `Bearer ${key}` },
						signal: ctx.signal,
					},
				);
				if (!res.ok) {
					return {
						content: [
							{
								type: "text",
								text: `ticket API request failed (${res.status})`,
							},
						],
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: await res.text() }],
				};
			},
		}),
	],
});

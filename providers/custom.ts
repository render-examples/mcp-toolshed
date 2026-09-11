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
			async handler({ id }, _ctx) {
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
				const res = await fetch(`${base}/tickets/${encodeURIComponent(String(id))}`, {
					headers: { Authorization: `Bearer ${key}` },
				});
				return {
					content: [{ type: "text", text: await res.text() }],
					isError: !res.ok,
				};
			},
		}),
	],
});

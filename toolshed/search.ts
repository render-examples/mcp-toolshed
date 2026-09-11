import type { SearchResult, ToolDefinition } from "./types.js";

export function rankByQuery(
	tools: ToolDefinition[],
	query: string,
	limit = 10,
): SearchResult[] {
	const terms = query
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 1);

	const scored = tools.map((tool) => {
		const haystack =
			`${tool.name} ${tool.description} ${tool.tags.join(" ")}`.toLowerCase();
		let score = 0;
		for (const term of terms) {
			if (tool.name.toLowerCase().includes(term)) {
				score += 4;
			}
			if (tool.description.toLowerCase().includes(term)) {
				score += 2;
			}
			if (tool.tags.some((tag) => tag.includes(term))) {
				score += 1;
			}
			if (haystack.includes(term)) {
				score += 1;
			}
		}
		return { tool, score };
	});

	return scored
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
		.slice(0, limit)
		.map(({ tool }) => ({
			name: tool.name,
			description: tool.description,
			risk: tool.risk,
			tags: tool.tags,
		}));
}

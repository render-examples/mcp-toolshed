import { McpRemoteClient } from "../toolshed/mcp-client.js";

const URL =
	process.env.TOOLSHED_URL?.trim() ?? "https://mcp-toolshed.onrender.com/mcp";

interface SearchHit {
	name: string;
	description?: string;
	risk?: string;
}

interface Expectation {
	label: string;
	key: string | undefined;
	run: (client: McpRemoteClient) => Promise<void>;
}

function clientFor(key: string): McpRemoteClient {
	return new McpRemoteClient(URL, { Authorization: `Bearer ${key}` });
}

async function search(
	client: McpRemoteClient,
	query: string,
): Promise<SearchHit[]> {
	const result = await client.callTool("search_tools", { query, limit: 30 });
	const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
		results?: SearchHit[];
	};
	return payload.results ?? [];
}

async function schemaAllowed(
	client: McpRemoteClient,
	name: string,
): Promise<boolean> {
	const result = await client.callTool("get_tool_schema", { name });
	return !result.isError;
}

async function callAllowed(
	client: McpRemoteClient,
	name: string,
): Promise<boolean> {
	const result = await client.callTool(name, {});
	if (result.isError && result.content[0]?.text.includes("Access denied")) {
		return false;
	}
	// Upstream validation errors still mean RBAC allowed the call.
	return true;
}

function pick(
	hits: SearchHit[],
	predicate: (hit: SearchHit) => boolean,
): SearchHit | undefined {
	return hits.find(predicate);
}

async function main(): Promise<void> {
	const adminKey = process.env.TOOLSHED_API_KEY?.trim();
	const analystKey = process.env.TOOLSHED_KEY_ANALYST?.trim();
	const implementerKey = process.env.TOOLSHED_KEY_IMPLEMENTER?.trim();
	const deployManagerKey = process.env.TOOLSHED_KEY_DEPLOY_MANAGER?.trim();

	if (!adminKey) {
		console.error("Set TOOLSHED_API_KEY (admin) to run live RBAC tests.");
		process.exit(1);
	}

	const expectations: Expectation[] = [
		{
			label: "admin connects and lists meta-tools",
			key: adminKey,
			run: async (client) => {
				const tools = await client.listTools();
				const names = tools.map((t) => t.name).sort();
				if (!names.includes("search_tools") || !names.includes("get_tool_schema")) {
					throw new Error(`expected meta-tools, got ${names.join(", ")}`);
				}
			},
		},
		{
			label: "admin search spans render + github",
			key: adminKey,
			run: async (client) => {
				const hits = await search(client, "list services pull request");
				const prefixes = new Set(hits.map((h) => h.name.split(".")[0]));
				if (!prefixes.has("render") || !prefixes.has("github")) {
					throw new Error(
						`expected render + github in search, got ${[...prefixes].join(", ")}`,
					);
				}
			},
		},
	];

	if (analystKey) {
		expectations.push(
			{
				label: "analyst discovers read tools",
				key: analystKey,
				run: async (client) => {
					const hits = await search(client, "list render services");
					const readTool = pick(
						hits,
						(h) => h.name.startsWith("render.") && h.risk === "read",
					);
					if (!readTool) {
						throw new Error("analyst should discover render read tools");
					}
				},
			},
			{
				label: "analyst denied write tool schema",
				key: analystKey,
				run: async (client) => {
					const hits = await search(client, "create render web service");
					const writeTool = pick(
						hits,
						(h) => h.name.startsWith("render.") && h.risk === "write",
					);
					const target =
						writeTool?.name ??
						"render.create_web_service";
					if (await schemaAllowed(client, target)) {
						throw new Error(`analyst should not view schema for ${target}`);
					}
				},
			},
			{
				label: "analyst denied write tool execution",
				key: analystKey,
				run: async (client) => {
					const adminHits = await search(clientFor(adminKey!), "create render");
					const writeTool = pick(
						adminHits,
						(h) => h.name.startsWith("render.") && h.risk === "write",
					);
					if (!writeTool) {
						throw new Error("could not find render write tool via admin search");
					}
					if (await callAllowed(client, writeTool.name)) {
						throw new Error(
							`analyst should not execute ${writeTool.name}`,
						);
					}
				},
			},
		);
	}

	if (implementerKey) {
		expectations.push(
			{
				label: "implementer can discover github write tools",
				key: implementerKey,
				run: async (client) => {
					const hits = await search(client, "github pull request");
					if (!hits.some((h) => h.name.startsWith("github."))) {
						throw new Error("implementer should discover github tools");
					}
				},
			},
			{
				label: "implementer denied render write execution",
				key: implementerKey,
				run: async (client) => {
					const adminHits = await search(clientFor(adminKey!), "create render");
					const writeTool = pick(
						adminHits,
						(h) => h.name.startsWith("render.") && h.risk === "write",
					);
					if (!writeTool) {
						throw new Error("could not find render write tool via admin search");
					}
					if (await callAllowed(client, writeTool.name)) {
						throw new Error(
							`implementer should not execute ${writeTool.name}`,
						);
					}
				},
			},
		);
	}

	if (deployManagerKey) {
		expectations.push(
			{
				label: "deploy-manager limited to render in search",
				key: deployManagerKey,
				run: async (client) => {
					const hits = await search(client, "github pull request slack message");
					if (hits.some((h) => h.name.startsWith("github."))) {
						throw new Error("deploy-manager should not discover github tools");
					}
					const renderHits = await search(client, "list render services");
					if (!renderHits.some((h) => h.name.startsWith("render."))) {
						throw new Error("deploy-manager should discover render tools");
					}
				},
			},
		);
	}

	let passed = 0;
	let failed = 0;
	let skipped = 0;

	for (const test of expectations) {
		if (!test.key) {
			console.log(`SKIP  ${test.label}`);
			skipped++;
			continue;
		}
		try {
			await test.run(clientFor(test.key));
			console.log(`PASS  ${test.label}`);
			passed++;
		} catch (error) {
			console.log(`FAIL  ${test.label}`);
			console.log(`      ${error instanceof Error ? error.message : error}`);
			failed++;
		}
	}

	console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);

	if (!analystKey || !implementerKey || !deployManagerKey) {
		console.log(
			"\nTip: run `npm run rbac:seed-keys`, insert SQL into Postgres, export the keys, then re-run.",
		);
	}

	process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

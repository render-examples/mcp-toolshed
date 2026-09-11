import type { ProviderConfig } from "../toolshed/types.js";
import { custom } from "./custom.js";
import { github } from "./github.js";
import { render } from "./render.js";
import { slack } from "./slack.js";

export const providerConfigs: ProviderConfig[] = [render, github, slack, custom];

export async function loadRegistry() {
	const { createRegistry } = await import("../toolshed/registry.js");
	return createRegistry(providerConfigs);
}

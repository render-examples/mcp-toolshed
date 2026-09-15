import type { ToolPolicyManifest } from "../toolshed/types.js";

const renderRead = (requiredArguments: string[] = ["workspaceId"]) => ({
	risk: "read" as const,
	tags: ["deploy", "infra"],
	requiredArguments,
});

const renderWrite = (requiredArguments: string[] = ["workspaceId"]) => ({
	risk: "write" as const,
	tags: ["deploy", "infra"],
	requiredArguments,
});

/**
 * Explicit upstream allowlists. Tools added or renamed upstream remain unavailable
 * until reviewed and added here.
 */
export const renderToolPolicy: ToolPolicyManifest = {
	create_cron_job: renderWrite(),
	create_key_value: renderWrite(),
	create_postgres: renderWrite(),
	create_static_site: renderWrite(),
	create_web_service: renderWrite(),
	get_deploy: renderRead(),
	get_key_value: renderRead(),
	get_metrics: renderRead(),
	get_postgres: renderRead(),
	get_service: renderRead(),
	list_deploys: renderRead(),
	list_key_value: renderRead(),
	list_log_label_values: renderRead(),
	list_logs: renderRead(),
	list_postgres_instances: renderRead(),
	list_services: renderRead(),
	list_workspaces: renderRead([]),
	trigger_deploy: renderWrite(),
	update_environment_variables: renderWrite(),
};

const githubRead = {
	risk: "read" as const,
	tags: ["code", "pr"],
};

const githubWrite = {
	risk: "write" as const,
	tags: ["code", "pr"],
};

export const githubToolPolicy: ToolPolicyManifest = {
	get_me: githubRead,
	get_file_contents: githubRead,
	list_branches: githubRead,
	list_commits: githubRead,
	list_issues: githubRead,
	list_pull_requests: githubRead,
	issue_read: githubRead,
	pull_request_read: githubRead,
	search_code: githubRead,
	search_issues: githubRead,
	search_pull_requests: githubRead,
	search_repositories: githubRead,
	add_issue_comment: githubWrite,
	create_branch: githubWrite,
	create_or_update_file: githubWrite,
	create_pull_request: githubWrite,
	fork_repository: githubWrite,
	push_files: githubWrite,
	update_pull_request: githubWrite,
};

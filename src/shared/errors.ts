export type ErrorCategory =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_front_matter_not_a_map"
  | "template_parse_error"
  | "template_render_error"
  | "missing_opencode_command"
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_tracker_project_slug"
  | "jira_api_request"
  | "jira_api_status"
  | "jira_graphql_errors"
  | "jira_unknown_payload"
  | "feishu_api_request"
  | "feishu_api_status"
  | "feishu_missing_credentials"
  | "feishu_cooldown"
  | "workspace_creation_failed"
  | "workspace_outside_root"
  | "workspace_key_unsafe"
  | "invalid_workspace_cwd"
  | "hook_failed"
  | "hook_timeout"
  | "worker_spawn_failed"
  | "turn_timeout"
  | "opencode_api_error"
  | "opencode_api_timeout"
  | "opencode_api_parse"
  | "prompt_too_large"
  | "opencode_unsupported_version"
  | "route_agent_timeout"
  | "route_agent_failed"
  | "inbox_error"
  | "config_validation"
  | "unknown";

export class TaskingError extends Error {
  readonly category: ErrorCategory;
  readonly details: unknown;

  constructor(category: ErrorCategory, message: string, details?: unknown) {
    super(message);
    this.name = "TaskingError";
    this.category = category;
    this.details = details;
  }

  toJSON(): { category: ErrorCategory; message: string; details?: unknown } {
    return { category: this.category, message: this.message, details: this.details };
  }
}

export function isTaskingError(e: unknown): e is TaskingError {
  return e instanceof TaskingError;
}

export function toTaskingError(e: unknown): TaskingError {
  if (e instanceof TaskingError) return e;
  if (e instanceof Error) return new TaskingError("unknown", e.message, e);
  return new TaskingError("unknown", String(e));
}

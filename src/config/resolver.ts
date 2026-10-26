import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { TaskingError } from "../shared/errors.js";
import {
  type AgentConfig,
  DEFAULTS,
  type DirectProjectConfig,
  type EffectiveConfig,
  type EnvConfig,
  type FeishuConfig,
  type FeishuEdition,
  type HooksConfig,
  type InterfaceLanguage,
  type LoggingConfig,
  type OpencodeConfig,
  type PollingConfig,
  type RouterConfig,
  type ServerConfig,
  type TrackerConfig,
  type WorkspaceConfig,
} from "./config-types.js";

const DEFAULT_ACTIVE_STATES = [...DEFAULTS.tracker.active_states];
const DEFAULT_TERMINAL_STATES = [...DEFAULTS.tracker.terminal_states];

export function resolveEnvVar(value: string): string {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
  if (!match || match[1] === undefined) return value;
  return process.env[match[1]] ?? "";
}

export function expandHome(path: string): string {
  if (path.startsWith("~")) {
    return homedir() + path.slice(1);
  }
  return path;
}

export function resolveWorkspaceRoot(raw: string | undefined, workflowDir: string): string {
  const fallback = resolvePath(workflowDir, DEFAULTS.workspace.rootFallback);
  const base = raw ?? fallback;
  const expanded = expandHome(base);
  const withEnv = resolveEnvVar(expanded);
  const resolved = isAbsolute(withEnv) ? withEnv : resolvePath(workflowDir, withEnv);
  return resolvePath(resolved);
}

function asStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is string => typeof v === "string");
}

function asNumber(value: unknown, fallback: number, min?: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (min !== undefined && value < min) return fallback;
    return value;
  }
  return fallback;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value;
}

function asEnvString(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return asStringOrNull(resolveEnvVar(value));
}

const TRACKERLESS_HINT =
  "this deployment runs Feishu direct sessions only; set kind: jira and fill the fields to re-enable the Jira source";
function resolveDirectConfig(
  raw: unknown,
  workflowDir: string,
): EffectiveConfig["feishu"]["direct"] {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULTS.feishu.direct, projects: {}, path_roots: [] };
  }
  const d = raw as Record<string, unknown>;
  const enabled = typeof d.enabled === "boolean" ? d.enabled : true;
  const projectsRaw = (d.projects as Record<string, unknown>) ?? {};
  const projects: Record<string, DirectProjectConfig> = {};
  for (const [name, val] of Object.entries(projectsRaw)) {
    if (typeof val === "string") {
      projects[name] = { path: resolveDirectPath(val, workflowDir), auto_approve: null };
      continue;
    }
    if (typeof val === "object" && val !== null) {
      const obj = val as Record<string, unknown>;
      if (typeof obj.path !== "string" || obj.path === "") {
        throw new TaskingError(
          "config_validation",
          `feishu.direct.projects.${name}: object form requires a non-empty "path" string`,
        );
      }
      projects[name] = {
        path: resolveDirectPath(obj.path, workflowDir),
        auto_approve: typeof obj.auto_approve === "boolean" ? obj.auto_approve : null,
      };
      continue;
    }
    throw new TaskingError(
      "config_validation",
      `feishu.direct.projects.${name}: value must be a path string or { path, auto_approve }`,
    );
  }
  const verbosityRaw = d.verbosity;
  if (
    verbosityRaw !== undefined &&
    verbosityRaw !== "quiet" &&
    verbosityRaw !== "summary" &&
    verbosityRaw !== "detailed"
  ) {
    throw new TaskingError(
      "config_validation",
      `feishu.direct.verbosity must be "quiet", "summary", or "detailed", got: ${String(verbosityRaw)}`,
    );
  }
  const maxConcurrentRaw = d.max_concurrent;
  if (
    maxConcurrentRaw !== undefined &&
    (typeof maxConcurrentRaw !== "number" ||
      !Number.isFinite(maxConcurrentRaw) ||
      maxConcurrentRaw < 1)
  ) {
    throw new TaskingError(
      "config_validation",
      "feishu.direct.max_concurrent must be a positive number",
    );
  }
  const idleTtlRaw = d.idle_ttl_ms;
  if (
    idleTtlRaw !== undefined &&
    (typeof idleTtlRaw !== "number" || !Number.isFinite(idleTtlRaw) || idleTtlRaw < 1)
  ) {
    throw new TaskingError(
      "config_validation",
      "feishu.direct.idle_ttl_ms must be a positive number",
    );
  }
  return {
    enabled,
    projects,
    path_roots: asStringList(d.path_roots, []).map((p) => resolveDirectPath(p, workflowDir)),
    auto_approve:
      typeof d.auto_approve === "boolean" ? d.auto_approve : DEFAULTS.feishu.direct.auto_approve,
    verbosity: verbosityRaw === "quiet" || verbosityRaw === "summary" ? verbosityRaw : "detailed",
    max_concurrent: asNumber(maxConcurrentRaw, DEFAULTS.feishu.direct.max_concurrent, 1),
    idle_ttl_ms: asNumber(idleTtlRaw, DEFAULTS.feishu.direct.idle_ttl_ms, 1),
  };
}

function resolveDirectPath(value: string, workflowDir: string): string {
  const expanded = resolveEnvVar(expandHome(value));
  return isAbsolute(expanded) ? resolvePath(expanded) : resolvePath(workflowDir, expanded);
}

function resolveFeishuEdition(raw: unknown): FeishuEdition {
  if (raw === undefined) return DEFAULTS.feishu.edition;
  if (raw === "feishu" || raw === "lark") return raw;
  throw new TaskingError(
    "config_validation",
    `feishu.edition must be "feishu" or "lark", got: ${String(raw)}`,
  );
}

function resolveTracker(raw: Record<string, unknown>): TrackerConfig {
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const apiKeyRaw = raw.api_key ?? raw.api_key_env;
  const apiKey =
    typeof apiKeyRaw === "string" && apiKeyRaw !== "" ? resolveEnvVar(apiKeyRaw) : null;
  const apiUser = asStringOrNull(raw.api_user);
  const authModeRaw = typeof raw.auth_mode === "string" ? raw.auth_mode.toLowerCase() : "basic";
  const authMode = authModeRaw === "bearer" ? "bearer" : "basic";
  return {
    kind,
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint : DEFAULTS.tracker.endpoint,
    api_key: apiKey && apiKey !== "" ? apiKey : null,
    api_user: apiUser,
    auth_mode: authMode,
    review_state: asStringOrNull(raw.review_state),
    project_key: asStringOrNull(raw.project_key),
    project_slug: asStringOrNull(raw.project_slug),
    assignee: asStringOrNull(raw.assignee),
    required_labels: asStringList(raw.required_labels, DEFAULTS.tracker.required_labels),
    active_states: asStringList(raw.active_states, DEFAULT_ACTIVE_STATES),
    terminal_states: asStringList(raw.terminal_states, DEFAULT_TERMINAL_STATES),
  };
}

function resolvePerStateConcurrency(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === "number" && val > 0) {
      out[key.toLowerCase()] = val;
    }
  }
  return out;
}

export function resolveConfig(
  config: Record<string, unknown>,
  workflowDir: string,
  promptTemplate: string,
  onWarning?: (message: string) => void,
): EffectiveConfig {
  const interfaceLanguageRaw = config.interface_language;
  if (
    interfaceLanguageRaw !== undefined &&
    interfaceLanguageRaw !== "zh" &&
    interfaceLanguageRaw !== "en"
  ) {
    throw new TaskingError(
      "config_validation",
      `interface_language must be "zh" or "en", got: ${String(interfaceLanguageRaw)}`,
    );
  }
  const interface_language: InterfaceLanguage =
    interfaceLanguageRaw === "en" ? "en" : DEFAULTS.interface_language;

  const trackerRaw = (config.tracker as Record<string, unknown>) ?? {};
  const pollingRaw = (config.polling as Record<string, unknown>) ?? {};
  const workspaceRaw = (config.workspace as Record<string, unknown>) ?? {};
  const hooksRaw = (config.hooks as Record<string, unknown>) ?? {};
  const agentRaw = (config.agent as Record<string, unknown>) ?? {};
  const opencodeRaw = (config.opencode as Record<string, unknown>) ?? {};
  const routerRaw = (config.router as Record<string, unknown>) ?? {};
  const feishuRaw = (config.feishu as Record<string, unknown>) ?? {};
  const serverRaw = (config.server as Record<string, unknown>) ?? {};

  const tracker = resolveTracker(trackerRaw);

  if (tracker.kind === "none") {
    const leftover = Object.keys(trackerRaw).filter((k) => k !== "kind");
    if (leftover.length > 0) {
      onWarning?.(
        `tracker fields ignored while kind: none: ${leftover.join(", ")} — ${TRACKERLESS_HINT}`,
      );
    }
  }

  const polling: PollingConfig = {
    interval_ms: asNumber(pollingRaw.interval_ms, DEFAULTS.polling.interval_ms, 1),
  };

  const workspace: WorkspaceConfig = {
    root: resolveWorkspaceRoot(
      typeof workspaceRaw.root === "string" ? workspaceRaw.root : undefined,
      workflowDir,
    ),
  };

  const hooks: HooksConfig = {
    after_create: asStringOrNull(hooksRaw.after_create),
    before_run: asStringOrNull(hooksRaw.before_run),
    after_run: asStringOrNull(hooksRaw.after_run),
    before_remove: asStringOrNull(hooksRaw.before_remove),
    timeout_ms: asNumber(hooksRaw.timeout_ms, DEFAULTS.hooks.timeout_ms, 1),
  };

  const agent: AgentConfig = {
    max_concurrent_agents: asNumber(
      agentRaw.max_concurrent_agents,
      DEFAULTS.agent.max_concurrent_agents,
      1,
    ),
    max_turns: asNumber(agentRaw.max_turns, DEFAULTS.agent.max_turns, 1),
    max_retry_backoff_ms: asNumber(
      agentRaw.max_retry_backoff_ms,
      DEFAULTS.agent.max_retry_backoff_ms,
      1,
    ),
    max_concurrent_agents_by_state: resolvePerStateConcurrency(
      agentRaw.max_concurrent_agents_by_state,
    ),
  };

  const opencode: OpencodeConfig = {
    command:
      typeof opencodeRaw.command === "string" ? opencodeRaw.command : DEFAULTS.opencode.command,
    agent: typeof opencodeRaw.agent === "string" ? opencodeRaw.agent : DEFAULTS.opencode.agent,
    agents: asStringList(opencodeRaw.agents, DEFAULTS.opencode.agents),
    model: asStringOrNull(opencodeRaw.model),
    variant: asStringOrNull(opencodeRaw.variant),
    turn_timeout_ms: asNumber(opencodeRaw.turn_timeout_ms, DEFAULTS.opencode.turn_timeout_ms, 1),
    stall_timeout_ms: asNumber(opencodeRaw.stall_timeout_ms, DEFAULTS.opencode.stall_timeout_ms, 0),
    inactivity_timeout_ms: asNumber(
      opencodeRaw.inactivity_timeout_ms,
      DEFAULTS.opencode.inactivity_timeout_ms,
      0,
    ),
    auto_approve:
      typeof opencodeRaw.auto_approve === "boolean"
        ? opencodeRaw.auto_approve
        : DEFAULTS.opencode.auto_approve,
    poll_interval_ms: asNumber(opencodeRaw.poll_interval_ms, DEFAULTS.opencode.poll_interval_ms, 1),
    permission_timeout_ms: asNumber(
      opencodeRaw.permission_timeout_ms,
      DEFAULTS.opencode.permission_timeout_ms,
      1,
    ),
    server_url: asStringOrNull(opencodeRaw.server_url),
  };

  const router: RouterConfig = {
    enabled: typeof routerRaw.enabled === "boolean" ? routerRaw.enabled : DEFAULTS.router.enabled,
    agent: typeof routerRaw.agent === "string" ? routerRaw.agent : DEFAULTS.router.agent,
    batch_size: asNumber(routerRaw.batch_size, DEFAULTS.router.batch_size),
    timeout_ms: asNumber(routerRaw.timeout_ms, DEFAULTS.router.timeout_ms),
  };

  if (feishuRaw.poll_interval_ms !== undefined) {
    onWarning?.(
      "feishu.poll_interval_ms is deprecated and ignored: use feishu.forward_interval_ms " +
        "(default 5000) for the Jira→Feishu mirror cadence; Feishu receive is event-driven and " +
        "feishu.sweep_interval_ms (default 12h) controls the loss backstop. Update WORKFLOW.md. " +
        "See docs/configuration.md",
    );
  }

  const feishu: FeishuConfig = {
    enabled: typeof feishuRaw.enabled === "boolean" ? feishuRaw.enabled : DEFAULTS.feishu.enabled,
    edition: resolveFeishuEdition(feishuRaw.edition),
    app_id: asEnvString(feishuRaw.app_id),
    app_secret: asEnvString(feishuRaw.app_secret),
    verification_token: asEnvString(feishuRaw.verification_token),
    encrypt_key: asEnvString(feishuRaw.encrypt_key),
    intake_chat_id: asEnvString(feishuRaw.intake_chat_id),
    forward_interval_ms: asNumber(
      feishuRaw.forward_interval_ms,
      DEFAULTS.feishu.forward_interval_ms,
      1,
    ),
    sweep_interval_ms: asNumber(feishuRaw.sweep_interval_ms, DEFAULTS.feishu.sweep_interval_ms, 1),
    create_issue_type: asStringOrNull(feishuRaw.create_issue_type),
    direct: resolveDirectConfig(feishuRaw.direct, workflowDir),
  };

  const server: ServerConfig = {
    port: typeof serverRaw.port === "number" ? serverRaw.port : DEFAULTS.server.port,
    host: typeof serverRaw.host === "string" ? serverRaw.host : DEFAULTS.server.host,
  };

  const loggingRaw = (config.logging as Record<string, unknown>) ?? {};
  const fileRaw = (loggingRaw.file as Record<string, unknown>) ?? {};
  const logging: LoggingConfig = {
    file: {
      path: typeof fileRaw.path === "string" && fileRaw.path !== "" ? fileRaw.path : null,
      max_bytes: asNumber(fileRaw.max_bytes, DEFAULTS.logging.file.max_bytes, 1),
      max_files: asNumber(fileRaw.max_files, DEFAULTS.logging.file.max_files, 1),
    },
  };

  const envRaw = (config.env as Record<string, unknown>) ?? {};
  const env: EnvConfig = {};
  for (const [key, val] of Object.entries(envRaw)) {
    if (typeof val === "string") {
      env[key] = resolveEnvVar(val);
    }
  }

  return {
    interface_language,
    tracker,
    polling,
    workspace,
    hooks,
    agent,
    opencode,
    router,
    feishu,
    server,
    logging,
    env,
    prompt_template: promptTemplate,
  };
}

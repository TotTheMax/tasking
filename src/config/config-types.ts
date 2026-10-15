import type { WorkflowDefinition } from "../shared/types.js";

export interface TrackerConfig {
  kind: string;
  endpoint: string;
  api_key: string | null;
  api_user: string | null;
  auth_mode: "basic" | "bearer";
  review_state: string | null;
  project_key: string | null;
  project_slug: string | null;
  assignee: string | null;
  required_labels: string[];
  active_states: string[];
  terminal_states: string[];
}

export interface PollingConfig {
  interval_ms: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  after_create: string | null;
  before_run: string | null;
  after_run: string | null;
  before_remove: string | null;
  timeout_ms: number;
}

export interface AgentConfig {
  max_concurrent_agents: number;
  max_turns: number;
  max_retry_backoff_ms: number;
  max_concurrent_agents_by_state: Record<string, number>;
}

export interface OpencodeConfig {
  command: string;
  agent: string;
  agents: string[];
  model: string | null;
  variant: string | null;
  turn_timeout_ms: number;
  stall_timeout_ms: number;
  inactivity_timeout_ms: number;
  auto_approve: boolean;
  poll_interval_ms: number;
  permission_timeout_ms: number;
  server_url: string | null;
}

export interface RouterConfig {
  enabled: boolean;
  agent: string;
  batch_size: number;
  timeout_ms: number;
}

export interface DirectProjectConfig {
  path: string;
  auto_approve: boolean | null;
}

export type DirectVerbosity = "quiet" | "summary" | "detailed";

export interface DirectConfig {
  enabled: boolean;
  projects: Record<string, DirectProjectConfig>;
  path_roots: string[];
  auto_approve: boolean;
  verbosity: DirectVerbosity;
  max_concurrent: number;
  idle_ttl_ms: number;
}

export type FeishuEdition = "feishu" | "lark";

export interface FeishuConfig {
  enabled: boolean;
  edition: FeishuEdition;
  app_id: string | null;
  app_secret: string | null;
  verification_token: string | null;
  encrypt_key: string | null;
  intake_chat_id: string | null;
  forward_interval_ms: number;
  sweep_interval_ms: number;
  create_issue_type: string | null;
  direct: DirectConfig;
}

export interface ServerConfig {
  port: number | null;
  host: string;
}

export type EnvConfig = Record<string, string>;

export interface LoggingFileConfig {
  path: string | null;
  max_bytes: number;
  max_files: number;
}

export interface LoggingConfig {
  file: LoggingFileConfig;
}

export type InterfaceLanguage = "zh" | "en";

export interface EffectiveConfig {
  interface_language: InterfaceLanguage;
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  opencode: OpencodeConfig;
  router: RouterConfig;
  feishu: FeishuConfig;
  server: ServerConfig;
  logging: LoggingConfig;
  env: EnvConfig;
  prompt_template: string;
}

export const DEFAULTS = {
  interface_language: "zh" as InterfaceLanguage,
  tracker: {
    endpoint: "https://your-domain.atlassian.net/rest/api/3",
    required_labels: [] as string[],
    active_states: ["To Do", "In Progress"],
    terminal_states: ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"],
  },
  polling: {
    interval_ms: 30000,
  },
  workspace: {
    rootFallback: "tasking_workspaces",
  },
  hooks: {
    timeout_ms: 60000,
  },
  agent: {
    max_concurrent_agents: 10,
    max_turns: 20,
    max_retry_backoff_ms: 300000,
    max_concurrent_agents_by_state: {} as Record<string, number>,
  },
  opencode: {
    command: "opencode",
    agent: "build",
    agents: [] as string[],
    model: null as string | null,
    variant: null as string | null,
    turn_timeout_ms: 3600000,
    stall_timeout_ms: 7200000,
    inactivity_timeout_ms: 600000,
    auto_approve: true,
    poll_interval_ms: 2000,
    permission_timeout_ms: 1800000,
    server_url: null as string | null,
  },
  router: {
    enabled: false,
    agent: "triage",
    batch_size: 20,
    timeout_ms: 120000,
  },
  feishu: {
    enabled: false,
    edition: "feishu" as FeishuEdition,
    intake_chat_id: null as string | null,
    forward_interval_ms: 5000,
    sweep_interval_ms: 43200000,
    create_issue_type: null as string | null,
    direct: {
      enabled: true,
      projects: {} as Record<string, DirectProjectConfig>,
      path_roots: [] as string[],
      auto_approve: false,
      verbosity: "detailed" as DirectVerbosity,
      max_concurrent: 5,
      idle_ttl_ms: 30 * 24 * 60 * 60 * 1000,
    },
  },
  server: {
    port: null as number | null,
    host: "0.0.0.0",
  },
  logging: {
    file: {
      path: null as string | null,
      max_bytes: 10485760,
      max_files: 5,
    },
  },
  env: {} as EnvConfig,
} as const;

export type { WorkflowDefinition };

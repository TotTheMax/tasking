import { feishuApiBase } from "../adapters/feishu/probe.js";
import type { EffectiveConfig } from "../config/config-types.js";

export const MASKED = "****";

const SECRET_KEYS = new Set(["api_key", "app_secret", "verification_token", "encrypt_key"]);

export const CONFIG_SECTIONS = [
  "tracker",
  "polling",
  "workspace",
  "hooks",
  "agent",
  "opencode",
  "router",
  "feishu",
  "server",
  "logging",
  "env",
] as const;

export interface ConfigRuntimeInfo {
  pid: number | null;
  started_at: number | null;
  workflow_path: string | null;
  workspace_root: string | null;
  log_path: string | null;
  host: string | null;
  port: number | null;
}

export interface ConfigView {
  config: Record<string, unknown>;
  runtime: ConfigRuntimeInfo;
}

function maskSecrets<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_KEYS.has(key)) {
      out[key] = value === null || value === undefined ? value : MASKED;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = maskSecrets(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function maskEnv(env: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(env)) {
    out[key] = MASKED;
  }
  return out;
}

export function serializeConfig(config: EffectiveConfig): Record<string, unknown> {
  return {
    interface_language: config.interface_language,
    tracker: maskSecrets(config.tracker),
    polling: { ...config.polling },
    workspace: { ...config.workspace },
    hooks: maskSecrets(config.hooks),
    agent: maskSecrets(config.agent),
    opencode: maskSecrets(config.opencode),
    router: { ...config.router },
    feishu: {
      ...maskSecrets(config.feishu),
      api_base: feishuApiBase(config.feishu.edition),
    },
    server: { ...config.server },
    logging: maskSecrets(config.logging),
    env: maskEnv(config.env),
  };
}

export function buildConfigView(config: EffectiveConfig, runtime: ConfigRuntimeInfo): ConfigView {
  return { config: serializeConfig(config), runtime };
}

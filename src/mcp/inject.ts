import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrackerConfig } from "../config/config-types.js";
import { resolveEnvVar } from "../config/resolver.js";

export function getMcpServerScriptPath(): string {
  return resolveMcpServerScriptPath([
    fileURLToPath(new URL("../mcp/jira-server.js", import.meta.url)),
    fileURLToPath(new URL("../../dist/mcp/jira-server.js", import.meta.url)),
  ]);
}

export function resolveMcpServerScriptPath(candidates: string[]): string {
  return candidates.find((p) => existsSync(p)) ?? candidates[0] ?? "";
}

export function buildMcpConfig(tracker: TrackerConfig): Record<string, unknown> {
  const scriptPath = getMcpServerScriptPath();
  const endpoint = tracker.endpoint;
  const apiKey = tracker.api_key ?? "";
  const apiUser = tracker.api_user ?? "";
  const authMode = tracker.auth_mode;
  return {
    mcp: {
      servers: {
        jira: {
          type: "local",
          command: ["node", scriptPath],
          environment: {
            JIRA_ENDPOINT: endpoint,
            JIRA_AUTH_MODE: authMode,
            JIRA_API_KEY: apiKey,
            JIRA_API_USER: apiUser,
          },
          codemode: true,
        },
      },
    },
  };
}

export function injectMcpConfig(workspacePath: string, tracker: TrackerConfig): void {
  const opencodeDir = join(workspacePath, ".opencode");
  const configPath = join(opencodeDir, "opencode.json");

  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  } else {
    if (!existsSync(opencodeDir)) {
      mkdirSync(opencodeDir, { recursive: true });
    }
  }

  const mcpConfig = buildMcpConfig(tracker);
  const existingMcp = (existing.mcp as Record<string, unknown>) ?? {};
  delete existingMcp.jira;
  const existingServers = (existingMcp.servers as Record<string, unknown>) ?? {};
  const newServers = (mcpConfig.mcp as Record<string, unknown>).servers as Record<string, unknown>;
  existingMcp.servers = { ...existingServers, ...newServers };
  existing.mcp = existingMcp;

  writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
}

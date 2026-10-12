import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrackerConfig } from "../config/config-types.js";
import { resolveEnvVar } from "../config/resolver.js";

export function getMcpServerScriptPath(): string {
  const url = new URL("../mcp/jira-server.js", import.meta.url);
  return fileURLToPath(url);
}

export function buildMcpConfig(tracker: TrackerConfig): Record<string, unknown> {
  const scriptPath = getMcpServerScriptPath();
  const endpoint = tracker.endpoint;
  const apiKey = tracker.api_key ?? "";
  const apiUser = tracker.api_user ?? "";
  const authMode = tracker.auth_mode;
  return {
    mcp: {
      jira: {
        type: "local",
        command: ["node", scriptPath],
        environment: {
          JIRA_ENDPOINT: endpoint,
          JIRA_AUTH_MODE: authMode,
          JIRA_API_KEY: apiKey,
          JIRA_API_USER: apiUser,
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
  existing.mcp = { ...existingMcp, ...(mcpConfig.mcp as Record<string, unknown>) };

  writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
}

import { existsSync } from "node:fs";

export interface E2ECreds {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuIntakeChatId: string;
  jiraEndpoint: string;
  jiraApiKey: string;
  jiraProjectKey: string;
}

export const E2E_DEFAULTS: E2ECreds = {
  feishuAppId: "",
  feishuAppSecret: "",
  feishuIntakeChatId: "",
  jiraEndpoint: "",
  jiraApiKey: "",
  jiraProjectKey: "",
};

export function resolveE2ECreds(env: Record<string, string | undefined>): E2ECreds {
  return {
    feishuAppId: env.FEISHU_E2E_APP_ID ?? E2E_DEFAULTS.feishuAppId,
    feishuAppSecret: env.FEISHU_E2E_APP_SECRET ?? E2E_DEFAULTS.feishuAppSecret,
    feishuIntakeChatId: env.FEISHU_E2E_INTAKE_CHAT_ID ?? E2E_DEFAULTS.feishuIntakeChatId,
    jiraEndpoint: env.JIRA_E2E_ENDPOINT ?? E2E_DEFAULTS.jiraEndpoint,
    jiraApiKey: env.JIRA_E2E_API_KEY ?? E2E_DEFAULTS.jiraApiKey,
    jiraProjectKey: env.JIRA_E2E_PROJECT_KEY ?? E2E_DEFAULTS.jiraProjectKey,
  };
}

export function loadE2ECredsEnvFile(path = ".env"): boolean {
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}

export function missingE2ECreds(creds: E2ECreds): string[] {
  const missing: string[] = [];
  const keyMap: Record<keyof E2ECreds, string> = {
    feishuAppId: "FEISHU_E2E_APP_ID",
    feishuAppSecret: "FEISHU_E2E_APP_SECRET",
    feishuIntakeChatId: "FEISHU_E2E_INTAKE_CHAT_ID",
    jiraEndpoint: "JIRA_E2E_ENDPOINT",
    jiraApiKey: "JIRA_E2E_API_KEY",
    jiraProjectKey: "JIRA_E2E_PROJECT_KEY",
  };
  for (const [field, key] of Object.entries(keyMap) as [keyof E2ECreds, string][]) {
    if (creds[field].trim() === "") missing.push(key);
  }
  return missing;
}

export function assertE2ECredsComplete(creds: E2ECreds): void {
  const missing = missingE2ECreds(creds);
  if (missing.length === 0) return;
  throw new Error(
    `e2e credentials missing/empty: ${missing.join(", ")}. Copy .env.example to .env and fill in your own test environment, or set the FEISHU_E2E_*/JIRA_E2E_* env vars.`,
  );
}

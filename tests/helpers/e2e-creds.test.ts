import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  E2E_DEFAULTS,
  assertE2ECredsComplete,
  loadE2ECredsEnvFile,
  missingE2ECreds,
  resolveE2ECreds,
} from "./e2e-creds.js";

const E2E_ENV_KEYS = [
  "FEISHU_E2E_APP_ID",
  "FEISHU_E2E_APP_SECRET",
  "FEISHU_E2E_INTAKE_CHAT_ID",
  "JIRA_E2E_ENDPOINT",
  "JIRA_E2E_API_KEY",
  "JIRA_E2E_PROJECT_KEY",
] as const;

const FULL_ENV: Record<string, string> = {
  FEISHU_E2E_APP_ID: "id",
  FEISHU_E2E_APP_SECRET: "sec",
  FEISHU_E2E_INTAKE_CHAT_ID: "oc",
  JIRA_E2E_ENDPOINT: "http://jira.example",
  JIRA_E2E_API_KEY: "key",
  JIRA_E2E_PROJECT_KEY: "TEST",
};

describe("e2e-creds", () => {
  afterEach(() => {
    for (const k of E2E_ENV_KEYS) delete process.env[k];
  });

  it("resolves all six to empty defaults when env is unset (no committed secrets)", () => {
    const c = resolveE2ECreds({});
    expect(c.feishuAppId).toBe(E2E_DEFAULTS.feishuAppId);
    expect(c.feishuAppSecret).toBe(E2E_DEFAULTS.feishuAppSecret);
    expect(c.feishuIntakeChatId).toBe(E2E_DEFAULTS.feishuIntakeChatId);
    expect(c.jiraEndpoint).toBe(E2E_DEFAULTS.jiraEndpoint);
    expect(c.jiraApiKey).toBe(E2E_DEFAULTS.jiraApiKey);
    expect(c.jiraProjectKey).toBe(E2E_DEFAULTS.jiraProjectKey);
    for (const v of Object.values(E2E_DEFAULTS)) {
      expect(v).toBe("");
    }
  });

  it("overrides each default from env independently", () => {
    const c = resolveE2ECreds({
      FEISHU_E2E_APP_ID: "override-id",
      JIRA_E2E_PROJECT_KEY: "OTHER",
    });
    expect(c.feishuAppId).toBe("override-id");
    expect(c.jiraProjectKey).toBe("OTHER");
    expect(c.feishuAppSecret).toBe(E2E_DEFAULTS.feishuAppSecret);
    expect(c.feishuIntakeChatId).toBe(E2E_DEFAULTS.feishuIntakeChatId);
    expect(c.jiraEndpoint).toBe(E2E_DEFAULTS.jiraEndpoint);
    expect(c.jiraApiKey).toBe(E2E_DEFAULTS.jiraApiKey);
  });

  it("treats empty-string env as an override (does not fall back to default)", () => {
    const c = resolveE2ECreds({ FEISHU_E2E_APP_ID: "" });
    expect(c.feishuAppId).toBe("");
  });

  it("returns false and does not touch env when the env file does not exist", () => {
    const missing = join(tmpdir(), "no-such-e2e-creds.env");
    expect(loadE2ECredsEnvFile(missing)).toBe(false);
    expect(process.env.FEISHU_E2E_APP_ID).toBeUndefined();
  });

  it("loads an existing env file into process.env and reports true", () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-creds-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(file, "# comment\nFEISHU_E2E_APP_ID=file-app-id\nJIRA_E2E_PROJECT_KEY=FILE\n");
      expect(loadE2ECredsEnvFile(file)).toBe(true);
      expect(process.env.FEISHU_E2E_APP_ID).toBe("file-app-id");
      expect(process.env.JIRA_E2E_PROJECT_KEY).toBe("FILE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not let the env file override an already-set process.env var", () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-creds-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(file, "JIRA_E2E_PROJECT_KEY=FILE\n");
      process.env.JIRA_E2E_PROJECT_KEY = "REAL";
      loadE2ECredsEnvFile(file);
      expect(process.env.JIRA_E2E_PROJECT_KEY).toBe("REAL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists only the empty-valued keys from missingE2ECreds", () => {
    const creds = resolveE2ECreds({ ...FULL_ENV, FEISHU_E2E_APP_ID: "" });
    expect(missingE2ECreds(creds)).toEqual(["FEISHU_E2E_APP_ID"]);
    expect(missingE2ECreds(resolveE2ECreds({}))).toEqual([
      "FEISHU_E2E_APP_ID",
      "FEISHU_E2E_APP_SECRET",
      "FEISHU_E2E_INTAKE_CHAT_ID",
      "JIRA_E2E_ENDPOINT",
      "JIRA_E2E_API_KEY",
      "JIRA_E2E_PROJECT_KEY",
    ]);
  });

  it("treats whitespace-only values as missing", () => {
    const creds = resolveE2ECreds({ ...FULL_ENV, FEISHU_E2E_APP_ID: "   " });
    expect(missingE2ECreds(creds)).toEqual(["FEISHU_E2E_APP_ID"]);
  });

  it("assertE2ECredsComplete throws with missing keys and the .env hint", () => {
    const creds = resolveE2ECreds({ FEISHU_E2E_APP_ID: "", JIRA_E2E_API_KEY: "" });
    expect(() => assertE2ECredsComplete(creds)).toThrow(/FEISHU_E2E_APP_ID/);
    expect(() => assertE2ECredsComplete(creds)).toThrow(/JIRA_E2E_API_KEY/);
    expect(() => assertE2ECredsComplete(creds)).toThrow(/\.env\.example to \.env/i);
    expect(() => assertE2ECredsComplete(resolveE2ECreds({}))).toThrow(/FEISHU_E2E_APP_ID/);
  });
});

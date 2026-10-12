import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolver.js";
import {
  type ConfigRuntimeInfo,
  buildConfigView,
  serializeConfig,
} from "../src/observability/config-view.js";

const runtime: ConfigRuntimeInfo = {
  pid: 42,
  started_at: 1700000000000,
  workflow_path: "/repo/WORKFLOW.md",
  workspace_root: "/repo/tasking_workspaces",
  log_path: "/repo/tasking.log",
  host: "0.0.0.0",
  port: 8080,
};

function makeConfig() {
  return resolveConfig(
    {
      tracker: {
        kind: "jira",
        endpoint: "http://jira.example",
        api_key: "super-secret-token",
        api_user: "bot",
        auth_mode: "bearer",
        active_states: ["待办", "处理中"],
        terminal_states: ["完成"],
      },
      polling: { interval_ms: 5000 },
      feishu: {
        enabled: true,
        app_id: "cli_abc",
        app_secret: "s3cret-app-secret",
        verification_token: "verify-me",
        encrypt_key: "encrypt-key",
      },
      env: { GITLAB_TOKEN: "masked-anyway", NODE_ENV: "production" },
    },
    "/repo",
    "prompt",
  );
}

describe("serializeConfig", () => {
  it("masks secret keys but keeps non-secret fields intact", () => {
    const serialized = serializeConfig(makeConfig());
    const tracker = serialized.tracker as Record<string, unknown>;
    expect(tracker.api_key).toBe("****");
    expect(tracker.endpoint).toBe("http://jira.example");
    expect(tracker.auth_mode).toBe("bearer");
    expect(Array.isArray(tracker.active_states)).toBe(true);
  });

  it("masks feishu secrets but not app_id", () => {
    const serialized = serializeConfig(makeConfig());
    const feishu = serialized.feishu as Record<string, unknown>;
    expect(feishu.app_secret).toBe("****");
    expect(feishu.verification_token).toBe("****");
    expect(feishu.encrypt_key).toBe("****");
    expect(feishu.app_id).toBe("cli_abc");
  });

  it("surfaces the derived feishu api base for the edition", () => {
    const config = makeConfig();
    const feishu = serializeConfig(config).feishu as Record<string, unknown>;
    expect(feishu.api_base).toBe("https://open.feishu.cn");
    const lark = serializeConfig({ ...config, feishu: { ...config.feishu, edition: "lark" } })
      .feishu as Record<string, unknown>;
    expect(lark.api_base).toBe("https://open.larksuite.com");
  });

  it("masks all env values", () => {
    const serialized = serializeConfig(makeConfig());
    const env = serialized.env as Record<string, unknown>;
    expect(env.GITLAB_TOKEN).toBe("****");
    expect(env.NODE_ENV).toBe("****");
  });

  it("keeps null fields as null (not masked)", () => {
    const config = resolveConfig(
      { tracker: { kind: "jira", endpoint: "http://jira" } },
      "/repo",
      "prompt",
    );
    const tracker = serializeConfig(config).tracker as Record<string, unknown>;
    expect(tracker.api_key).toBeNull();
    expect(tracker.api_user).toBeNull();
  });

  it("preserves arrays and records", () => {
    const config = resolveConfig(
      {
        tracker: { active_states: ["待办"], terminal_states: ["完成"] },
        agent: { max_concurrent_agents_by_state: { 代码评审中: 2 } },
      },
      "/repo",
      "prompt",
    );
    const serialized = serializeConfig(config);
    const tracker = serialized.tracker as Record<string, unknown>;
    expect(tracker.active_states).toEqual(["待办"]);
    const agent = serialized.agent as Record<string, unknown>;
    expect(agent.max_concurrent_agents_by_state).toEqual({ 代码评审中: 2 });
  });
});

describe("buildConfigView", () => {
  it("binds runtime info untouched", () => {
    const view = buildConfigView(makeConfig(), runtime);
    expect(view.runtime).toEqual(runtime);
    expect(view.config.tracker).toBeDefined();
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorkflowFile, parseWorkflowContent } from "../src/config/loader.js";
import { ConfigManager } from "../src/config/manager.js";
import { resolveConfig, resolveEnvVar, resolveWorkspaceRoot } from "../src/config/resolver.js";
import { validateDispatchConfig, validateStartupConfig } from "../src/config/validator.js";
import { TaskingError } from "../src/shared/errors.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tasking-test-"));
}

describe("loader", () => {
  it("returns missing_workflow_file for nonexistent path", () => {
    expect(() => loadWorkflowFile("/does/not/exist.md")).toThrow(TaskingError);
    try {
      loadWorkflowFile("/does/not/exist.md");
    } catch (e) {
      expect((e as TaskingError).category).toBe("missing_workflow_file");
    }
  });

  it("splits front matter and prompt body", () => {
    const content = "---\npolling:\n  interval_ms: 5000\n---\n\nHello {{ task.identifier }}";
    const wf = parseWorkflowContent(content, "/tmp/WF.md");
    expect(wf.config.polling).toEqual({ interval_ms: 5000 });
    expect(wf.prompt_template).toBe("Hello {{ task.identifier }}");
  });

  it("treats file without front matter as prompt body only", () => {
    const wf = parseWorkflowContent("just a prompt", "/tmp/WF.md");
    expect(wf.config).toEqual({});
    expect(wf.prompt_template).toBe("just a prompt");
  });

  it("parses multiline hook scripts", () => {
    const content = "---\nhooks:\n  after_create: |\n    echo hi\n    echo bye\n---\nbody";
    const wf = parseWorkflowContent(content, "/tmp/WF.md");
    expect(wf.config.hooks).toEqual({ after_create: "echo hi\necho bye" });
  });

  it("parses empty inline flow mappings and sequences", () => {
    const content = "---\nfeishu:\n  direct:\n    projects: {}\n    path_roots: []\n---\nbody";
    const wf = parseWorkflowContent(content, "/tmp/WF.md");
    expect(wf.config).toEqual({
      feishu: { direct: { projects: {}, path_roots: [] } },
    });
  });

  it("parses inline flow mappings with nested maps, sequences and scalars", () => {
    const content =
      "---\nfeishu:\n  direct:\n    projects: {tasking: /repos/tasking, app: {path: /repos/app, auto_approve: true}}\n" +
      '    path_roots: ["/repos", /srv/extras]\n' +
      "    url: http://192.168.10.17:50050/rest/api/2\n---\nbody";
    const wf = parseWorkflowContent(content, "/tmp/WF.md");
    expect(wf.config).toEqual({
      feishu: {
        direct: {
          projects: {
            tasking: "/repos/tasking",
            app: { path: "/repos/app", auto_approve: true },
          },
          path_roots: ["/repos", "/srv/extras"],
          url: "http://192.168.10.17:50050/rest/api/2",
        },
      },
    });
  });

  it("parses inline flow collections with trailing commas and typed scalars", () => {
    const content =
      "---\nagent:\n  max_concurrent_agents_by_state: {in progress: 2,}\n" +
      "  labels: [alpha, beta,]\n  counts: [1, 2]\n---\nbody";
    const wf = parseWorkflowContent(content, "/tmp/WF.md");
    expect(wf.config).toEqual({
      agent: {
        max_concurrent_agents_by_state: { "in progress": 2 },
        labels: ["alpha", "beta"],
        counts: [1, 2],
      },
    });
  });

  it("rejects malformed inline flow mappings", () => {
    expect(() =>
      parseWorkflowContent(
        "---\nfeishu:\n  direct:\n    projects: {tasking}\n---\nbody",
        "/tmp/WF.md",
      ),
    ).toThrow(TaskingError);
    expect(() =>
      parseWorkflowContent(
        "---\nfeishu:\n  direct:\n    projects: {a: /x, b}\n---\nbody",
        "/tmp/WF.md",
      ),
    ).toThrow(TaskingError);
  });
});

describe("resolver", () => {
  it("applies defaults for missing optional fields", () => {
    const cfg = resolveConfig({}, "/tmp", "prompt");
    expect(cfg.polling.interval_ms).toBe(30000);
    expect(cfg.agent.max_concurrent_agents).toBe(10);
    expect(cfg.agent.max_retry_backoff_ms).toBe(300000);
    expect(cfg.hooks.timeout_ms).toBe(60000);
    expect(cfg.opencode.command).toBe("opencode");
  });

  it("applies v2 opencode defaults", () => {
    const cfg = resolveConfig({}, "/tmp", "prompt");
    expect(cfg.opencode.poll_interval_ms).toBe(2000);
    expect(cfg.opencode.permission_timeout_ms).toBe(1800000);
    expect(cfg.opencode.server_url).toBeNull();
  });

  it("resolves v2 opencode keys from raw config", () => {
    const cfg = resolveConfig(
      {
        opencode: {
          command: "/usr/local/bin/opencode",
          poll_interval_ms: 1000,
          permission_timeout_ms: 7200000,
          server_url: "http://127.0.0.1:48123",
        },
      },
      "/tmp",
      "prompt",
    );
    expect(cfg.opencode.command).toBe("/usr/local/bin/opencode");
    expect(cfg.opencode.poll_interval_ms).toBe(1000);
    expect(cfg.opencode.permission_timeout_ms).toBe(7200000);
    expect(cfg.opencode.server_url).toBe("http://127.0.0.1:48123");
  });

  it("resolves empty server_url string to null", () => {
    const cfg = resolveConfig({ opencode: { server_url: "" } }, "/tmp", "prompt");
    expect(cfg.opencode.server_url).toBeNull();
  });

  it("defaults interface_language to zh", () => {
    const cfg = resolveConfig({}, "/tmp", "prompt");
    expect(cfg.interface_language).toBe("zh");
  });

  it("resolves interface_language en", () => {
    const cfg = resolveConfig({ interface_language: "en" }, "/tmp", "p");
    expect(cfg.interface_language).toBe("en");
  });

  it("rejects invalid interface_language listing valid values", () => {
    expect(() => resolveConfig({ interface_language: "fr" }, "/tmp", "p")).toThrow(TaskingError);
    try {
      resolveConfig({ interface_language: "fr" }, "/tmp", "p");
    } catch (e) {
      const err = e as TaskingError;
      expect(err.category).toBe("config_validation");
      expect(err.message).toContain('"zh"');
      expect(err.message).toContain('"en"');
      expect(err.message).toContain("fr");
    }
  });

  it("defaults feishu.edition to feishu", () => {
    const cfg = resolveConfig({}, "/tmp", "p");
    expect(cfg.feishu.edition).toBe("feishu");
  });

  it("resolves feishu.edition lark", () => {
    const cfg = resolveConfig({ feishu: { edition: "lark" } }, "/tmp", "p");
    expect(cfg.feishu.edition).toBe("lark");
  });

  it("rejects invalid feishu.edition listing valid values, regardless of enabled", () => {
    expect(() => resolveConfig({ feishu: { edition: "cn" } }, "/tmp", "p")).toThrow(TaskingError);
    try {
      resolveConfig({ feishu: { edition: "cn" } }, "/tmp", "p");
    } catch (e) {
      const err = e as TaskingError;
      expect(err.category).toBe("config_validation");
      expect(err.message).toContain('"feishu"');
      expect(err.message).toContain('"lark"');
      expect(err.message).toContain("cn");
    }
    expect(() =>
      resolveConfig({ feishu: { enabled: false, edition: "larksuite.com" } }, "/tmp", "p"),
    ).toThrow(TaskingError);
  });

  it("resolves $VAR indirection", () => {
    process.env.TASKING_TEST_TOKEN = "secret123";
    try {
      expect(resolveEnvVar("$TASKING_TEST_TOKEN")).toBe("secret123");
    } finally {
      delete process.env.TASKING_TEST_TOKEN;
    }
  });

  it("treats empty env var as missing", () => {
    process.env.TASKING_EMPTY = "";
    try {
      expect(resolveEnvVar("$TASKING_EMPTY")).toBe("");
    } finally {
      delete process.env.TASKING_EMPTY;
    }
  });

  it("resolves tracker api_key via $VAR", () => {
    process.env.JIRA_FAKE_TOKEN = "tok";
    try {
      const cfg = resolveConfig(
        { tracker: { kind: "jira", api_key: "$JIRA_FAKE_TOKEN", project_key: "ENG" } },
        "/tmp",
        "p",
      );
      expect(cfg.tracker.api_key).toBe("tok");
    } finally {
      delete process.env.JIRA_FAKE_TOKEN;
    }
  });

  it("resolves feishu credential fields via $VAR", () => {
    process.env.FEISHU_FAKE_APP_ID = "cli_x";
    process.env.FEISHU_FAKE_APP_SECRET = "sec";
    try {
      const cfg = resolveConfig(
        {
          feishu: {
            enabled: true,
            app_id: "$FEISHU_FAKE_APP_ID",
            app_secret: "$FEISHU_FAKE_APP_SECRET",
            intake_chat_id: "oc_plain",
          },
        },
        "/tmp",
        "p",
      );
      expect(cfg.feishu.app_id).toBe("cli_x");
      expect(cfg.feishu.app_secret).toBe("sec");
      expect(cfg.feishu.intake_chat_id).toBe("oc_plain");
    } finally {
      delete process.env.FEISHU_FAKE_APP_ID;
      delete process.env.FEISHU_FAKE_APP_SECRET;
    }
  });

  it("treats a $VAR feishu field pointing at an unset env var as null", () => {
    const cfg = resolveConfig(
      { feishu: { app_secret: "$TASKING_UNSET_FEISHU_SECRET" } },
      "/tmp",
      "p",
    );
    expect(cfg.feishu.app_secret).toBeNull();
  });

  it("expands ~ in workspace root", () => {
    const cfg = resolveConfig({ workspace: { root: "~/tasking" } }, "/tmp", "p");
    expect(cfg.workspace.root).toContain("tasking");
    expect(cfg.workspace.root).not.toContain("~");
  });

  it("resolves relative workspace root against workflow dir", () => {
    const cfg = resolveConfig({ workspace: { root: "workspaces" } }, "/repo", "p");
    expect(cfg.workspace.root).toBe(resolveWorkspaceRoot("workspaces", "/repo"));
    expect(cfg.workspace.root.startsWith("/repo")).toBe(true);
  });

  it("normalizes per-state concurrency keys to lowercase and ignores invalid", () => {
    const cfg = resolveConfig(
      { agent: { max_concurrent_agents_by_state: { "In Progress": 2, bad: -1 } } },
      "/tmp",
      "p",
    );
    expect(cfg.agent.max_concurrent_agents_by_state["in progress"]).toBe(2);
    expect(cfg.agent.max_concurrent_agents_by_state.bad).toBeUndefined();
  });

  it("uses default active/terminal states", () => {
    const cfg = resolveConfig({ tracker: { kind: "jira" } }, "/tmp", "p");
    expect(cfg.tracker.active_states).toEqual(["To Do", "In Progress"]);
    expect(cfg.tracker.terminal_states).toContain("Done");
  });

  it("resolves review_state when configured", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "jira", review_state: "代码评审中" } },
      "/tmp",
      "p",
    );
    expect(cfg.tracker.review_state).toBe("代码评审中");
  });

  it("defaults review_state to null when not configured", () => {
    const cfg = resolveConfig({ tracker: { kind: "jira" } }, "/tmp", "p");
    expect(cfg.tracker.review_state).toBeNull();
  });
});

describe("opencode model/variant config", () => {
  it("defaults model and variant to null when not configured", () => {
    const cfg = resolveConfig({}, "/tmp", "prompt");
    expect(cfg.opencode.model).toBeNull();
    expect(cfg.opencode.variant).toBeNull();
  });

  it("resolves model and variant from config", () => {
    const cfg = resolveConfig(
      { opencode: { model: "anthropic/claude-sonnet-4-5", variant: "high" } },
      "/tmp",
      "prompt",
    );
    expect(cfg.opencode.model).toBe("anthropic/claude-sonnet-4-5");
    expect(cfg.opencode.variant).toBe("high");
  });

  it("treats empty string model/variant as null", () => {
    const cfg = resolveConfig({ opencode: { model: "", variant: "" } }, "/tmp", "prompt");
    expect(cfg.opencode.model).toBeNull();
    expect(cfg.opencode.variant).toBeNull();
  });
});

describe("opencode agents catalogue", () => {
  it("defaults agents to empty array when not configured", () => {
    const cfg = resolveConfig({}, "/tmp", "prompt");
    expect(cfg.opencode.agents).toEqual([]);
  });

  it("resolves agents as a string list from config", () => {
    const cfg = resolveConfig({ opencode: { agents: ["build", "review"] } }, "/tmp", "prompt");
    expect(cfg.opencode.agents).toEqual(["build", "review"]);
  });

  it("keeps the default agent as fallback alongside agents", () => {
    const cfg = resolveConfig(
      { opencode: { agent: "build", agents: ["build", "review"] } },
      "/tmp",
      "prompt",
    );
    expect(cfg.opencode.agent).toBe("build");
    expect(cfg.opencode.agents).toEqual(["build", "review"]);
  });

  it("ignores non-string entries in agents", () => {
    const cfg = resolveConfig(
      { opencode: { agents: ["build", 7, "review", null] } },
      "/tmp",
      "prompt",
    );
    expect(cfg.opencode.agents).toEqual(["build", "review"]);
  });
});

describe("validator", () => {
  it("fails when tracker.kind is absent", () => {
    const cfg = resolveConfig({}, "/tmp", "p");
    const r = validateDispatchConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.category === "config_validation")).toBe(true);
  });

  it("fails when jira api_key missing", () => {
    const cfg = resolveConfig({ tracker: { kind: "jira", project_key: "ENG" } }, "/tmp", "p");
    const r = validateDispatchConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.category === "missing_tracker_api_key")).toBe(true);
  });

  it("passes with valid jira config", () => {
    process.env.JIRA_OK_TOKEN = "x";
    try {
      const cfg = resolveConfig(
        { tracker: { kind: "jira", api_key: "$JIRA_OK_TOKEN", project_key: "ENG" } },
        "/tmp",
        "p",
      );
      expect(validateDispatchConfig(cfg).ok).toBe(true);
    } finally {
      delete process.env.JIRA_OK_TOKEN;
    }
  });
});

describe("manager reload", () => {
  it("keeps last good config on invalid reload", () => {
    const dir = tempDir();
    try {
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(wfPath, "---\npolling:\n  interval_ms: 1000\n---\nbody");
      const mgr = ConfigManager.fromFile(wfPath);
      expect(mgr.current.polling.interval_ms).toBe(1000);

      writeFileSync(wfPath, "---\nnot: valid: yaml: ---\nbroken");
      const result = mgr.reload();
      expect(result.error).not.toBeNull();
      expect(mgr.current.polling.interval_ms).toBe(1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies reloaded config", () => {
    const dir = tempDir();
    try {
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(wfPath, "---\npolling:\n  interval_ms: 1000\n---\nbody");
      const mgr = ConfigManager.fromFile(wfPath);
      writeFileSync(wfPath, "---\npolling:\n  interval_ms: 2000\n---\nbody2");
      const result = mgr.reload();
      expect(result.error).toBeNull();
      expect(mgr.current.polling.interval_ms).toBe(2000);
      expect(mgr.current.prompt_template).toBe("body2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hot-reloads interface_language without restart", () => {
    const dir = tempDir();
    try {
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(wfPath, "---\ninterface_language: zh\n---\nbody");
      const mgr = ConfigManager.fromFile(wfPath);
      expect(mgr.current.interface_language).toBe("zh");
      writeFileSync(wfPath, "---\ninterface_language: en\n---\nbody");
      const result = mgr.reload();
      expect(result.error).toBeNull();
      expect(mgr.current.interface_language).toBe("en");
      expect(result.config.interface_language).toBe("en");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces deprecation warnings at construction and on reload", () => {
    const dir = tempDir();
    try {
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(wfPath, "---\nfeishu:\n  enabled: false\n  poll_interval_ms: 3000\n---\nbody");
      const mgr = ConfigManager.fromFile(wfPath);
      expect(mgr.warnings).toHaveLength(1);
      expect(mgr.warnings[0] ?? "").toMatch(/forward_interval_ms/);
      expect(mgr.current.feishu.forward_interval_ms).toBe(5000);

      writeFileSync(
        wfPath,
        "---\nfeishu:\n  enabled: false\n  forward_interval_ms: 8000\n---\nbody",
      );
      const result = mgr.reload();
      expect(result.error).toBeNull();
      expect(result.warnings).toHaveLength(0);
      expect(mgr.current.feishu.forward_interval_ms).toBe(8000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("validateStartupConfig feishu branch", () => {
  it("fails when feishu enabled but app_id missing", () => {
    const config = resolveConfig(
      { tracker: { kind: "jira", api_key: "tok", project_key: "ENG" }, feishu: { enabled: true } },
      "/tmp",
      "test",
    );
    const result = validateStartupConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.category === "feishu_missing_credentials")).toBe(true);
  });

  it("passes when feishu disabled", () => {
    const config = resolveConfig(
      { tracker: { kind: "jira", api_key: "tok", project_key: "ENG" }, feishu: { enabled: false } },
      "/tmp",
      "test",
    );
    const result = validateStartupConfig(config);
    expect(result.ok).toBe(true);
  });

  it("passes when feishu enabled with full credentials", () => {
    const config = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        feishu: {
          enabled: true,
          app_id: "x",
          app_secret: "y",
          intake_chat_id: "oc_1",
          create_issue_type: "Task",
        },
      },
      "/tmp",
      "test",
    );
    const result = validateStartupConfig(config);
    expect(result.ok).toBe(true);
  });
});

describe("env config", () => {
  it("resolves $VAR references in env values", () => {
    process.env.TEST_GITLAB_TOKEN = "glpat-test-123";
    try {
      const config = resolveConfig(
        {
          tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
          env: { GITLAB_TOKEN: "$TEST_GITLAB_TOKEN" },
        },
        "/tmp",
        "test",
      );
      expect(config.env.GITLAB_TOKEN).toBe("glpat-test-123");
    } finally {
      delete process.env.TEST_GITLAB_TOKEN;
    }
  });

  it("defaults to empty object when env section missing", () => {
    const config = resolveConfig(
      { tracker: { kind: "jira", api_key: "tok", project_key: "ENG" } },
      "/tmp",
      "test",
    );
    expect(config.env).toEqual({});
  });

  it("resolves empty env var to empty string", () => {
    process.env.TEST_EMPTY_VAR = "";
    try {
      const config = resolveConfig(
        {
          tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
          env: { SOME_KEY: "$TEST_EMPTY_VAR" },
        },
        "/tmp",
        "test",
      );
      expect(config.env.SOME_KEY).toBe("");
    } finally {
      delete process.env.TEST_EMPTY_VAR;
    }
  });
});

describe("feishu bridge config", () => {
  it("applies defaults for new feishu fields", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "jira", api_key: "tok", project_key: "ENG" } },
      "/tmp",
      "prompt",
    );
    expect(cfg.feishu.intake_chat_id).toBeNull();
    expect(cfg.feishu.forward_interval_ms).toBe(5000);
    expect(cfg.feishu.sweep_interval_ms).toBe(43200000);
    expect(cfg.feishu.create_issue_type).toBeNull();
  });

  it("ignores the deprecated poll_interval_ms key and warns", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        feishu: { enabled: true, poll_interval_ms: 3000 },
      },
      "/tmp",
      "prompt",
      (message) => warnings.push(message),
    );
    expect(cfg.feishu.forward_interval_ms).toBe(5000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0] ?? "").toMatch(/forward_interval_ms/);
  });

  it("resolves forward_interval_ms regardless of the deprecated key", () => {
    const cfg = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        feishu: { poll_interval_ms: 3000, forward_interval_ms: 7000 },
      },
      "/tmp",
      "prompt",
    );
    expect(cfg.feishu.forward_interval_ms).toBe(7000);
  });

  it("warns on the deprecated poll_interval_ms key even when feishu is disabled", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        feishu: { poll_interval_ms: 2500 },
      },
      "/tmp",
      "prompt",
      (message) => warnings.push(message),
    );
    expect(cfg.feishu.enabled).toBe(false);
    expect(cfg.feishu.forward_interval_ms).toBe(5000);
    expect(warnings).toHaveLength(1);
  });

  it("resolves feishu fields from config", () => {
    const cfg = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        feishu: {
          enabled: true,
          app_id: "ai",
          app_secret: "s",
          intake_chat_id: "oc_123",
          forward_interval_ms: 3000,
          sweep_interval_ms: 60000,
          create_issue_type: "Task",
        },
      },
      "/tmp",
      "prompt",
    );
    expect(cfg.feishu.intake_chat_id).toBe("oc_123");
    expect(cfg.feishu.forward_interval_ms).toBe(3000);
    expect(cfg.feishu.sweep_interval_ms).toBe(60000);
    expect(cfg.feishu.create_issue_type).toBe("Task");
  });

  it("startup validation requires intake_chat_id and create_issue_type when feishu enabled", () => {
    const base = {
      tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
      opencode: { command: "opencode run" },
      feishu: { enabled: true, app_id: "ai", app_secret: "s" },
    };
    const cfg = resolveConfig(base, "/tmp", "prompt");
    const result = validateStartupConfig(cfg);
    expect(result.ok).toBe(false);
    const cats = result.errors.map((e) => e.message);
    expect(cats.some((m) => m.includes("intake_chat_id"))).toBe(true);
    expect(cats.some((m) => m.includes("create_issue_type"))).toBe(true);
  });

  it("startup validation passes when feishu enabled with all required fields", () => {
    const cfg = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "tok", project_key: "ENG" },
        opencode: { command: "opencode run" },
        feishu: {
          enabled: true,
          app_id: "ai",
          app_secret: "s",
          intake_chat_id: "oc_1",
          create_issue_type: "Task",
        },
      },
      "/tmp",
      "prompt",
    );
    expect(validateStartupConfig(cfg).ok).toBe(true);
  });

  it("startup validation ignores feishu when disabled", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "jira", api_key: "tok", project_key: "ENG" } },
      "/tmp",
      "prompt",
    );
    expect(validateStartupConfig(cfg).ok).toBe(true);
  });
});

describe("feishu.direct config", () => {
  it("enables direct by default when the section is absent (usability default)", () => {
    const cfg = resolveConfig({ feishu: { enabled: true } }, "/tmp", "p");
    expect(cfg.feishu.direct.enabled).toBe(true);
  });

  it("enables direct by section presence and fills all defaults", () => {
    const cfg = resolveConfig(
      { feishu: { direct: { projects: { tasking: "/repos/tasking" } } } },
      "/tmp",
      "p",
    );
    expect(cfg.feishu.direct.enabled).toBe(true);
    expect(cfg.feishu.direct.projects.tasking).toEqual({
      path: "/repos/tasking",
      auto_approve: null,
    });
    expect(cfg.feishu.direct.path_roots).toEqual([]);
    expect(cfg.feishu.direct.auto_approve).toBe(false);
    expect(cfg.feishu.direct.verbosity).toBe("detailed");
    expect(cfg.feishu.direct.max_concurrent).toBe(5);
    expect(cfg.feishu.direct.idle_ttl_ms).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("resolves inline flow projects/path_roots written in frontmatter", () => {
    const wf = parseWorkflowContent(
      "---\nfeishu:\n  enabled: true\n  direct:\n    projects: {}\n    path_roots: []\n---\nbody",
      "/tmp/WF.md",
    );
    const cfg = resolveConfig(wf.config, "/tmp", wf.prompt_template);
    expect(cfg.feishu.direct.projects).toEqual({});
    expect(cfg.feishu.direct.path_roots).toEqual([]);
  });

  it("resolves an inline flow projects map written in frontmatter", () => {
    const wf = parseWorkflowContent(
      "---\nfeishu:\n  enabled: true\n  direct:\n    projects: {tasking: /repos/tasking, app: {path: /repos/app, auto_approve: true}}\n---\nbody",
      "/tmp/WF.md",
    );
    const cfg = resolveConfig(wf.config, "/tmp", wf.prompt_template);
    expect(cfg.feishu.direct.projects.tasking).toEqual({
      path: "/repos/tasking",
      auto_approve: null,
    });
    expect(cfg.feishu.direct.projects.app).toEqual({ path: "/repos/app", auto_approve: true });
  });

  it("parses project entries as {path, auto_approve} objects", () => {
    const cfg = resolveConfig(
      {
        feishu: {
          direct: {
            auto_approve: false,
            projects: { app: { path: "/repos/app", auto_approve: true } },
          },
        },
      },
      "/tmp",
      "p",
    );
    expect(cfg.feishu.direct.projects.app).toEqual({ path: "/repos/app", auto_approve: true });
  });

  it("resolves path_roots list and explicit overrides", () => {
    const cfg = resolveConfig(
      {
        feishu: {
          direct: {
            path_roots: ["/repos", "~/work"],
            auto_approve: true,
            verbosity: "detailed",
            max_concurrent: 3,
            idle_ttl_ms: 1000,
          },
        },
      },
      "/tmp",
      "p",
    );
    expect(cfg.feishu.direct.path_roots).toEqual(["/repos", `${process.env.HOME}/work`]);
    expect(cfg.feishu.direct.auto_approve).toBe(true);
    expect(cfg.feishu.direct.verbosity).toBe("detailed");
    expect(cfg.feishu.direct.max_concurrent).toBe(3);
    expect(cfg.feishu.direct.idle_ttl_ms).toBe(1000);
  });

  it("rejects an unknown verbosity value", () => {
    expect(() =>
      resolveConfig({ feishu: { direct: { verbosity: "loud", projects: {} } } }, "/tmp", "p"),
    ).toThrow(TaskingError);
  });

  it("rejects non-positive max_concurrent and idle_ttl_ms", () => {
    expect(() =>
      resolveConfig({ feishu: { direct: { max_concurrent: 0, projects: {} } } }, "/tmp", "p"),
    ).toThrow(TaskingError);
    expect(() =>
      resolveConfig({ feishu: { direct: { idle_ttl_ms: -5, projects: {} } } }, "/tmp", "p"),
    ).toThrow(TaskingError);
  });

  it("rejects project entries that are neither string path nor object", () => {
    expect(() =>
      resolveConfig({ feishu: { direct: { projects: { bad: 42 } } } }, "/tmp", "p"),
    ).toThrow(TaskingError);
  });

  it("allows explicit enabled: false inside the section", () => {
    const cfg = resolveConfig(
      { feishu: { direct: { enabled: false, projects: { x: "/x" } } } },
      "/tmp",
      "p",
    );
    expect(cfg.feishu.direct.enabled).toBe(false);
  });
});

describe("feishu.direct verbosity levels", () => {
  it("accepts quiet as a verbosity level", () => {
    const cfg = resolveConfig(
      { feishu: { direct: { verbosity: "quiet", projects: {} } } },
      "/tmp",
      "p",
    );
    expect(cfg.feishu.direct.verbosity).toBe("quiet");
  });
});

describe("feishu.direct default-on (TAS-41 usability decision)", () => {
  it("enables direct with defaults when feishu is enabled and the section is absent", () => {
    const cfg = resolveConfig({ feishu: { enabled: true } }, "/tmp", "p");
    expect(cfg.feishu.direct.enabled).toBe(true);
    expect(cfg.feishu.direct.projects).toEqual({});
    expect(cfg.feishu.direct.verbosity).toBe("detailed");
  });

  it("explicit enabled: false opts out", () => {
    const cfg = resolveConfig({ feishu: { direct: { enabled: false } } }, "/tmp", "p");
    expect(cfg.feishu.direct.enabled).toBe(false);
  });

  it("explicit enabled: true inside an empty-valued section still works", () => {
    const cfg = resolveConfig({ feishu: { direct: { enabled: true } } }, "/tmp", "p");
    expect(cfg.feishu.direct.enabled).toBe(true);
  });
});

describe("tracker.kind: none (trackerless deployments)", () => {
  const trackerlessFeishu = {
    enabled: true,
    app_id: "c",
    app_secret: "s",
    intake_chat_id: "oc_intake",
  };

  it("resolves kind none and skips jira requirements at startup", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "none" }, feishu: trackerlessFeishu },
      "/tmp",
      "p",
    );
    expect(cfg.tracker.kind).toBe("none");
    const r = validateStartupConfig(cfg);
    expect(r.ok).toBe(true);
  });

  it("warns when tracker fields linger under kind none", () => {
    const warnings: string[] = [];
    const cfg = resolveConfig(
      {
        tracker: { kind: "none", endpoint: "https://jira", api_key: "tok" },
        feishu: trackerlessFeishu,
      },
      "/tmp",
      "p",
      (m) => warnings.push(m),
    );
    expect(cfg.tracker.kind).toBe("none");
    expect(warnings.some((w) => w.includes("kind: none") && w.includes("endpoint"))).toBe(true);
  });

  it("create_issue_type is not required when kind is none", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "none" }, feishu: trackerlessFeishu },
      "/tmp",
      "p",
    );
    expect(validateStartupConfig(cfg).errors.map((e) => e.category)).not.toContain(
      "feishu_missing_credentials",
    );
  });

  it("create_issue_type stays required for jira kind", () => {
    const cfg = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "t", api_user: "u", project_key: "ENG" },
        feishu: trackerlessFeishu,
      },
      "/tmp",
      "p",
    );
    const r = validateStartupConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes("create_issue_type"))).toBe(true);
  });

  it("rejects kind none with feishu disabled (no task source at all)", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "none" }, feishu: { enabled: false } },
      "/tmp",
      "p",
    );
    const r = validateStartupConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes("任务源"))).toBe(true);
  });

  it("rejects kind none with feishu on but direct off (nothing to do)", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "none" }, feishu: { ...trackerlessFeishu, direct: { enabled: false } } },
      "/tmp",
      "p",
    );
    const r = validateStartupConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes("direct"))).toBe(true);
  });

  it("still requires feishu credentials when kind is none", () => {
    const cfg = resolveConfig(
      { tracker: { kind: "none" }, feishu: { enabled: true, app_id: "c" } },
      "/tmp",
      "p",
    );
    const r = validateStartupConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes("app_secret"))).toBe(true);
  });

  it("dispatch validation reports disabled rather than unsupported for none", () => {
    const cfg = resolveConfig({ tracker: { kind: "none" } }, "/tmp", "p");
    const r = validateDispatchConfig(cfg);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.category).toBe("config_validation");
    expect(r.errors[0]?.message.includes("none")).toBe(true);
  });

  it("opencode.command is no longer a hard requirement (default backfills)", () => {
    const cfg = resolveConfig(
      {
        tracker: { kind: "jira", api_key: "t", api_user: "u", project_key: "ENG" },
      },
      "/tmp",
      "p",
    );
    expect(cfg.opencode.command).toBe("opencode");
    expect(validateDispatchConfig(cfg).ok).toBe(true);
    expect(
      validateDispatchConfig(cfg).errors.some((e) => e.category === "missing_opencode_command"),
    ).toBe(false);
  });
});

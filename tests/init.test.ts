import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  TEMPLATE_SECTIONS,
  VARIANT_ACTIVE_SECTIONS,
  applyTemplateTrimming,
  classifyProjectStatuses,
  generateWorkflowContent,
  runInit,
  templateTopLevelKeys,
  trimFrontmatter,
} from "../src/cli/init.js";
import type { PromptInterface } from "../src/cli/prompts.js";
import { createPromptInterface } from "../src/cli/prompts.js";
import { createStyle } from "../src/cli/style.js";
import { parseWorkflowContent } from "../src/config/loader.js";
import { setLocale } from "../src/translate/locale.js";

function mockOutput(): { stream: Writable; content: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      buf += chunk.toString();
      callback();
    },
  });
  return { stream, content: () => buf };
}

interface FeishuFetchOpts {
  tokenResults?: Array<{ code: number; msg?: string }>;
  httpStatus?: number;
  chats?: Array<{ chat_id: string; name: string }>;
  chatsFail?: boolean;
}

function feishuApiFetch(opts: FeishuFetchOpts = {}): typeof fetch {
  const tokenResults = opts.tokenResults ?? [{ code: 0 }];
  let tokenIdx = 0;
  return (async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("tenant_access_token")) {
      const r = tokenResults[tokenIdx] ?? { code: 0 };
      tokenIdx++;
      return new Response(
        JSON.stringify({
          code: r.code,
          msg: r.msg ?? "app secret invalid",
          tenant_access_token: r.code === 0 ? "t-verify" : undefined,
          expire: 7200,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/im/v1/chats")) {
      if (opts.chatsFail) {
        return new Response("boom", { status: 500 });
      }
      return new Response(JSON.stringify({ code: 0, data: { items: opts.chats ?? [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function mockFetchSuccess(statusNames: string[] = ["To Do", "In Progress", "Done"]): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/serverInfo")) {
      return new Response(JSON.stringify({ version: "8.20.0", deploymentType: "Server" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/statuses")) {
      return new Response(
        JSON.stringify([
          {
            id: "10002",
            name: "Task",
            statuses: statusNames.map((name) => ({ name })),
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/project/")) {
      return new Response(
        JSON.stringify({ issueTypes: [{ name: "Story" }, { name: "Bug" }, { name: "Task" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function mockFetchFailure(): typeof fetch {
  return (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
}

function mockFetch404(): typeof fetch {
  return (async () => {
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

function mockFetchServerOkProject404(): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/serverInfo")) {
      return new Response(JSON.stringify({ version: "8.20.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tasking-init-test-"));
}

function makeMockPrompts(answers: {
  endpoint: string;
  token: string;
  auth_mode: string;
  api_user?: string;
  project_key: string;
  workflow?: string;
  language?: string;
}): PromptInterface & { calls: string[] } {
  const calls: string[] = [];
  let askIdx = 0;
  const askValues = [answers.endpoint, answers.token];
  if (answers.api_user !== undefined) {
    askValues.push(answers.api_user);
  }
  askValues.push(answers.project_key);

  return {
    ask(question: string): Promise<string> {
      calls.push(question);
      const val = askValues[askIdx] ?? "";
      askIdx++;
      return Promise.resolve(val);
    },
    askSelect<T extends string>(
      question: string,
      options: ReadonlyArray<{ value: T }>,
    ): Promise<T> {
      calls.push(question);
      const q = question.toLowerCase();
      if (q.includes("任务来源")) return Promise.resolve("jira");
      if (q.includes("language")) {
        return Promise.resolve(answers.language === "English" ? "en" : "zh");
      }
      if (q.includes("workflow")) {
        return Promise.resolve(answers.workflow ?? "minimal");
      }
      return Promise.resolve(answers.auth_mode);
    },
    close(): void {},
    calls,
  };
}

function makeFeishuPrompts(answers: {
  endpoint: string;
  token: string;
  auth_mode: string;
  project_key: string;
  app_id?: string;
  app_secret?: string;
  intake_chat_id?: string;
  issue_type?: string;
}): PromptInterface & { calls: string[] } {
  const calls: string[] = [];
  const askValues = [
    answers.endpoint,
    answers.token,
    answers.project_key,
    answers.app_id ?? "cli_abc",
    answers.app_secret ?? "",
    answers.intake_chat_id ?? "oc_intake_1",
  ];
  let askIdx = 0;
  return {
    ask(question: string): Promise<string> {
      calls.push(question);
      const val = askValues[askIdx] ?? "";
      askIdx++;
      return Promise.resolve(val);
    },
    askSelect<T extends string>(
      question: string,
      options: ReadonlyArray<{ value: T }>,
    ): Promise<T> {
      calls.push(question);
      const q = question.toLowerCase();
      if (q.includes("任务来源")) return Promise.resolve("jira");
      if (q.includes("enable feishu")) return Promise.resolve("yes");
      if (q.includes("issue type"))
        return Promise.resolve(answers.issue_type ?? options[0]?.value ?? "");
      if (q.includes("language")) return Promise.resolve("zh");
      return Promise.resolve(answers.auth_mode);
    },
    close(): void {},
    calls,
  };
}

describe("runInit non-interactive", () => {
  it("copies example file in non-interactive mode", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, { force: false, nonInteractive: true });
      expect(code).toBe(0);
      const content = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(content).toContain("tracker:");
      expect(content).toContain("kind: jira");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("refuses to overwrite without --force", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "existing");
      const code = await runInit(dir, { force: false, nonInteractive: true });
      expect(code).toBe(1);
      const content = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(content).toBe("existing");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("overwrites with --force", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "existing");
      const code = await runInit(dir, { force: true, nonInteractive: true });
      expect(code).toBe(0);
      const content = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(content).toContain("kind: jira");
      expect(content).not.toContain("existing");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("backs up existing WORKFLOW.md to WORKFLOW.md.bak with --force", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "existing");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { force: true, nonInteractive: true, output: stream });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md.bak"), "utf8")).toBe("existing");
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain("kind: jira");
      expect(content()).toContain("backed up to");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("creates no backup when refusing to overwrite without --force", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "existing");
      const code = await runInit(dir, { force: false, nonInteractive: true });
      expect(code).toBe(1);
      expect(existsSync(join(dir, "WORKFLOW.md.bak"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("backs up existing WORKFLOW.md in interactive mode with --force", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "existing");
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: true,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md.bak"), "utf8")).toBe("existing");
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain("kind: jira");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("copies land skill in non-interactive code-mr mode", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      expect(existsSync(join(dir, ".opencode", "skills", "land", "SKILL.md"))).toBe(true);
      expect(existsSync(join(dir, ".opencode", "skills", "land", "land_watch.py"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints feishu quickstart pointer in non-interactive mode", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      await runInit(dir, { force: false, nonInteractive: true, output: stream });
      expect(content()).toContain("feishu-quickstart");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints ✓ success banner with no ANSI codes in non-interactive mode", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      await runInit(dir, { force: false, nonInteractive: true, output: stream });
      const out = content();
      expect(out).toContain("✓");
      expect(out).toContain("tasking initialized");
      expect(out).toContain("Config file:");
      expect(out).toContain("Workspace root:");
      expect(out).toContain("skill");
      expect(out).not.toContain("\x1b");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("prompt interface render translation", () => {
  it("renders the question and option labels in English under en locale (returning values)", async () => {
    const { stream, content } = mockOutput();
    const input = Readable.from(["\n"]);
    const prompts = createPromptInterface(input, stream, createStyle(false));
    setLocale("en");
    try {
      const value = await prompts.askSelect("任务来源", [
        { value: "feishu-direct", label: "只用飞书直连（默认）" },
        { value: "jira", label: "接 Jira" },
      ]);
      expect(value).toBe("feishu-direct");
    } finally {
      setLocale("zh");
      prompts.close();
    }
    const out = content();
    expect(out).toContain("Task source");
    expect(out).toContain("Feishu direct only (default)");
    expect(out).not.toContain("只用飞书直连");
  });

  it("keeps dynamic data labels (chat names) untranslated under en locale", async () => {
    const { stream, content } = mockOutput();
    const input = Readable.from(["4\n"]);
    const prompts = createPromptInterface(input, stream, createStyle(false));
    setLocale("en");
    try {
      const value = await prompts.askSelect("选择 intake 群", [
        { value: "__create__", label: "➕ 新建 intake 群（并拉你进群）" },
        { value: "__refresh__", label: "⟳ 刷新群列表" },
        { value: "oc_x", label: "测试群X" },
        { value: "oc_y", label: "测试群Y" },
      ]);
      expect(value).toBe("oc_y");
    } finally {
      setLocale("zh");
      prompts.close();
    }
    expect(content()).toContain("测试群Y");
  });

  it("translates ask() question text under en locale", async () => {
    const { stream, content } = mockOutput();
    const input = Readable.from(["cli_x\n"]);
    const prompts = createPromptInterface(input, stream, createStyle(false));
    setLocale("en");
    try {
      const answer = await prompts.ask("常用项目名");
      expect(answer).toBe("cli_x");
    } finally {
      setLocale("zh");
      prompts.close();
    }
    expect(content()).toContain("Frequent project name");
  });

  it("translates content before wrapping in color mode (ANSI never enters the dictionary)", async () => {
    const { stream, content } = mockOutput();
    const style = createStyle(true);
    setLocale("en");
    try {
      stream.write(style.boxHeader("任务来源"));
      stream.write(
        style.boxLine(
          style.dim(
            "只用飞书直连：群里 /chat 直接跑 opencode，无需 Jira。接 Jira：调度器轮询 Jira issue 派发（三个变体）。",
          ),
        ),
      );
      stream.write(style.bold("飞书版本"));
    } finally {
      setLocale("zh");
    }
    const out = content();
    expect(out).toContain("Task source");
    expect(out).toContain("Feishu direct only: /chat in the group runs opencode directly");
    expect(out).toContain("Feishu edition");
    expect(out).toContain("\x1b[1m");
    expect(out).toContain("\x1b[36m");
    expect(out).not.toContain("只用飞书直连");
  });
});

describe("questionnaire language seeding", () => {
  function langStub(asks: string[]): PromptInterface & { asked: string[] } {
    const asked: string[] = [];
    let askIdx = 0;
    return {
      ask: (question: string) => {
        asked.push(question);
        const v = asks[askIdx] ?? "";
        askIdx++;
        return Promise.resolve(v);
      },
      askSelect: (question: string, options: ReadonlyArray<{ value: string }>) => {
        asked.push(question);
        if (question.includes("任务来源")) return Promise.resolve("feishu-direct");
        return Promise.resolve(options[0]?.value ?? "");
      },
      close: () => {},
      asked,
    };
  }

  const failingTokenFetch = (async () =>
    new Response(JSON.stringify({ code: 10014, msg: "app not exist" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  it("renders the first questionnaire box in English when --lang en is given", async () => {
    const dir = tempDir();
    try {
      const prompts = langStub(["cli_x", "", "oc_x"]);
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        lang: "en",
        output: stream,
        promptInterface: prompts,
        fetchImpl: failingTokenFetch,
      });
      expect(code).toBe(0);
      expect(content()).toContain("Task source");
      expect(content()).toContain(
        "Feishu direct only: /chat in the group runs opencode directly, no Jira.",
      );
      expect(content()).toContain("Configuration complete!");
      expect(content()).toContain("Run: tasking start");
    } finally {
      setLocale("zh");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seeds the questionnaire language from the existing WORKFLOW.md on --force re-init", async () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        "---\ninterface_language: en\ntracker:\n  kind: none\n---\nbody",
        "utf8",
      );
      const prompts = langStub(["cli_x", "", "oc_x"]);
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: true,
        output: stream,
        promptInterface: prompts,
        fetchImpl: failingTokenFetch,
      });
      expect(code).toBe(0);
      expect(content()).toContain("Task source");
    } finally {
      setLocale("zh");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to zh when the existing WORKFLOW.md has no interface_language", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "---\ntracker:\n  kind: none\n---\nbody", "utf8");
      const prompts = langStub(["cli_x", "", "oc_x"]);
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: true,
        output: stream,
        promptInterface: prompts,
        fetchImpl: failingTokenFetch,
      });
      expect(code).toBe(0);
      expect(content()).toContain("任务来源");
    } finally {
      setLocale("zh");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to zh when the existing WORKFLOW.md fails to parse", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "---\nnot: [closed\n---\nbody", "utf8");
      const prompts = langStub(["cli_x", "", "oc_x"]);
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: true,
        output: stream,
        promptInterface: prompts,
        fetchImpl: failingTokenFetch,
      });
      expect(code).toBe(0);
      expect(content()).toContain("任务来源");
    } finally {
      setLocale("zh");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the first two questions in zh without --lang, switching after English is chosen", async () => {
    const dir = tempDir();
    try {
      const prompts: PromptInterface & { asked: string[] } = {
        ask: () => Promise.resolve(""),
        askSelect: (question: string, options: ReadonlyArray<{ value: string }>) => {
          if (question.includes("任务来源")) return Promise.resolve("feishu-direct");
          if (question.toLowerCase().includes("language")) return Promise.resolve("en");
          return Promise.resolve(options[0]?.value ?? "");
        },
        close: () => {},
        asked: [],
      };
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: failingTokenFetch,
      });
      expect(code).toBe(0);
      const out = content();
      expect(out).toContain("任务来源");
      expect(out).toContain(
        "Feishu-direct deployment: /chat creates an opencode session in a configured directory (no Jira needed).",
      );
    } finally {
      setLocale("zh");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit interactive", () => {
  it("routes by typed select value: choosing jira opens the Jira credential questions", async () => {
    const dir = tempDir();
    try {
      const asks = ["http://jira.example.com/rest/api/2", "token", "HEIH"];
      let askIdx = 0;
      const asked: string[] = [];
      const prompts: PromptInterface & { asked: string[] } = {
        ask: (question: string) => {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect: (question: string, options: ReadonlyArray<{ value: string }>) => {
          asked.push(question);
          const lq = question.toLowerCase();
          if (lq.includes("任务来源") || lq.includes("task source")) return Promise.resolve("jira");
          if (lq.includes("language")) return Promise.resolve("zh");
          if (lq.includes("authentication")) return Promise.resolve("bearer");
          if (lq.includes("workflow")) return Promise.resolve("minimal");
          if (lq.includes("enable feishu")) return Promise.resolve("no");
          return Promise.resolve(options[0]?.value ?? "");
        },
        close: () => {},
        asked,
      };
      const { stream } = mockOutput();
      setLocale("en");
      let code = -1;
      try {
        code = await runInit(dir, {
          force: false,
          output: stream,
          promptInterface: prompts,
          fetchImpl: mockFetchSuccess(),
        });
      } finally {
        setLocale("zh");
      }
      expect(code).toBe(0);
      expect(asked.join("\n")).toContain("Jira REST API endpoint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders the later bridge-disabled line in English through the full en Jira flow", async () => {
    const dir = tempDir();
    try {
      const asks = ["http://jira.example.com/rest/api/2", "token", "HEIH"];
      let askIdx = 0;
      const prompts: PromptInterface = {
        ask: () => {
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect: (question: string, options: ReadonlyArray<{ value: string }>) => {
          const lq = question.toLowerCase();
          if (lq.includes("任务来源") || lq.includes("task source")) return Promise.resolve("jira");
          if (lq.includes("language")) return Promise.resolve("en");
          if (lq.includes("authentication")) return Promise.resolve("bearer");
          if (lq.includes("workflow")) return Promise.resolve("minimal");
          if (lq.includes("enable feishu")) return Promise.resolve("no");
          return Promise.resolve(options[0]?.value ?? "");
        },
        close: () => {},
      };
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: mockFetchSuccess(),
      });
      expect(code).toBe(0);
      expect(content()).toContain("Feishu bridge disabled; see docs/feishu-quickstart.md");
    } finally {
      setLocale("zh");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows Prerequisites section with status icons before credential prompts", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "my-token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const out = content();
      expect(out).toContain("Prerequisites");
      expect(out).toContain("opencode");
      const prereIdx = out.indexOf("Prerequisites");
      const tipIdx = out.indexOf("JIRA_API_KEY");
      expect(prereIdx).toBeLessThan(tipIdx);
      expect(out).toMatch(/[✓✗⚠]/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prompts contain bold styling and Jira Setup box when output is TTY", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      (stream as { isTTY?: boolean }).isTTY = true;
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "my-token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: mockFetchSuccess(),
      });
      expect(code).toBe(0);
      const endpointQ = prompts.calls.find((q) => q.includes("Jira REST API endpoint"));
      expect(endpointQ).toBeDefined();
      expect(endpointQ).toContain("\x1b[1m");
      expect(content()).toContain("Jira Setup");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("collects credentials with bearer auth (skips api_user)", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "my-token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("endpoint: http://jira.example.com/rest/api/2");
      expect(wf).toContain("api_key: $JIRA_API_KEY");
      expect(wf).toContain("auth_mode: bearer");
      expect(wf).toContain("api_user: null");
      expect(wf).toContain("project_key: HEIH");
      expect(content()).toContain("JIRA_API_KEY");
      expect(content()).toContain("~/.bashrc");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("collects credentials with basic auth (asks api_user)", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "my-token",
        auth_mode: "basic",
        api_user: "alice@example.com",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("auth_mode: basic");
      expect(wf).toContain("api_user: alice@example.com");
      expect(prompts.calls).toContain("Jira username/email (required for basic auth)");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("does not ask api_user in bearer mode", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "my-token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(prompts.calls).not.toContain("Jira username/email (required for basic auth)");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints project statuses on successful Jira connection", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchSuccess(),
        promptInterface: prompts,
      });
      expect(content()).toContain("Jira connection successful");
      expect(content()).toContain("v8.20.0");
      expect(content()).toContain("To Do");
      expect(content()).toContain("In Progress");
      expect(content()).toContain("Done");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints warning on failed Jira connection but still generates config", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "bad-token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(content()).toContain("Jira connection test failed");
      expect(existsSync(join(dir, "WORKFLOW.md"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("shows endpoint and common causes on 404 from serverInfo", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://172.20.244.94:50050/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetch404(),
        promptInterface: prompts,
      });
      const c = content();
      expect(c).toContain("Jira connection test failed");
      expect(c).toContain("404");
      expect(c).toContain("Endpoint: http://172.20.244.94:50050/rest/api/2");
      expect(c).toContain("Common causes");
      expect(c).toContain("API version");
      expect(c).toContain("context path");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("shows project key hint when serverInfo ok but project 404", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "WRONG",
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchServerOkProject404(),
        promptInterface: prompts,
      });
      const c = content();
      expect(c).toContain("Jira connection successful");
      expect(c).toContain("v8.20.0");
      expect(c).toContain("Project key 'WRONG' test failed");
      expect(c).toContain("project key is correct");
      expect(c).toContain("token has access");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints completion hint with fields to edit", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      const c = content();
      expect(c).toContain("active_states");
      expect(c).toContain("terminal_states");
      expect(c).toContain("review_state");
      expect(c).toContain("after_create");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("falls back to non-interactive when stdin is not TTY", async () => {
    const dir = tempDir();
    try {
      const { Readable } = await import("node:stream");
      const fakeInput = new Readable({ read() {} });
      Object.defineProperty(fakeInput, "isTTY", { value: false });
      const code = await runInit(dir, { force: false, input: fakeInput });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("endpoint: https://your-domain.atlassian.net/rest/api/3");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("copies land skill to .opencode/skills/land/ (code-mr interactive)", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        workflow: "code-mr",
      });
      const { stream } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(existsSync(join(dir, ".opencode", "skills", "land", "SKILL.md"))).toBe(true);
      expect(existsSync(join(dir, ".opencode", "skills", "land", "land_watch.py"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("does not overwrite existing land skill", async () => {
    const dir = tempDir();
    try {
      const skillDir = join(dir, ".opencode", "skills", "land");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "custom content");
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
      expect(content).toBe("custom content");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prints GitLab hint when GITLAB_TOKEN not set", async () => {
    const dir = tempDir();
    const savedToken = process.env.GITLAB_TOKEN;
    delete process.env.GITLAB_TOKEN;
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(content()).toContain("GITLAB_TOKEN not set");
      expect(content()).toContain("GITLAB_TOKEN");
      expect(content()).toContain("env:");
    } finally {
      if (savedToken !== undefined) process.env.GITLAB_TOKEN = savedToken;
      else delete process.env.GITLAB_TOKEN;
      rmSync(dir, { recursive: true });
    }
  });

  it("skips GitLab hint when GITLAB_TOKEN already set", async () => {
    const dir = tempDir();
    const savedToken = process.env.GITLAB_TOKEN;
    process.env.GITLAB_TOKEN = "glpat-test";
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(content()).not.toContain("GitLab credentials");
    } finally {
      if (savedToken !== undefined) process.env.GITLAB_TOKEN = savedToken;
      else delete process.env.GITLAB_TOKEN;
      rmSync(dir, { recursive: true });
    }
  });

  it("prints glab warning when glab not in PATH", async () => {
    const whichGlab = spawnSync("which", ["glab"], { stdio: "pipe" });
    if (whichGlab.status === 0) return;
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(content()).toMatch(/glab\s+not found in PATH/);
      expect(content()).toContain("agent cannot create or merge MRs");
      expect(content()).toMatch(/glab[^\n]*install|install[^\n]*glab/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("collects Feishu setup and writes the feishu block when enabled", async () => {
    const dir = tempDir();
    try {
      const prompts = makeFeishuPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        app_id: "cli_abc",
        intake_chat_id: "oc_intake_1",
        issue_type: "Story",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchSuccess(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(content()).toContain("Feishu Setup");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/^feishu:\n(?:\s*#.*\n)*\s*enabled: true/m);
      expect(wf).toContain("app_id: cli_abc");
      expect(wf).toContain("app_secret: $FEISHU_APP_SECRET");
      expect(wf).toContain("intake_chat_id: oc_intake_1");
      expect(wf).toContain("create_issue_type: Story");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("writes a provided Feishu app_secret in plaintext and hints the env-var alternative", async () => {
    const dir = tempDir();
    try {
      const prompts = makeFeishuPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        app_id: "cli_abc",
        app_secret: "cli_secret_xyz",
        intake_chat_id: "oc_intake_1",
        issue_type: "Story",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchSuccess(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("app_secret: cli_secret_xyz");
      expect(wf).not.toContain("app_secret: $FEISHU_APP_SECRET");
      expect(content()).toContain("FEISHU_APP_SECRET");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("leaves feishu disabled when user declines the bridge", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/^feishu:\n(?:\s*#.*\n)*\s*enabled: false/m);
      expect(wf).toContain("app_id: $FEISHU_APP_ID");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("runInit --workflow", () => {
  it("non-interactive --workflow grill-openspec writes the grill template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "grill-openspec",
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("## 🔍 拷问 / Grill Questions");
      expect(wf).toContain("阶段 1：grill");
      expect(wf).not.toContain("State Flow");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow grill-openspec installs all six skills", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "grill-openspec" });
      const skills = join(dir, ".opencode", "skills");
      expect(existsSync(join(skills, "land", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "land", "land_watch.py"))).toBe(true);
      expect(existsSync(join(skills, "install-glab", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "opsx-grill-with-docs", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "opsx-propose-with-tdd", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "opsx-implement", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "openspec-archive-change", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive minimal installs no skills (minimal workflow)", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const skills = join(dir, ".opencode", "skills");
      expect(existsSync(join(skills, "land", "SKILL.md"))).toBe(false);
      expect(existsSync(join(skills, "install-glab", "SKILL.md"))).toBe(false);
      expect(existsSync(join(skills, "opsx-grill-with-docs", "SKILL.md"))).toBe(false);
      expect(existsSync(join(skills, "openspec-archive-change", "SKILL.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow code-mr writes the code-mr template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "code-mr",
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("<!-- tasking-workflow: code-mr -->");
      expect(wf).toContain("State Flow");
      expect(wf).not.toContain("## 🔍 拷问 / Grill Questions");
      expect(wf).not.toMatch(/review_state:\s*null/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow code-mr installs land + install-glab (no opsx skills)", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const skills = join(dir, ".opencode", "skills");
      expect(existsSync(join(skills, "land", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "land", "land_watch.py"))).toBe(true);
      expect(existsSync(join(skills, "install-glab", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "opsx-grill-with-docs", "SKILL.md"))).toBe(false);
      expect(existsSync(join(skills, "openspec-archive-change", "SKILL.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("bare non-interactive init writes the feishu-direct template (default variant)", async () => {
    const dirA = tempDir();
    const dirB = tempDir();
    try {
      await runInit(dirA, { force: false, nonInteractive: true, workflow: "feishu-direct" });
      await runInit(dirB, { force: false, nonInteractive: true });
      const a = readFileSync(join(dirA, "WORKFLOW.md"), "utf8");
      const b = readFileSync(join(dirB, "WORKFLOW.md"), "utf8");
      expect(a).toBe(b);
      expect(b).toContain("kind: none");
      expect(b).not.toContain("## 🔍 拷问 / Grill Questions");
      expect(b).not.toContain("<!-- tasking-workflow: code-mr -->");
    } finally {
      rmSync(dirA, { recursive: true });
      rmSync(dirB, { recursive: true });
    }
  });

  it("non-interactive unknown --workflow errors with non-zero and writes nothing", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "unknown",
      });
      expect(code).toBe(1);
      expect(existsSync(join(dir, "WORKFLOW.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow minimal writes the minimal template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("kind: jira");
      expect(wf).toMatch(/review_state:\s*null/);
      expect(wf).not.toContain("## 🔍 拷问 / Grill Questions");
      expect(wf).not.toContain("<!-- tasking-workflow: code-mr -->");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow default is rejected after the minimal rename", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, { force: false, nonInteractive: true, workflow: "default" });
      expect(code).toBe(1);
      expect(existsSync(join(dir, "WORKFLOW.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("markerless WORKFLOW.md drift-reports against the minimal template", async () => {
    const dir = tempDir();
    try {
      const template = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
        "utf8",
      );
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        template.replace(/\n {2}timeout_ms: 60000/, ""),
        "utf8",
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("hooks.timeout_ms");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("interactive task-source default enters the Feishu flow without Jira questions", async () => {
    const dir = tempDir();
    try {
      const asked: string[] = [];
      let feishuAsk = 0;
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = ["cli_a", "sec_a", "oc_intake"][feishuAsk] ?? "";
          feishuAsk++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          if (question.toLowerCase().includes("language")) return Promise.resolve("zh");
          return Promise.resolve("feishu-direct");
        },
        close(): void {},
      };
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { force: false, output: stream, promptInterface: prompts });
      expect(code).toBe(0);
      const q = asked.join("\n");
      expect(q).toContain("任务来源");
      expect(q).not.toContain("Jira REST API endpoint");
      expect(q).not.toContain("Jira API token");
      expect(q).not.toContain("project key");
      expect(q).not.toContain("变体");
      expect(q).toContain("Feishu app_id");
      expect(q).toContain("intake_chat_id");
      expect(content()).toContain("Feishu Setup");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("kind: none");
      expect(wf).toContain("app_id: cli_a");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("interactive asks for workflow when --workflow not specified", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        workflow: "grill-openspec",
      });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const askedWorkflow = prompts.calls.some((q) => q.toLowerCase().includes("workflow"));
      expect(askedWorkflow).toBe(true);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("## 🔍 拷问 / Grill Questions");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("interactive skips workflow question when --workflow specified", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
        workflow: "grill-openspec",
      });
      expect(code).toBe(0);
      const askedWorkflow = prompts.calls.some((q) => q.toLowerCase().includes("workflow"));
      expect(askedWorkflow).toBe(false);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("## 🔍 拷问 / Grill Questions");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("runInit --update", () => {
  it("refuses to run together with --force", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { force: true, update: true, output: stream });
      expect(code).toBe(1);
      expect(content()).toMatch(/mutually exclusive/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("refuses to run together with --restore", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, restore: true, output: stream });
      expect(code).toBe(1);
      expect(content()).toMatch(/mutually exclusive/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("errors when WORKFLOW.md is missing", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(1);
      expect(content()).toContain("WORKFLOW.md");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("installs missing skills", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      rmSync(join(dir, ".opencode", "skills", "land"), { recursive: true });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(existsSync(join(dir, ".opencode", "skills", "land", "SKILL.md"))).toBe(true);
      expect(existsSync(join(dir, ".opencode", "skills", "land", "land_watch.py"))).toBe(true);
      expect(content()).toContain("land/SKILL.md");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("backups and overwrites a byte-modified skill", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const skillMd = join(dir, ".opencode", "skills", "land", "SKILL.md");
      writeFileSync(skillMd, "custom content", "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(readFileSync(skillMd, "utf8")).not.toBe("custom content");
      expect(readFileSync(`${skillMd}.bak`, "utf8")).toBe("custom content");
      expect(content()).toContain("backup");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("refreshes the .bak backup on a second update", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const skillMd = join(dir, ".opencode", "skills", "land", "SKILL.md");
      writeFileSync(skillMd, "v1 custom", "utf8");
      await runInit(dir, { update: true, output: mockOutput().stream });
      writeFileSync(skillMd, "v2 custom", "utf8");
      await runInit(dir, { update: true, output: mockOutput().stream });
      expect(readFileSync(`${skillMd}.bak`, "utf8")).toBe("v2 custom");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("skips up-to-date skills without creating backups", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).not.toContain("backup");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("does not modify WORKFLOW.md content", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const before = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      const { stream } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports config fields missing from the user frontmatter", async () => {
    const dir = tempDir();
    try {
      const template = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
        "utf8",
      );
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        template.replace(/\n {2}timeout_ms: 60000/, ""),
        "utf8",
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("hooks.timeout_ms");
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).not.toMatch(/^\s+timeout_ms:/m);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports no new fields when the frontmatter matches the template", async () => {
    const dir = tempDir();
    try {
      const template = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
        "utf8",
      );
      writeFileSync(join(dir, "WORKFLOW.md"), template, "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toMatch(/no missing config fields/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("labels missing config fields as falling back to DEFAULTS", async () => {
    const dir = tempDir();
    try {
      const template = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
        "utf8",
      );
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        template.replace(/\n {2}timeout_ms: 60000/, ""),
        "utf8",
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("DEFAULTS");
      expect(content()).not.toMatch(/new config fields/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("renders array defaults as JSON in the drift report", async () => {
    const dir = tempDir();
    try {
      const template = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
        "utf8",
      );
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        template.replace(/\n {2}required_labels: \[\]/, ""),
        "utf8",
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("tracker.required_labels");
      expect(content()).toContain("(default: [])");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("writes .tasking/WORKFLOW.md.reference when drift is detected", async () => {
    const dir = tempDir();
    try {
      const before = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
        "utf8",
      );
      writeFileSync(join(dir, "WORKFLOW.md"), `${before}\n<!-- local body edit -->\n`, "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      const ref = join(dir, ".tasking", "WORKFLOW.md.reference");
      expect(existsSync(ref)).toBe(true);
      expect(readFileSync(ref, "utf8")).toBe(before);
      expect(content()).toContain(".tasking/WORKFLOW.md.reference");
      expect(content()).toContain("git diff --no-index WORKFLOW.md");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("removes a stale .tasking/WORKFLOW.md.reference when drift is gone", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(wfPath, `${readFileSync(wfPath, "utf8")}\n<!-- local body edit -->\n`, "utf8");
      await runInit(dir, { update: true, output: mockOutput().stream });
      const ref = join(dir, ".tasking", "WORKFLOW.md.reference");
      expect(existsSync(ref)).toBe(true);
      writeFileSync(wfPath, readFileSync(ref, "utf8"), "utf8");
      const { stream, content } = mockOutput();
      await runInit(dir, { update: true, output: stream });
      expect(existsSync(ref)).toBe(false);
      expect(content()).not.toContain("git diff --no-index");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports the detected workflow on --update", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const { stream, content } = mockOutput();
      await runInit(dir, { update: true, output: stream });
      expect(content()).toContain("Workflow: code-mr");
      expect(content()).toContain("detected from WORKFLOW.md sentinel markers");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports an explicit --workflow on --update", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const { stream, content } = mockOutput();
      await runInit(dir, { update: true, workflow: "minimal", output: stream });
      expect(content()).toContain("Workflow: minimal");
      expect(content()).toContain("explicit --workflow");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports a prompt body diff when the body changed", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      let wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      wf += "\n# user added note\n";
      writeFileSync(join(dir, "WORKFLOW.md"), wf, "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("# user added note");
      expect(content()).toMatch(/\+\s*# user added note/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports identical body when the body matches the template", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toMatch(/identical/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("caps the printed prompt body diff and points to the reference file", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const wfPath = join(dir, "WORKFLOW.md");
      const appended = Array.from({ length: 80 }, (_, i) => `# drift note ${i}`);
      writeFileSync(wfPath, `${readFileSync(wfPath, "utf8")}\n${appended.join("\n")}\n`, "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("drift note 0");
      expect(content()).not.toContain("drift note 79");
      expect(content()).toMatch(/more changed lines/i);
      expect(content()).toContain("git diff --no-index WORKFLOW.md");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("works with a grill-openspec WORKFLOW.md and explicit --workflow", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "grill-openspec" });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, workflow: "grill-openspec", output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("up to date");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("detects a code-mr WORKFLOW.md on --update and syncs only land + install-glab", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const skills = join(dir, ".opencode", "skills");
      expect(existsSync(join(skills, "land", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skills, "install-glab", "SKILL.md"))).toBe(true);
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("up to date");
      expect(existsSync(join(skills, "opsx-grill-with-docs", "SKILL.md"))).toBe(false);
      expect(existsSync(join(skills, "openspec-archive-change", "SKILL.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("detects a minimal WORKFLOW.md on --update and syncs no skills", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toMatch(/identical|no missing config fields/i);
      const skills = join(dir, ".opencode", "skills");
      expect(existsSync(join(skills, "land", "SKILL.md"))).toBe(false);
      expect(existsSync(join(skills, "install-glab", "SKILL.md"))).toBe(false);
      expect(existsSync(join(skills, "opsx-grill-with-docs", "SKILL.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("errors on an unknown --workflow", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, workflow: "unknown", output: stream });
      expect(code).toBe(1);
      expect(content()).toMatch(/unknown workflow/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("runInit --restore", () => {
  it("restores .bak files over the current skill files", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const skillMd = join(dir, ".opencode", "skills", "land", "SKILL.md");
      writeFileSync(skillMd, "new version", "utf8");
      writeFileSync(`${skillMd}.bak`, "user version", "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { restore: true, output: stream });
      expect(code).toBe(0);
      expect(readFileSync(skillMd, "utf8")).toBe("user version");
      expect(existsSync(`${skillMd}.bak`)).toBe(false);
      expect(content()).toContain("restored");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("restores WORKFLOW.md.bak over the current WORKFLOW.md when present", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "regenerated", "utf8");
      writeFileSync(join(dir, "WORKFLOW.md.bak"), "user version", "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { restore: true, output: stream });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toBe("user version");
      expect(existsSync(join(dir, "WORKFLOW.md.bak"))).toBe(false);
      expect(content()).toContain("restored");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("refreshes WORKFLOW.md.bak on repeated --force runs", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md"), "v1", "utf8");
      await runInit(dir, { force: true, nonInteractive: true });
      expect(readFileSync(join(dir, "WORKFLOW.md.bak"), "utf8")).toBe("v1");
      writeFileSync(join(dir, "WORKFLOW.md"), "v2-user-edit", "utf8");
      await runInit(dir, { force: true, nonInteractive: true });
      expect(readFileSync(join(dir, "WORKFLOW.md.bak"), "utf8")).toBe("v2-user-edit");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("restores both WORKFLOW.md.bak and skill backups in one --restore run", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const skillMd = join(dir, ".opencode", "skills", "land", "SKILL.md");
      writeFileSync(skillMd, "new skill", "utf8");
      writeFileSync(`${skillMd}.bak`, "user skill", "utf8");
      writeFileSync(join(dir, "WORKFLOW.md"), "regenerated", "utf8");
      writeFileSync(join(dir, "WORKFLOW.md.bak"), "user workflow", "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { restore: true, output: stream });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toBe("user workflow");
      expect(readFileSync(skillMd, "utf8")).toBe("user skill");
      expect(existsSync(join(dir, "WORKFLOW.md.bak"))).toBe(false);
      expect(existsSync(`${skillMd}.bak`)).toBe(false);
      const restoredLines = content()
        .split("\n")
        .filter((line) => line.startsWith("restored "));
      expect(restoredLines).toHaveLength(2);
      expect(restoredLines[0]).toContain("WORKFLOW.md");
      expect(restoredLines[1]).toContain("SKILL.md");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("restores WORKFLOW.md.bak even when the current WORKFLOW.md is missing", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "WORKFLOW.md.bak"), "orphaned backup", "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { restore: true, output: stream });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toBe("orphaned backup");
      expect(existsSync(join(dir, "WORKFLOW.md.bak"))).toBe(false);
      expect(content()).toContain("restored");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("reports no backups when none exist and exits 0", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { restore: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toMatch(/no skill backups/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("package.json files include all example templates", () => {
  it("ships assets/workflows/WORKFLOW.minimal.md.example, assets/workflows/WORKFLOW.code-mr.md.example, and assets/workflows/WORKFLOW.grill-openspec.md.example", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      files?: string[];
    };
    expect(pkg.files).toContain("assets");
    for (const f of [
      "WORKFLOW.minimal.md.example",
      "WORKFLOW.code-mr.md.example",
      "WORKFLOW.grill-openspec.md.example",
      "WORKFLOW.minimal.en.md.example",
      "WORKFLOW.code-mr.en.md.example",
      "WORKFLOW.grill-openspec.en.md.example",
    ]) {
      expect(existsSync(join(process.cwd(), "assets", "workflows", f))).toBe(true);
    }
  });
});

describe("runInit --lang (template language)", () => {
  const EN_MARKER = "<!-- tasking-workflow-lang: en -->";
  const repo = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

  it("non-interactive --workflow minimal --lang en writes the English minimal template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "minimal",
        lang: "en",
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("kind: jira");
      expect(wf).toContain(EN_MARKER);
      expect(wf).toContain("optional: defaults below");
      expect(wf).toContain("# interval_ms: 30000");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow code-mr --lang en writes the English code-mr template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "code-mr",
        lang: "en",
      });
      expect(code).toBe(0);
      const codeMr = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(codeMr).toContain("<!-- tasking-workflow: code-mr -->");
      expect(codeMr).toContain(EN_MARKER);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow grill-openspec --lang en writes the English grill template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "grill-openspec",
        lang: "en",
      });
      expect(code).toBe(0);
      const grill = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(grill).toContain("## 🔍 拷问 / Grill Questions");
      expect(grill).toContain(EN_MARKER);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("omitting --lang generates the zh minimal template (trimmed, not byte-identical)", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("kind: jira");
      expect(wf).not.toContain(EN_MARKER);
      expect(wf).toContain("改动才解注释");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("unknown --lang errors with supported values and writes nothing", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        lang: "fr",
        output: stream,
      });
      expect(code).toBe(1);
      expect(content()).not.toContain("tasking initialized");
      expect(existsSync(join(dir, "WORKFLOW.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("--update detects the en sentinel and drift-reports against the English template", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "minimal",
        lang: "en",
      });
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        `${readFileSync(join(dir, "WORKFLOW.md"), "utf8")}\ndrift line\n`,
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain(
        "Template language: en (detected from WORKFLOW.md sentinel marker)",
      );
      expect(readFileSync(join(dir, ".tasking", "WORKFLOW.md.reference"), "utf8")).toBe(
        repo("assets/workflows/WORKFLOW.minimal.en.md.example"),
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("--update without a sentinel drift-reports against the zh template", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        `${readFileSync(join(dir, "WORKFLOW.md"), "utf8")}\ndrift line\n`,
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain(
        "Template language: zh (detected from WORKFLOW.md sentinel marker)",
      );
      expect(readFileSync(join(dir, ".tasking", "WORKFLOW.md.reference"), "utf8")).toBe(
        repo("assets/workflows/WORKFLOW.minimal.md.example"),
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("--update explicit --lang overrides detection and is annotated", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      writeFileSync(
        join(dir, "WORKFLOW.md"),
        `${readFileSync(join(dir, "WORKFLOW.md"), "utf8")}\ndrift line\n`,
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, lang: "en", output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("Template language: en (explicit --lang)");
      expect(readFileSync(join(dir, ".tasking", "WORKFLOW.md.reference"), "utf8")).toBe(
        repo("assets/workflows/WORKFLOW.minimal.en.md.example"),
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("skill installation set depends only on the variant, not on --lang", async () => {
    for (const workflow of ["minimal", "code-mr", "grill-openspec"] as const) {
      for (const lang of [undefined, "zh", "en"]) {
        const dir = tempDir();
        try {
          await runInit(dir, { force: false, nonInteractive: true, workflow, lang });
          const skills = existsSync(join(dir, ".opencode", "skills"))
            ? readdirSync(join(dir, ".opencode", "skills")).sort()
            : [];
          if (workflow === "minimal") {
            expect(skills).toEqual([]);
          } else if (workflow === "code-mr") {
            expect(skills).toEqual(["install-glab", "land"]);
          } else {
            expect(skills).toEqual([
              "install-glab",
              "land",
              "openspec-archive-change",
              "opsx-grill-with-docs",
              "opsx-implement",
              "opsx-propose-with-tdd",
            ]);
          }
        } finally {
          rmSync(dir, { recursive: true });
        }
      }
    }
  });

  it("interactive asks for template language when --lang not specified", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        workflow: "minimal",
        language: "English",
      });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const askedLanguage = prompts.calls.some((q) => q.toLowerCase().includes("language"));
      expect(askedLanguage).toBe(true);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain(EN_MARKER);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("interactive skips the language question when --lang specified", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        workflow: "minimal",
      });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
        lang: "zh",
      });
      expect(code).toBe(0);
      const askedLanguage = prompts.calls.some((q) => q.toLowerCase().includes("language"));
      expect(askedLanguage).toBe(false);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).not.toContain(EN_MARKER);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("feishu-direct variant (trackerless init)", () => {
  const repo = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

  it("non-interactive --workflow feishu-direct writes a trimmed zh template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "feishu-direct",
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("kind: none");
      expect(wf).toContain("<!-- tasking-workflow: feishu-direct -->");
      expect(wf).toContain("改动才解注释");
      expect(wf).not.toContain("<!-- tasking-workflow-lang: en -->");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive --workflow feishu-direct --lang en writes a trimmed en template", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "feishu-direct",
        lang: "en",
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("kind: none");
      expect(wf).toContain("<!-- tasking-workflow-lang: en -->");
      expect(wf).toContain("optional: defaults below");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("installs no tasking skills", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "feishu-direct" });
      expect(existsSync(join(dir, ".opencode", "skills", "land"))).toBe(false);
      expect(existsSync(join(dir, ".opencode", "skills", "install-glab"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("interactive flow skips Jira questions and Enable-Feishu, asks only feishu credentials", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const asked: string[] = [];
      let feishuAsk = 0;
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = ["cli_a", "cli_secret_a", "oc_intake"][feishuAsk] ?? "";
          feishuAsk++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          if (question.toLowerCase().includes("language")) return Promise.resolve("zh");
          if (question.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve("Task");
        },
        close(): void {},
      };
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({ tokenResults: [{ code: 0 }], chats: [] }),
      });
      expect(code).toBe(0);
      const q = asked.join("\n");
      expect(q).not.toContain("Jira REST API endpoint");
      expect(q).not.toContain("Jira API token");
      expect(q).not.toContain("project key");
      expect(q).not.toContain("Enable Feishu bridge");
      expect(q).toContain("Feishu app_id");
      expect(q).toContain("intake_chat_id");
      expect(content()).not.toContain("glab");
      expect(content()).not.toContain("GITLAB_TOKEN");
      expect(q).not.toContain("issue type");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("kind: none");
      expect(wf).toContain("app_id: cli_a");
      expect(wf).toContain("app_secret: cli_secret_a");
      expect(wf).toContain("intake_chat_id: oc_intake");
      expect(content()).toContain("feishu-direct");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive summary reports feishu enabled for feishu-direct", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "feishu-direct",
        output: stream,
      });
      expect(content()).toContain("direct-only");
      expect(content()).not.toContain("Feishu bridge:  disabled");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("unknown workflow error lists all four supported values", async () => {
    const dir = tempDir();
    try {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const code = await runInit(dir, { force: false, nonInteractive: true, workflow: "custom" });
      expect(code).toBe(1);
      const msg = spy.mock.calls.map((c) => String(c[0])).join("\n");
      spy.mockRestore();
      expect(msg).toContain("minimal, code-mr, grill-openspec, feishu-direct");
      const wf = join(dir, "WORKFLOW.md");
      expect(existsSync(wf)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("feishu-first onboarding (validation & chat selection)", () => {
  function feishuFlowStub(args: {
    asks: string[];
    chatSelect?: string;
  }): PromptInterface & { asked: string[] } {
    const asked: string[] = [];
    let askIdx = 0;
    return {
      ask(question: string): Promise<string> {
        asked.push(question);
        const v = args.asks[askIdx] ?? "";
        askIdx++;
        return Promise.resolve(v);
      },
      askSelect(
        question: string,
        options: ReadonlyArray<{ value: string; label: string }>,
      ): Promise<string> {
        asked.push(question);
        const q = question.toLowerCase();
        if (q.includes("language")) return Promise.resolve("zh");
        if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
        if (question.includes("intake")) {
          const picked = options.find((o) => o.label === args.chatSelect);
          return Promise.resolve(picked?.value ?? options[2]?.value ?? "");
        }
        return Promise.resolve("");
      },
      close(): void {},
      asked,
    };
  }

  it("validates credentials and offers a chat list selection", async () => {
    const dir = tempDir();
    try {
      const prompts = feishuFlowStub({ asks: ["cli_a", "sec_a"], chatSelect: "测试群B" });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({
          tokenResults: [{ code: 0 }],
          chats: [
            { chat_id: "oc_a", name: "测试群A" },
            { chat_id: "oc_b", name: "测试群B" },
          ],
        }),
      });
      expect(code).toBe(0);
      expect(prompts.asked.join("\n")).not.toContain("intake_chat_id");
      const q = prompts.asked.join("\n");
      expect(q).toContain("intake");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("app_id: cli_a");
      expect(wf).toContain("app_secret: sec_a");
      expect(wf).toContain("intake_chat_id: oc_b");
      expect(content()).toContain("测试群B");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("re-asks the secret once on a credential error and proceeds", async () => {
    const dir = tempDir();
    try {
      const prompts = feishuFlowStub({ asks: ["cli_a", "bad_secret", "good_secret"] });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({
          tokenResults: [{ code: 10003, msg: "app secret invalid" }, { code: 0 }],
          chats: [],
        }),
      });
      expect(code).toBe(0);
      expect(content()).toContain("App Secret 不正确");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("app_secret: good_secret");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("falls back to manual intake input when validation is skipped", async () => {
    const dir = tempDir();
    try {
      const prompts = feishuFlowStub({
        asks: ["cli_a", "bad_secret", "", "oc_manual"],
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({ tokenResults: [{ code: 10003 }] }),
      });
      expect(code).toBe(0);
      expect(content()).toContain("跳过");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("app_secret: bad_secret");
      expect(wf).toContain("intake_chat_id: oc_manual");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("falls back to manual intake input when the chat list call fails", async () => {
    const dir = tempDir();
    try {
      const prompts = feishuFlowStub({ asks: ["cli_a", "sec_a", "oc_manual2"] });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({ tokenResults: [{ code: 0 }], chatsFail: true }),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("intake_chat_id: oc_manual2");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("feishu-first onboarding (project question & path_roots)", () => {
  it("prefills projects and tightens path_roots when a project is provided", async () => {
    const dir = tempDir();
    const repoDir = tempDir();
    try {
      const asked: string[] = [];
      let askIdx = 0;
      const asks = ["cli_a", "sec_a", "tasking", repoDir];
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve("测试群A");
        },
        close(): void {},
      };
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({
          tokenResults: [{ code: 0 }],
          chats: [{ chat_id: "oc_a", name: "测试群A" }],
        }),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/projects:\n\s+tasking:\n\s+path: /);
      expect(wf).toContain(`path_roots: [${JSON.stringify(repoDir)}]`);
    } finally {
      rmSync(dir, { recursive: true });
      rmSync(repoDir, { recursive: true });
    }
  });

  it("re-asks the project directory when it does not exist", async () => {
    const dir = tempDir();
    const repoDir = tempDir();
    try {
      const asked: string[] = [];
      let askIdx = 0;
      const asks = ["cli_a", "sec_a", "tasking", "/no/such/dir", repoDir];
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve("测试群A");
        },
        close(): void {},
      };
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({
          tokenResults: [{ code: 0 }],
          chats: [{ chat_id: "oc_a", name: "测试群A" }],
        }),
      });
      expect(code).toBe(0);
      expect(content()).toContain("/no/such/dir");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/projects:\n\s+tasking:\n\s+path: /);
    } finally {
      rmSync(dir, { recursive: true });
      rmSync(repoDir, { recursive: true });
    }
  });

  it("keeps projects empty and path_roots unrestricted when skipped", async () => {
    const dir = tempDir();
    try {
      const asked: string[] = [];
      let askIdx = 0;
      const asks = ["cli_a", "sec_a", "oc_manual", ""];
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve("");
        },
        close(): void {},
      };
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({ tokenResults: [{ code: 10003 }] }),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/^\s+projects:\s*$/m);
      expect(wf).toContain("path_roots: []");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("feishu-first onboarding (graded completion hint)", () => {
  it("feishu-direct completion prints the first runnable command", async () => {
    const dir = tempDir();
    const repoDir = tempDir();
    try {
      const asked: string[] = [];
      let askIdx = 0;
      const asks = ["cli_a", "sec_a", "tasking", repoDir];
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve("测试群A");
        },
        close(): void {},
      };
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({
          tokenResults: [{ code: 0 }],
          chats: [{ chat_id: "oc_a", name: "测试群A" }],
        }),
      });
      expect(code).toBe(0);
      const out = content();
      expect(out).toContain("配置完成");
      expect(out).toContain("tasking start");
      expect(out).toContain("/chat tasking");
      expect(out).not.toContain("不限制");
    } finally {
      rmSync(dir, { recursive: true });
      rmSync(repoDir, { recursive: true });
    }
  });

  it("feishu-direct completion warns when the project question was skipped", async () => {
    const dir = tempDir();
    try {
      const asked: string[] = [];
      let askIdx = 0;
      const asks = ["cli_a", "sec_a", "oc_manual", ""];
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve("");
        },
        close(): void {},
      };
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({ tokenResults: [{ code: 10003 }] }),
      });
      expect(code).toBe(0);
      const out = content();
      expect(out).toContain("tasking start");
      expect(out).toContain("/chat");
      expect(out).toContain("不限制");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("jira-variant completion keeps the manual-fields hint", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        workflow: "minimal",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: mockFetchFailure(),
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(content()).toContain("active_states");
      expect(content()).toContain("after_create");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("feishu-first onboarding (chat name collisions)", () => {
  it("disambiguates duplicate chat names by chat_id label", async () => {
    const dir = tempDir();
    try {
      const asked: string[] = [];
      let askIdx = 0;
      const asks = ["cli_a", "sec_a", ""];
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string, options: string[]): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve(options[3]?.value ?? "");
        },
        close(): void {},
      };
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({
          tokenResults: [{ code: 0 }],
          chats: [
            { chat_id: "oc_x", name: "同名群" },
            { chat_id: "oc_y", name: "同名群" },
          ],
        }),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("intake_chat_id: oc_y");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("feishu-first onboarding (home expansion)", () => {
  it("expands ~ when validating the project directory", async () => {
    const dir = tempDir();
    try {
      const { homedir } = await import("node:os");
      const { realpathSync } = await import("node:fs");
      const asked: string[] = [];
      let askIdx = 0;
      const asks = ["cli_a", "sec_a", "home", "~"];
      const prompts = {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
          return Promise.resolve("测试群A");
        },
        close(): void {},
      };
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: feishuApiFetch({
          tokenResults: [{ code: 0 }],
          chats: [{ chat_id: "oc_a", name: "测试群A" }],
        }),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain(`path: ${realpathSync(homedir())}`);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("generated config trimming", () => {
  it("keeps non-interactive feishu-direct output to active sections plus commented optionals", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "feishu-direct" });
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      const template = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.feishu-direct.md.example"),
        "utf8",
      );
      expect(wf).not.toBe(template);
      expect(wf).toMatch(/^tracker:/m);
      expect(wf).toMatch(/^feishu:/m);
      expect(wf).not.toMatch(/^polling:/m);
      expect(wf).toContain("# polling:");
      expect(wf).toContain("# interval_ms: 30000");
      expect(wf).toContain("改动才解注释");
      expect(wf).not.toMatch(/^hooks:/m);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("keeps minimal active sections (tracker/hooks/feishu) and comments env", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/^tracker:/m);
      expect(wf).toMatch(/^hooks:/m);
      expect(wf).toMatch(/^feishu:/m);
      expect(wf).not.toMatch(/^env:/m);
      expect(wf).toContain("# env:");
      expect(wf).not.toMatch(/^polling:/m);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("keeps env active for MR variants", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "code-mr" });
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/^env:/m);
      expect(wf).not.toMatch(/^polling:/m);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("leaves only enabled:false active in a disabled feishu section", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/^feishu:/m);
      expect(wf).toMatch(/^\s+enabled: false/m);
      expect(wf).not.toMatch(/^\s+app_id:/m);
      expect(wf).toMatch(/^\s+# app_id:/m);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("comments optionals preserving template defaults", () => {
    const template = readFileSync(
      join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
      "utf8",
    );
    const out = trimFrontmatter(template, { workflow: "minimal", feishuEnabled: true, lang: "zh" });
    expect(out).toContain("# interval_ms: 30000");
    expect(out).toContain("# max_concurrent_agents: 10");
    expect(out).toMatch(/^minimal|^tracker:/m);
  });

  it("all shipped templates expose exactly the known top-level sections", () => {
    const files = [
      "WORKFLOW.minimal.md.example",
      "WORKFLOW.minimal.en.md.example",
      "WORKFLOW.code-mr.md.example",
      "WORKFLOW.code-mr.en.md.example",
      "WORKFLOW.grill-openspec.md.example",
      "WORKFLOW.grill-openspec.en.md.example",
      "WORKFLOW.feishu-direct.md.example",
      "WORKFLOW.feishu-direct.en.md.example",
    ];
    const expected = ["interface_language", ...TEMPLATE_SECTIONS].sort();
    for (const f of files) {
      const content = readFileSync(join(process.cwd(), "assets", "workflows", f), "utf8");
      expect(templateTopLevelKeys(content).sort(), f).toEqual(expected);
    }
  });

  it("generated output parses as valid YAML for every variant", async () => {
    const variants = ["feishu-direct", "minimal", "code-mr", "grill-openspec"] as const;
    for (const workflow of variants) {
      const dir = tempDir();
      try {
        await runInit(dir, { force: false, nonInteractive: true, workflow });
        const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
        const def = parseWorkflowContent(wf, "WORKFLOW.md");
        const feishu =
          (def.config.feishu as { enabled?: boolean; direct?: unknown } | undefined) ?? {};
        if (workflow === "feishu-direct") {
          expect(feishu.enabled, workflow).toBe(true);
          expect(feishu.direct, workflow).toBeDefined();
        } else {
          expect(feishu.enabled, workflow).toBe(false);
          expect(feishu.direct, workflow).toBeUndefined();
        }
      } finally {
        rmSync(dir, { recursive: true });
      }
    }
  });

  it("comments the router dead config and webhook fields in generated output", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).not.toMatch(/^router:/m);
      expect(wf).toContain("未实现");
      expect(wf).not.toMatch(/^\s+verification_token:/m);
      expect(wf).not.toMatch(/^\s+encrypt_key:/m);
      expect(wf).toContain("预留");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("every variant active section is a known template section", () => {
    for (const [variant, sections] of Object.entries(VARIANT_ACTIVE_SECTIONS)) {
      for (const s of sections) {
        expect([...TEMPLATE_SECTIONS], `${variant}:${s}`).toContain(s);
      }
    }
  });
});

describe("jira state autofill", () => {
  function jiraFlowPrompts(stateAnswer: "confirm" | "keep", statuses: string[]) {
    const asked: string[] = [];
    let askIdx = 0;
    const asks = ["http://jira.example.com/rest/api/2", "token", "HEIH"];
    return {
      asked,
      fetch: mockFetchSuccess(statuses),
      prompts: {
        ask(question: string): Promise<string> {
          asked.push(question);
          const v = asks[askIdx] ?? "";
          askIdx++;
          return Promise.resolve(v);
        },
        askSelect(question: string): Promise<string> {
          asked.push(question);
          const q = question.toLowerCase();
          if (q.includes("任务来源")) return Promise.resolve("jira");
          if (q.includes("language")) return Promise.resolve("zh");
          if (q.includes("workflow")) return Promise.resolve("minimal");
          if (question.includes("写入状态配置")) {
            return Promise.resolve(stateAnswer);
          }
          if (q.includes("enable feishu")) return Promise.resolve("no");
          return Promise.resolve("bearer");
        },
        close(): void {},
      },
    };
  }

  it("classifies common zh/en status names into buckets", () => {
    const buckets = classifyProjectStatuses([
      "待办",
      "处理中",
      "代码评审中",
      "完成",
      "关闭",
      "已评审待发布",
    ]);
    expect(buckets.active).toEqual(["待办", "处理中"]);
    expect(buckets.review).toEqual(["代码评审中"]);
    expect(buckets.terminal).toEqual(["完成", "关闭"]);
    expect(buckets.unmatched).toEqual(["已评审待发布"]);
  });

  it("writes the mapped states when the user confirms", async () => {
    const dir = tempDir();
    try {
      const statuses = ["待办", "处理中", "代码评审中", "完成", "关闭"];
      const { prompts } = jiraFlowPrompts("confirm", statuses);
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: mockFetchSuccess(statuses),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/review_state: 代码评审中/);
      expect(wf).toMatch(/active_states:\n\s+- 待办\n\s+- 处理中/);
      expect(wf).toMatch(/terminal_states:\n\s+- 完成\n\s+- 关闭/);
      expect(content()).not.toContain("active_states     Jira states");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("keeps template defaults when the user declines", async () => {
    const dir = tempDir();
    try {
      const statuses = ["待办", "处理中", "代码评审中", "完成", "关闭"];
      const { prompts } = jiraFlowPrompts("keep", statuses);
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: mockFetchSuccess(statuses),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toMatch(/review_state: null/);
      expect(content()).toContain("active_states");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("does not ask when a bucket is empty", async () => {
    const dir = tempDir();
    try {
      const statuses = ["待办", "处理中"]; // no terminal match
      const { prompts, asked } = jiraFlowPrompts("confirm", statuses);
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: mockFetchSuccess(statuses),
      });
      expect(code).toBe(0);
      expect(asked.some((q) => q.includes("写入状态配置"))).toBe(false);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toMatch(/review_state: null/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("feishu setup 体检与建群", () => {
  function makeFetch(routes: {
    chatsGet?: () => Response;
    chatsPost?: () => Response;
    messages?: () => Response;
    files?: () => Response;
    lookupFail?: boolean;
  }): typeof fetch & { log: string[] } {
    const log: string[] = [];
    const f = (async (url: RequestInfo | URL, init: RequestInit) => {
      const u = url.toString();
      const method = init.method ?? "GET";
      const bodyText = typeof init.body === "string" ? init.body : "";
      log.push(`${method} ${u} ${bodyText}`.trimEnd());
      if (bodyText.includes("app_id")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "tok-e2e" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("batch_get_id")) {
        if (routes.lookupFail) {
          return new Response(JSON.stringify({ code: 230027, msg: "no scope" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ data: { user_list: [{ user_id: "ou_me" }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/im/v1/chats") && method === "POST") {
        return (routes.chatsPost ?? (() => new Response("{}", { status: 500 })))();
      }
      if (u.includes("/im/v1/chats")) {
        return (
          routes.chatsGet ??
          (() =>
            new Response(
              JSON.stringify({
                data: { items: [{ chat_id: "oc_exist", name: "已有群" }] },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ))
        )();
      }
      if (u.includes("/im/v1/messages")) {
        return (
          routes.messages ??
          (() =>
            new Response(JSON.stringify({ data: { items: [] } }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }))
        )();
      }
      if (u.includes("/im/v1/files")) {
        return (
          routes.files ??
          (() =>
            new Response(JSON.stringify({ data: { file_key: "fk" } }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }))
        )();
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return Object.assign(f, { log });
  }

  function makeDirectPrompts(opts: {
    chatPicks?: string[];
    groupNames?: string[];
    invite?: string;
  }): PromptInterface {
    let pickIdx = 0;
    let askIdx = 0;
    const asks = ["cli_abc", "", ...(opts.groupNames ?? []), opts.invite ?? ""];
    return {
      ask(question: string): Promise<string> {
        if (question.includes("常用项目名")) return Promise.resolve("");
        const val = asks[askIdx] ?? "";
        askIdx++;
        return Promise.resolve(val);
      },
      askSelect(
        question: string,
        options: ReadonlyArray<{ value: string; label: string }>,
      ): Promise<string> {
        const q = question.toLowerCase();
        if (q.includes("任务来源")) return Promise.resolve("feishu-direct");
        if (q.includes("language")) return Promise.resolve("zh");
        if (q.includes("intake 群")) {
          const pick = (opts.chatPicks ?? [])[pickIdx];
          pickIdx++;
          if (pick !== undefined) {
            const byLabel = options.find((o) => o.label === pick);
            return Promise.resolve(byLabel?.value ?? pick);
          }
          return Promise.resolve(options[0]?.value ?? "");
        }
        return Promise.resolve(options[0]?.value ?? "");
      },
      close(): void {},
    };
  }

  it("direct path runs probes and warns without blocking on missing scope", async () => {
    const dir = tempDir();
    try {
      const fetchMock = makeFetch({
        messages: () =>
          new Response(JSON.stringify({ code: 230027, msg: "no scope" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      });
      const prompts = makeDirectPrompts({ chatPicks: ["已有群"] });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("oc_exist");
      const out = content();
      expect(out).toContain("im:message.group_msg");
      expect(out).toContain("/safe/permission");
      expect(out).toContain("im:message");
      expect(out).toContain("/version");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("bridge path prints the same 体检 block when feishu is enabled", async () => {
    const dir = tempDir();
    try {
      const prompts = makeFeishuPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
        app_id: "cli_abc",
        app_secret: "",
        intake_chat_id: "oc_intake_1",
      });
      const fetchMock = makeFetch({});
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      const out = content();
      expect(out).toContain("读群消息");
      expect(out).toContain("im:message.send_as_bot".replace("send_as_bot", "group_msg"));
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain(
        "intake_chat_id: oc_intake_1",
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("creates the intake chat with the inviting user as member", async () => {
    const dir = tempDir();
    try {
      const fetchMock = makeFetch({
        chatsPost: () =>
          new Response(JSON.stringify({ data: { chat_id: "oc_new" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      });
      const prompts = makeDirectPrompts({
        chatPicks: ["➕ 新建 intake 群（并拉你进群）"],
        groupNames: [""],
        invite: "me@example.com",
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain("oc_new");
      const createCall = fetchMock.log.find(
        (l) => l.startsWith("POST") && l.includes("/im/v1/chats"),
      );
      expect(createCall).toBeDefined();
      expect(createCall).toContain("tasking-intake");
      expect(createCall).toContain("ou_me");
      expect(content()).toContain("oc_new");
      expect(content()).toContain("你已在群里");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("degrades to manual pick when chat creation lacks im:chat", async () => {
    const dir = tempDir();
    try {
      const fetchMock = makeFetch({
        chatsPost: () =>
          new Response(JSON.stringify({ code: 99991672, msg: "Access denied" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
      });
      const prompts = makeDirectPrompts({
        chatPicks: ["➕ 新建 intake 群（并拉你进群）", "已有群"],
        groupNames: [""],
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain("oc_exist");
      const out = content();
      expect(out).toContain("im:chat");
      expect(out).toContain("/safe/permission");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("message probe targets the selected chat id", async () => {
    const dir = tempDir();
    try {
      const fetchMock = makeFetch({});
      const prompts = makeDirectPrompts({ chatPicks: ["已有群"] });
      const { stream } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      const msgCall = fetchMock.log.find((l) => l.includes("/im/v1/messages?"));
      expect(msgCall).toBeDefined();
      expect(msgCall).toContain("container_id=oc_exist");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("warns and refuses a bot-only chat when the invite is skipped", async () => {
    const dir = tempDir();
    try {
      const fetchMock = makeFetch({
        chatsPost: () =>
          new Response(JSON.stringify({ data: { chat_id: "oc_lone" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      });
      const prompts = makeDirectPrompts({
        chatPicks: ["➕ 新建 intake 群（并拉你进群）", "已有群"],
        groupNames: [""],
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain("oc_exist");
      const out = content();
      expect(out).toContain("只有机器人成员");
      expect(out).toContain("⟳ 刷新群列表");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("warns about contact scope when user lookup is denied", async () => {
    const dir = tempDir();
    try {
      const fetchMock = makeFetch({
        lookupFail: true,
        chatsPost: () =>
          new Response(JSON.stringify({ data: { chat_id: "oc_lone" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      });
      const prompts = makeDirectPrompts({
        chatPicks: ["➕ 新建 intake 群（并拉你进群）", "已有群"],
        groupNames: [""],
        invite: "me@example.com",
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      expect(content()).toContain("contact:user.id:readonly");
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain("oc_exist");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("refreshes the chat list when the refresh option is picked", async () => {
    const dir = tempDir();
    try {
      let chatsCall = 0;
      const fetchMock = makeFetch({
        chatsGet: () => {
          chatsCall++;
          return new Response(
            JSON.stringify({
              data: {
                items:
                  chatsCall === 1
                    ? [{ chat_id: "oc_exist", name: "已有群" }]
                    : [
                        { chat_id: "oc_exist", name: "已有群" },
                        { chat_id: "oc_manual", name: "手动群" },
                      ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });
      const prompts = makeDirectPrompts({
        chatPicks: ["⟳ 刷新群列表", "手动群"],
      });
      const { stream, content } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        fetchImpl: fetchMock,
        promptInterface: prompts,
      });
      expect(content()).toContain("已刷新（2 个群）");
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toContain("oc_manual");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("non-interactive init issues no chat-creation requests", async () => {
    const dir = tempDir();
    try {
      const fetchMock = makeFetch({});
      await runInit(dir, { force: false, nonInteractive: true, fetchImpl: fetchMock });
      expect(
        fetchMock.log.filter((l) => l.startsWith("POST") && l.includes("/im/v1/chats")),
      ).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("interface_language seeding", () => {
  it("non-interactive --lang en writes interface_language: en", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "minimal",
        lang: "en",
        output: stream,
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("interface_language: en");
      expect(content()).not.toMatch(/[\u4e00-\u9fff]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("non-interactive default zh omits interface_language", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, { force: false, nonInteractive: true });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).not.toContain("interface_language");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("interactive English selection seeds interface_language: en", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        promptInterface: makeMockPrompts({
          endpoint: "https://jira.example.com",
          token: "tok",
          auth_mode: "basic",
          api_user: "you@example.com",
          project_key: "ENG",
          language: "English",
        }),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("interface_language: en");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("interactive 中文 selection omits interface_language", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        promptInterface: makeMockPrompts({
          endpoint: "https://jira.example.com",
          token: "tok",
          auth_mode: "basic",
          api_user: "you@example.com",
          project_key: "ENG",
          language: "中文",
        }),
      });
      expect(code).toBe(0);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).not.toContain("interface_language");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--update leaves interface_language unlisted for zh files (trimmed by design)", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const before = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).not.toContain("interface_language");
      expect(readFileSync(join(dir, "WORKFLOW.md"), "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("feishu edition question", () => {
  interface StubOpts {
    lang?: string;
    version?: string;
    asks?: string[];
    bridgeEnable?: "yes" | "no";
  }

  function stub(opts: StubOpts = {}): PromptInterface & {
    asked: string[];
    versionOptions: string[][];
  } {
    const asked: string[] = [];
    const versionOptions: string[][] = [];
    let askIdx = 0;
    return {
      ask(question: string): Promise<string> {
        asked.push(question);
        const v = opts.asks?.[askIdx] ?? "";
        askIdx++;
        return Promise.resolve(v);
      },
      askSelect(
        question: string,
        options: ReadonlyArray<{ value: string; label: string }>,
      ): Promise<string> {
        asked.push(question);
        const lq = question.toLowerCase();
        if (lq.includes("language")) return Promise.resolve(opts.lang === "English" ? "en" : "zh");
        if (question.includes("任务来源")) return Promise.resolve("feishu-direct");
        if (lq.includes("enable feishu")) return Promise.resolve(opts.bridgeEnable ?? "yes");
        if (question.includes("版本") || lq.includes("edition")) {
          versionOptions.push(options.map((o) => o.label));
          const byLabel = options.find((o) => o.label === opts.version);
          return Promise.resolve(byLabel?.value ?? options[0]?.value ?? "");
        }
        if (question.includes("intake")) return Promise.resolve("oc_intake_1");
        if (lq.includes("issue type")) return Promise.resolve(options[0]?.value ?? "");
        return Promise.resolve(options[0]?.value ?? "");
      },
      close(): void {},
      asked,
      versionOptions,
    };
  }

  function capturingFeishuFetch(urls: string[]): typeof fetch {
    return (async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      urls.push(u);
      if (u.includes("tenant_access_token")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-1", expire: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/im/v1/chats")) {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  it("asks the edition first and preselects 国内版 for a Chinese template", async () => {
    const dir = tempDir();
    try {
      const prompts = stub({ lang: "中文", asks: ["cli_a", "sec_a", "oc_intake_1"] });
      const { stream } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: capturingFeishuFetch([]),
      });
      expect(prompts.versionOptions.length).toBe(1);
      const options = prompts.versionOptions[0] ?? [];
      expect(options[0]).toContain("国内版（飞书）");
      const versionIdx = prompts.asked.findIndex((q) => q.includes("版本"));
      const appIdIdx = prompts.asked.findIndex((q) => q.includes("app_id"));
      expect(versionIdx).toBeGreaterThanOrEqual(0);
      expect(versionIdx).toBeLessThan(appIdIdx);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preselects 海外版 (Lark) for an English template", async () => {
    const dir = tempDir();
    try {
      const prompts = stub({ lang: "English", asks: ["cli_a", "sec_a", "oc_intake_1"] });
      const { stream } = mockOutput();
      await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: capturingFeishuFetch([]),
      });
      const options = prompts.versionOptions[0] ?? [];
      expect(options[0]).toContain("海外版（Lark）");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses Lark domains, writes edition, and threads it into validation", async () => {
    const dir = tempDir();
    try {
      const urls: string[] = [];
      const prompts = stub({
        lang: "English",
        version: "海外版（Lark）",
        asks: ["cli_a", "sec_a", "oc_intake_1"],
      });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: capturingFeishuFetch(urls),
      });
      expect(code).toBe(0);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u.startsWith("https://open.larksuite.com/")).toBe(true);
      }
      expect(content()).toContain("list chats");
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).toContain("edition: lark");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows the cross-region hint when credential validation fails", async () => {
    const dir = tempDir();
    try {
      const prompts = stub({ lang: "中文", asks: ["cli_a", "bad", "", "oc_intake_1"] });
      const { stream, content } = mockOutput();
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ code: 10014, msg: "app not exist" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch;
      await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl,
      });
      expect(content()).toContain("feishu.edition");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not ask or write edition when the bridge is disabled", async () => {
    const dir = tempDir();
    try {
      const prompts = makeMockPrompts({
        endpoint: "http://jira.example.com/rest/api/2",
        token: "token",
        auth_mode: "bearer",
        project_key: "HEIH",
      });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        output: stream,
        promptInterface: prompts,
        fetchImpl: mockFetchFailure(),
      });
      expect(code).toBe(0);
      expect(prompts.calls.some((q) => q.includes("版本"))).toBe(false);
      const wf = readFileSync(join(dir, "WORKFLOW.md"), "utf8");
      expect(wf).not.toMatch(/^ {2}edition:/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit workflow path", () => {
  it("generates at a custom path with companions beside it", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "code-mr",
        workflowPath: "configs/my-flow.md",
        output: mockOutput().stream,
      });
      expect(code).toBe(0);
      expect(existsSync(join(dir, "configs", "my-flow.md"))).toBe(true);
      expect(existsSync(join(dir, "WORKFLOW.md"))).toBe(false);
      expect(existsSync(join(dir, "configs", ".opencode", "skills", "land", "SKILL.md"))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recursively creates missing parent directories", async () => {
    const dir = tempDir();
    try {
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflowPath: "deep/a/b/WORKFLOW.md",
        output: mockOutput().stream,
      });
      expect(code).toBe(0);
      expect(existsSync(join(dir, "deep", "a", "b", "WORKFLOW.md"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors when the positional points at a directory", async () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, "sub"));
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflowPath: "sub",
        output: stream,
      });
      expect(code).toBe(1);
      expect(content()).toMatch(/not a directory|must be a file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("backs up a custom path as <path>.bak on --force", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflowPath: "my.md",
        output: mockOutput().stream,
      });
      writeFileSync(join(dir, "my.md"), "user edit", "utf8");
      const code = await runInit(dir, {
        force: true,
        nonInteractive: true,
        workflowPath: "my.md",
        output: mockOutput().stream,
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "my.md.bak"), "utf8")).toBe("user edit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("syncs skills at a custom path on --update", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "code-mr",
        workflowPath: "configs/my-flow.md",
        output: mockOutput().stream,
      });
      rmSync(join(dir, "configs", ".opencode", "skills", "land"), { recursive: true });
      const { stream } = mockOutput();
      const code = await runInit(dir, {
        update: true,
        workflowPath: "configs/my-flow.md",
        output: stream,
      });
      expect(code).toBe(0);
      expect(existsSync(join(dir, "configs", ".opencode", "skills", "land", "SKILL.md"))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors naming the missing custom path on --update", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        update: true,
        workflowPath: "configs/missing.md",
        output: stream,
      });
      expect(code).toBe(1);
      expect(content()).toContain("configs/missing.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors on --restore when an explicit path is missing", async () => {
    const dir = tempDir();
    try {
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        restore: true,
        workflowPath: "configs/missing.md",
        output: stream,
      });
      expect(code).toBe(1);
      expect(content()).toContain("configs/missing.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names the drift reference after the custom file", async () => {
    const dir = tempDir();
    try {
      const template = readFileSync(
        join(process.cwd(), "assets", "workflows", "WORKFLOW.minimal.md.example"),
        "utf8",
      );
      mkdirSync(join(dir, "configs"));
      writeFileSync(
        join(dir, "configs", "my-flow.md"),
        `${template}\n<!-- local body edit -->\n`,
        "utf8",
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        update: true,
        workflowPath: "configs/my-flow.md",
        output: stream,
      });
      expect(code).toBe(0);
      const ref = join(dir, "configs", ".tasking", "my-flow.md.reference");
      expect(existsSync(ref)).toBe(true);
      expect(content()).toContain(".tasking/my-flow.md.reference");
      expect(content()).toContain("git diff --no-index my-flow.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores skill backups beside a custom path", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, {
        force: false,
        nonInteractive: true,
        workflow: "code-mr",
        workflowPath: "configs/my-flow.md",
        output: mockOutput().stream,
      });
      const skill = join(dir, "configs", ".opencode", "skills", "land", "SKILL.md");
      writeFileSync(skill, "custom", "utf8");
      await runInit(dir, {
        update: true,
        workflowPath: "configs/my-flow.md",
        output: mockOutput().stream,
      });
      expect(readFileSync(`${skill}.bak`, "utf8")).toBe("custom");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, {
        restore: true,
        workflowPath: "configs/my-flow.md",
        output: stream,
      });
      expect(code).toBe(0);
      expect(readFileSync(skill, "utf8")).toBe("custom");
      expect(content()).toContain("restored");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit --update drift baseline", () => {
  it("helper output matches the generator path for every variant", async () => {
    for (const wf of ["minimal", "code-mr", "grill-openspec", "feishu-direct"] as const) {
      const viaGenerator = generateWorkflowContent(null, wf, null, "zh");
      const viaHelper = applyTemplateTrimming(
        readFileSync(
          join(process.cwd(), "assets", "workflows", `WORKFLOW.${wf}.md.example`),
          "utf8",
        ),
        wf,
        wf === "feishu-direct",
        "zh",
      );
      expect(viaHelper).toBe(viaGenerator);
    }
  });

  it("a fresh generated file reports zero drift and writes no reference", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toMatch(/no missing config fields/i);
      expect(content()).toContain("identical");
      expect(existsSync(join(dir, ".tasking", "WORKFLOW.md.reference"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fresh feishu-direct file (the original repro) stays clean too", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toMatch(/no missing config fields/i);
      expect(content()).not.toContain("interface_language");
      expect(content()).not.toContain("opencode.variant");
      expect(existsSync(join(dir, ".tasking", "WORKFLOW.md.reference"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a field missing from an active section", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const wfPath = join(dir, "WORKFLOW.md");
      let wf = readFileSync(wfPath, "utf8");
      wf = wf.replace(/\n {2}timeout_ms: 60000/, "");
      writeFileSync(wfPath, wf, "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("hooks.timeout_ms");
      expect(content()).toContain("DEFAULTS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mirrors feishu.enabled: enabled minimal file hears about feishu keys", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const wfPath = join(dir, "WORKFLOW.md");
      const wf = readFileSync(wfPath, "utf8").replace(/^( {2})enabled: false$/m, "$1enabled: true");
      writeFileSync(wfPath, wf, "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("feishu.app_id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disabled feishu section: inner keys stay unreported", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const { stream, content } = mockOutput();
      await runInit(dir, { update: true, output: stream });
      expect(content()).not.toContain("feishu.app_id");
      expect(content()).not.toContain("feishu.intake_chat_id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("feishu-direct missing feishu key is reported against the enabled baseline", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const wfPath = join(dir, "WORKFLOW.md");
      const wf = readFileSync(wfPath, "utf8").replace(/\n {2}intake_chat_id: .*/, "");
      writeFileSync(wfPath, wf, "utf8");
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("feishu.intake_chat_id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit --update baseline override", () => {
  it("--workflow switches both baseline and report template", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true });
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, workflow: "code-mr", output: stream });
      expect(code).toBe(0);
      const out = content();
      expect(out).toContain("Workflow: code-mr");
      expect(out).toContain("explicit --workflow");
      expect(out).toMatch(/- hooks \(default: /);
      expect(out).toMatch(/- env \(default: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit --update report wording", () => {
  it("header names the fresh-init baseline", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal" });
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(
        wfPath,
        readFileSync(wfPath, "utf8").replace(/\n {2}timeout_ms: 60000/, ""),
        "utf8",
      );
      const { stream, content } = mockOutput();
      await runInit(dir, { update: true, output: stream });
      const out = content();
      expect(out).toContain("fields missing vs a fresh init today");
      expect(out).not.toContain("optional sections are commented out in generated files");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit --update en baseline", () => {
  it("--lang en baseline includes interface_language; a missing one is reported", async () => {
    const dir = tempDir();
    try {
      await runInit(dir, { force: false, nonInteractive: true, workflow: "minimal", lang: "en" });
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(
        wfPath,
        readFileSync(wfPath, "utf8").replace(/^interface_language: en\n/m, ""),
        "utf8",
      );
      const { stream, content } = mockOutput();
      const code = await runInit(dir, { update: true, output: stream });
      expect(code).toBe(0);
      expect(content()).toContain("interface_language");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

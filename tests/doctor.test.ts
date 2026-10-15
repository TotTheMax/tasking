import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/cli/doctor.js";
import { setLocale } from "../src/translate/locale.js";

function mockOutput(): { stream: Writable; content: () => string } {
  let buffer = "";
  const stream = new Writable({
    write(chunk: Buffer | string, _enc: unknown, cb: (err?: Error | null) => void) {
      buffer += chunk.toString();
      cb();
    },
  });
  return { stream, content: () => buffer };
}

function feishuFetch(
  routes: { chats?: Array<{ chat_id: string; name: string }>; tokenOk?: boolean } = {},
): typeof fetch {
  return (async (url: RequestInfo | URL, init: RequestInit) => {
    const u = url.toString();
    const bodyText = typeof init.body === "string" ? init.body : "";
    if (u.includes("tenant_access_token")) {
      if (routes.tokenOk === false) {
        return new Response(JSON.stringify({ code: 10003, msg: "app secret invalid" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-doc" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/im/v1/chats")) {
      return new Response(
        JSON.stringify({ data: { items: routes.chats ?? [{ chat_id: "oc_exist", name: "g" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/im/v1/messages")) {
      return new Response(JSON.stringify({ data: { items: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/im/v1/files")) {
      return new Response(JSON.stringify({ data: { file_key: "fk" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("serverInfo")) {
      return new Response(JSON.stringify({ version: "9.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

function writeWorkflow(dir: string, frontmatter: string): void {
  writeFileSync(join(dir, "WORKFLOW.md"), `---\n${frontmatter}\n---\n\n# body\n`, "utf8");
}

const ocOk = (): string => "2.0.29";
const ocMissing = (): null => null;
const svcRunning = () => ({ status: "running" as const, url: "http://127.0.0.1:49374" });
const svcStopped = () => ({ status: "stopped" as const });
const authOk = () => ({ ok: true, detail: "zhipuai-coding-plan" });

describe("tasking doctor", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "tasking-doctor-"));
    dirs.push(d);
    return d;
  }

  it("prints the tasking version as the first output line", async () => {
    const dir = tempDir();
    const { stream, content } = mockOutput();
    await runDoctor(dir, stream, {});
    expect(content()).toMatch(/^tasking \d+\.\d+\.\d+\n/);
  });

  it("exits 0 when everything passes (feishu-direct)", async () => {
    const dir = tempDir();
    writeWorkflow(
      dir,
      [
        "tracker:",
        "  kind: none",
        "feishu:",
        "  enabled: true",
        "  app_id: cli_abc",
        "  app_secret: sec",
        "  intake_chat_id: oc_exist",
      ].join("\n"),
    );
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      fetchImpl: feishuFetch(),
      opencodeVersion: ocOk,
    });
    expect(code).toBe(0);
    const out = content();
    expect(out).toContain("WORKFLOW.md");
    expect(out).toContain("im:chat");
    expect(out).toContain("oc_exist");
    expect(out).toContain("汇总");
    expect(out).not.toContain("失败 1");
  });

  it("marks feishu/jira skipped and exits 1 when WORKFLOW.md is broken", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "WORKFLOW.md"), "---\ntracker:\n  kind: none\n", "utf8");
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, { opencodeVersion: ocOk });
    expect(code).toBe(1);
    const out = content();
    expect(out).toContain("WORKFLOW.md");
    expect(out).toContain("front matter not closed");
    expect(out).toMatch(/−.*飞书/);
    expect(out).toMatch(/−.*Jira/);
  });

  it("exits 1 with init hint when WORKFLOW.md is missing", async () => {
    const dir = tempDir();
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, { opencodeVersion: ocOk });
    expect(code).toBe(1);
    expect(content()).toContain("tasking init");
  });

  it("checks the Jira connection for jira workflows", async () => {
    const dir = tempDir();
    writeWorkflow(
      dir,
      [
        "tracker:",
        "  kind: jira",
        "  endpoint: http://jira.example.com/rest/api/2",
        "  api_key: tok",
        "  project_key: HEIH",
        '  active_states: ["In Progress"]',
        '  terminal_states: ["Done"]',
      ].join("\n"),
    );
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      fetchImpl: feishuFetch(),
      opencodeVersion: ocOk,
    });
    expect(code).toBe(0);
    expect(content()).toContain("9.0");
  });

  it("fails when the intake chat is not among the bot's chats", async () => {
    const dir = tempDir();
    writeWorkflow(
      dir,
      [
        "tracker:",
        "  kind: none",
        "feishu:",
        "  enabled: true",
        "  app_id: cli_abc",
        "  app_secret: sec",
        "  intake_chat_id: oc_elsewhere",
      ].join("\n"),
    );
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      fetchImpl: feishuFetch(),
      opencodeVersion: ocOk,
    });
    expect(code).toBe(1);
    expect(content()).toContain("机器人");
  });

  it("fails with install guidance when opencode is not on PATH", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, { opencodeVersion: ocMissing });
    expect(code).toBe(1);
    expect(content()).toContain("opencode");
  });

  it("fails when opencode major version is unsupported", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      opencodeVersion: () => "1.19.0",
      opencodeService: svcRunning,
      opencodeAuth: authOk,
    });
    expect(code).toBe(1);
    expect(content()).toContain("opencode upgrade --major");
  });

  it("warns but passes on unvalidated 2.x minors", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      opencodeVersion: () => "2.3.1",
      opencodeService: svcRunning,
      opencodeAuth: authOk,
    });
    expect(code).toBe(0);
    expect(content()).toContain("未经验证");
  });

  it("passes cleanly on validated 2.0.x", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      opencodeVersion: ocOk,
      opencodeService: svcRunning,
      opencodeAuth: authOk,
    });
    expect(code).toBe(0);
    expect(content()).not.toContain("未经验证");
    expect(content()).toContain("http://127.0.0.1:49374");
  });

  it("reports stopped service as info without failing", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      opencodeVersion: ocOk,
      opencodeService: svcStopped,
      opencodeAuth: authOk,
    });
    expect(code).toBe(0);
    expect(content()).toContain("未运行");
  });

  it("fails when the registered service is unreachable", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      opencodeVersion: ocOk,
      opencodeService: () => ({ status: "unreachable" as const, url: "http://127.0.0.1:1" }),
      opencodeAuth: authOk,
    });
    expect(code).toBe(1);
    expect(content()).toContain("服务");
  });

  it("fails when opencode auth is unavailable", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      opencodeVersion: ocOk,
      opencodeService: svcRunning,
      opencodeAuth: () => ({ ok: false, detail: "无已认证 provider" }),
    });
    expect(code).toBe(1);
    expect(content()).toContain("认证");
  });

  it("fails feishu credential check when token request rejects", async () => {
    const dir = tempDir();
    writeWorkflow(
      dir,
      [
        "tracker:",
        "  kind: none",
        "feishu:",
        "  enabled: true",
        "  app_id: cli_abc",
        "  app_secret: wrong",
        "  intake_chat_id: oc_exist",
      ].join("\n"),
    );
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, {
      fetchImpl: feishuFetch({ tokenOk: false }),
      opencodeVersion: ocOk,
    });
    expect(code).toBe(1);
    expect(content()).toContain("凭据");
  });

  it("renders english output with no Chinese when interface_language is en", async () => {
    const dir = tempDir();
    writeWorkflow(dir, ["interface_language: en", "tracker:", "  kind: none"].join("\n"));
    const { stream, content } = mockOutput();
    let code: number;
    try {
      code = await runDoctor(dir, stream, { opencodeVersion: () => null });
    } finally {
      setLocale("zh");
    }
    expect(code).toBe(1);
    const out = content();
    expect(out).not.toMatch(/[\u4e00-\u9fff]/);
    expect(out).toContain("Summary: 1 passed / 1 failed / 2 skipped");
    expect(out).toContain("not enabled (feishu.enabled: false)");
  });
});

describe("tasking doctor workflow path", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "tasking-doctor-wfpath-"));
    dirs.push(d);
    return d;
  }

  it("reads a custom workflow path and loads dotenv from its directory", async () => {
    const dir = tempDir();
    const cfgDir = join(dir, "configs");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "my-flow.md"),
      [
        "---",
        "tracker:",
        "  kind: none",
        "feishu:",
        "  enabled: true",
        "  app_id: cli_abc",
        "  app_secret: sec",
        "  intake_chat_id: oc_exist",
        "---",
        "",
        "# body",
      ].join("\n"),
      "utf8",
    );
    const key = "TASKING_DOCTOR_DOTENV_TEST";
    delete process.env[key];
    writeFileSync(join(cfgDir, ".env"), `${key}=from-custom-dir\n`, "utf8");
    const { stream, content } = mockOutput();
    const code = await runDoctor(
      dir,
      stream,
      { fetchImpl: feishuFetch(), opencodeVersion: ocOk },
      "configs/my-flow.md",
    );
    expect(code).toBe(0);
    expect(content()).toContain("oc_exist");
    expect(process.env[key]).toBe("from-custom-dir");
    delete process.env[key];
  });

  it("errors when the positional points at a directory", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "sub"));
    const { stream, content } = mockOutput();
    const code = await runDoctor(dir, stream, { opencodeVersion: ocOk }, "sub");
    expect(code).toBe(1);
    expect(content()).toMatch(/must be a file|not a directory/);
  });
});

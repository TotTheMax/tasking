/**
 * Real opencode v2 smoke (INTEGRATION=1).
 *
 * Spawns a private v2 `serve` with a temporary config/db and a provider
 * key read from the local opencode auth store, then drives the full
 * tasking flow through the `opencode api` CLI: create → prompt →
 * permission pending → reply → outcome, plus an interrupt.
 *
 * Skips cleanly when INTEGRATION != 1, when no v2 binary is on PATH
 * (OPENCODE_V2_BIN overrides) or when no provider key is available.
 */
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const INTEGRATION = process.env.INTEGRATION === "1";
const BIN = process.env.OPENCODE_V2_BIN ?? "opencode-v2";
const PASSWORD = "tasking-smoke-pass";
const MODEL = process.env.OPENCODE_SMOKE_MODEL ?? "siliconflow-cn/Qwen/Qwen3.5-4B";
// OPENCODE_SMOKE_SHARED=1 drives the machine's own shared service instead of
// an isolated private serve. Use it when the model depends on the user's
// configured console workspace (e.g. opencode/deepseek-v4.1-flash).
const SHARED = process.env.OPENCODE_SMOKE_SHARED === "1";

let dir = "";
let child: ReturnType<typeof spawn> | null = null;
let url = "";
let env: NodeJS.ProcessEnv = {};

const PROVIDER_ENV: Record<string, string> = {
  "zhipuai-coding-plan": "ZAI_API_KEY",
  "siliconflow-cn": "SILICONFLOW_CN_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "github-copilot": "GITHUB_TOKEN",
};

function serverArgs(extra: string[]): string[] {
  return SHARED ? ["api", ...extra] : ["api", "--server", url, ...extra];
}

function runSync(args: string[]): string {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  return execFileSync(BIN, args, { env, encoding: "utf8", timeout: 30_000 });
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      BIN,
      args,
      { env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? ((err as { code?: number }).code ?? 1) : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

function providerId(): string {
  return MODEL.includes("/") ? (MODEL.split("/")[0] ?? "") : "";
}

function modelId(): string {
  const idx = MODEL.indexOf("/");
  return idx === -1 ? MODEL : MODEL.slice(idx + 1);
}

function readProviderKey(): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(homedir(), ".local", "share", "opencode", "auth.json"), "utf8"),
    ) as Record<string, { key?: string }>;
    return raw[providerId()]?.key ?? null;
  } catch {
    return null;
  }
}

// The built-in `opencode` provider authenticates through the console token
// (opencode-go) rather than a provider key in auth.json.
function isBuiltinProvider(): boolean {
  return providerId() === "opencode";
}

function providerCatalog(): { baseURL: string } | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(homedir(), ".cache", "opencode", "models.json"), "utf8"),
    ) as Record<string, { api?: string }>;
    const entry = raw[providerId()];
    if (entry?.api) return { baseURL: entry.api };
  } catch {
    void 0;
  }
  return null;
}

async function waitForAsync(cond: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function waitFor(cond: () => boolean, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe.skipIf(!INTEGRATION)("real opencode v2 smoke", () => {
  let providerKey: string | null = null;

  beforeAll(async () => {
    const version = await run(["--version"], process.env);
    if (!/2\.\d+\.\d+/.test(version.stdout)) {
      console.warn(`smoke skipped: ${BIN} is not opencode v2 (${version.stdout.trim()})`);
      return;
    }
    providerKey = isBuiltinProvider()
      ? (process.env.OPENCODE_CONSOLE_TOKEN ?? "builtin")
      : readProviderKey();
    if (providerKey === null) {
      console.warn(`smoke skipped: no ${providerId()} key in auth.json`);
      return;
    }
    dir = mkdtempSync(join(tmpdir(), "tasking-smoke-"));
    mkdirSync(join(dir, "work", ".opencode"), { recursive: true });
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(
      join(dir, "work", ".opencode", "opencode.json"),
      JSON.stringify({ permissions: [{ action: "shell", resource: "*", effect: "ask" }] }),
    );
    const catalog = isBuiltinProvider() ? null : providerCatalog();
    if (catalog !== null) {
      writeFileSync(
        join(dir, "config", "opencode.json"),
        JSON.stringify({
          providers: {
            [providerId()]: {
              baseURL: catalog.baseURL,
              models: { [modelId()]: { name: modelId() } },
            },
          },
        }),
      );
    }
    const envVar = PROVIDER_ENV[providerId()] ?? "OPENCODE_API_KEY";
    env = {
      ...process.env,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_CONFIG_DIR: join(dir, "config"),
      OPENCODE_DB: join(dir, "smoke.db"),
      OPENCODE_SERVER_PASSWORD: PASSWORD,
      OPENCODE_PASSWORD: PASSWORD,
      ...(isBuiltinProvider() ? {} : { [envVar]: providerKey }),
    };
    if (SHARED) {
      await waitFor(() => {
        try {
          const out = runSync(["--version"]);
          return out.includes("2.");
        } catch {
          return false;
        }
      });
      return;
    }
    const port = 48231;
    url = `http://127.0.0.1:${port}`;
    const serveLogPath = join(dir, "serve.log");
    const serveLog = openSync(serveLogPath, "a");
    child = spawn(BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: join(dir, "work"),
      env,
      stdio: ["ignore", serveLog, serveLog],
      detached: true,
    });
    child.unref();
    try {
      await waitForAsync(probeReady, 60_000);
    } catch (e) {
      console.warn(
        "smoke serve failed to become ready; serve.log:\n",
        readFileSync(serveLogPath, "utf8").slice(0, 2000),
      );
      throw e;
    }
  }, 120_000);

  async function probeReady(): Promise<boolean> {
    try {
      const res = await fetch(`${url}/api/info`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  afterAll(async () => {
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    }
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("drives create → pending → reply → outcome", async () => {
    if (providerKey === null) return;
    const created = await run(
      [
        ...serverArgs(["session.create"]),
        "--data",
        JSON.stringify({
          location: { directory: join(dir, "work") },
          model: { id: modelId(), providerID: providerId() },
        }),
      ],
      env,
    );
    expect(created.code).toBe(0);
    const sessionID = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;
    expect(sessionID.startsWith("ses_")).toBe(true);

    await run(
      [
        ...serverArgs(["session.prompt"]),
        "--param",
        `sessionID=${sessionID}`,
        "--data",
        JSON.stringify({ text: "Run this shell command: echo smoke-test" }),
      ],
      env,
    );

    let pendingID: string | null = null;
    const deadline = Date.now() + 240_000;
    let nudged = false;
    while (pendingID === null) {
      if (Date.now() > deadline) {
        console.warn(
          `smoke diagnostics (messages): ${sessionMessagesRaw(sessionID).slice(0, 1200)}`,
        );
        throw new Error("waitFor timeout waiting for pending approval");
      }
      if (sessionHitProviderLimit(sessionID)) {
        console.warn("smoke skipped: provider quota/limit reached before the approval flow");
        return;
      }
      pendingID = execFileSyncInfoList(sessionID);
      if (pendingID === null) {
        if (!nudged && Date.now() > deadline - 150_000) {
          nudged = true;
          await run(
            [
              ...serverArgs(["session.prompt", "--param", `sessionID=${sessionID}`]),
              "--data",
              JSON.stringify({
                text: "You must use the shell tool now: run `echo smoke-test` with it.",
              }),
            ],
            env,
          );
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const reply = await run(
      [
        ...serverArgs(["session.permission.reply"]),
        "--param",
        `sessionID=${sessionID}`,
        "--param",
        `requestID=${pendingID ?? ""}`,
        "--data",
        JSON.stringify({ decision: "once" }),
      ],
      env,
    );
    expect(reply.code).toBe(0);

    await waitFor(() => {
      const got = runSyncGet(sessionID);
      return got === "succeeded" || got === "failed";
    }, 180_000);
    expect(runSyncGet(sessionID)).toBe("succeeded");
  }, 300_000);

  it("interrupts a running turn", async () => {
    if (providerKey === null) return;
    const created = await run(
      [
        ...serverArgs(["session.create"]),
        "--data",
        JSON.stringify({
          location: { directory: join(dir, "work") },
          model: { id: modelId(), providerID: providerId() },
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        }),
      ],
      env,
    );
    const sessionID = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;
    await run(
      [
        ...serverArgs(["session.prompt"]),
        "--param",
        `sessionID=${sessionID}`,
        "--data",
        JSON.stringify({ text: "Count from 1 to 100, one shell echo per number." }),
      ],
      env,
    );
    await new Promise((r) => setTimeout(r, 8000));
    const res = await run(
      [...serverArgs(["session.interrupt", "--param", `sessionID=${sessionID}`])],
      env,
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("interrupted");
  }, 300_000);

  function execFileSyncInfoList(sessionID: string): string | null {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    try {
      const out = execFileSync(
        BIN,
        serverArgs(["session.permission.list", "--param", `sessionID=${sessionID}`]),
        { env, encoding: "utf8", timeout: 15_000 },
      );
      const data = (JSON.parse(out) as { data?: Array<{ id: string }> }).data ?? [];
      return data[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  function sessionMessagesRaw(sessionID: string): string {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    try {
      return execFileSync(
        BIN,
        serverArgs(["session.message.list", "--param", `sessionID=${sessionID}`]),
        { env, encoding: "utf8", timeout: 15_000 },
      );
    } catch (e) {
      return `message.list failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function sessionHitProviderLimit(sessionID: string): boolean {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    try {
      const out = execFileSync(
        BIN,
        serverArgs(["session.message.list", "--param", `sessionID=${sessionID}`]),
        { env, encoding: "utf8", timeout: 15_000 },
      );
      return /provider\.(rate-limit|quota|auth)/.test(out);
    } catch {
      return false;
    }
  }

  function runSyncGet(sessionID: string): string {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    try {
      const out = execFileSync(
        BIN,
        serverArgs(["session.get", "--param", `sessionID=${sessionID}`]),
        { env, encoding: "utf8", timeout: 15_000 },
      );
      return (JSON.parse(out) as { data?: { outcome?: string } }).data?.outcome ?? "";
    } catch {
      return "";
    }
  }
});

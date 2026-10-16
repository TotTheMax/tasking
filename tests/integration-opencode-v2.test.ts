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
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const INTEGRATION = process.env.INTEGRATION === "1";
const BIN = process.env.OPENCODE_V2_BIN ?? "opencode-v2";
const PASSWORD = "tasking-smoke-pass";
const MODEL = process.env.OPENCODE_SMOKE_MODEL ?? "zhipuai-coding-plan/glm-5.3";

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

function readProviderKey(): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(homedir(), ".local", "share", "opencode", "auth.json"), "utf8"),
    ) as Record<string, { key?: string }>;
    return raw["zhipuai-coding-plan"]?.key ?? null;
  } catch {
    return null;
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
  let dir = "";
  let child: ReturnType<typeof spawn> | null = null;
  let url = "";
  let env: NodeJS.ProcessEnv = {};
  let providerKey: string | null = null;

  beforeAll(async () => {
    const version = await run(["--version"], process.env);
    if (!/2\.\d+\.\d+/.test(version.stdout)) {
      console.warn(`smoke skipped: ${BIN} is not opencode v2 (${version.stdout.trim()})`);
      return;
    }
    providerKey = readProviderKey();
    if (providerKey === null) {
      console.warn("smoke skipped: no zhipuai-coding-plan key in auth.json");
      return;
    }
    dir = mkdtempSync(join(tmpdir(), "tasking-smoke-"));
    mkdirSync(join(dir, "work", ".opencode"), { recursive: true });
    writeFileSync(
      join(dir, "work", ".opencode", "opencode.json"),
      JSON.stringify({ permissions: [{ action: "shell", resource: "*", effect: "ask" }] }),
    );
    env = {
      ...process.env,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_CONFIG_DIR: join(dir, "config"),
      OPENCODE_DB: join(dir, "smoke.db"),
      OPENCODE_SERVER_PASSWORD: PASSWORD,
      OPENCODE_PASSWORD: PASSWORD,
      ZAI_API_KEY: providerKey,
    };
    const port = 48231;
    url = `http://127.0.0.1:${port}`;
    child = spawn(BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: join(dir, "work"),
      env,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    await waitFor(() => {
      try {
        const res = execFileSyncInfo();
        return res;
      } catch {
        return false;
      }
    });
  });

  function execFileSyncInfo(): boolean {
    // cheap probe without spawning: rely on api server.info
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    try {
      const out = execFileSync(BIN, ["api", "--server", url, "server.info"], {
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
      return out.includes("version");
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
  });

  it("drives create → pending → reply → outcome", async () => {
    if (providerKey === null) return;
    const created = await run(
      [
        "api",
        "--server",
        url,
        "session.create",
        "--data",
        JSON.stringify({
          location: { directory: join(dir, "work") },
          model: { id: MODEL.split("/")[1] ?? MODEL, providerID: MODEL.split("/")[0] ?? "" },
        }),
      ],
      env,
    );
    expect(created.code).toBe(0);
    const sessionID = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;
    expect(sessionID.startsWith("ses_")).toBe(true);

    await run(
      [
        "api",
        "--server",
        url,
        "session.prompt",
        "--param",
        `sessionID=${sessionID}`,
        "--data",
        JSON.stringify({ text: "Run this shell command: echo smoke-test" }),
      ],
      env,
    );

    let pendingID: string | null = null;
    const deadline = Date.now() + 120_000;
    while (pendingID === null) {
      if (Date.now() > deadline) throw new Error("waitFor timeout waiting for pending approval");
      if (sessionHitProviderLimit(sessionID)) {
        console.warn("smoke skipped: provider quota/limit reached before the approval flow");
        return;
      }
      pendingID = execFileSyncInfoList(sessionID);
      if (pendingID === null) await new Promise((r) => setTimeout(r, 1000));
    }

    const reply = await run(
      [
        "api",
        "--server",
        url,
        "session.permission.reply",
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
        "api",
        "--server",
        url,
        "session.create",
        "--data",
        JSON.stringify({
          location: { directory: join(dir, "work") },
          model: { id: MODEL.split("/")[1] ?? MODEL, providerID: MODEL.split("/")[0] ?? "" },
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        }),
      ],
      env,
    );
    const sessionID = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;
    await run(
      [
        "api",
        "--server",
        url,
        "session.prompt",
        "--param",
        `sessionID=${sessionID}`,
        "--data",
        JSON.stringify({ text: "Count from 1 to 100, one shell echo per number." }),
      ],
      env,
    );
    await new Promise((r) => setTimeout(r, 8000));
    const res = await run(
      ["api", "--server", url, "session.interrupt", "--param", `sessionID=${sessionID}`],
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
        ["api", "--server", url, "session.permission.list", "--param", `sessionID=${sessionID}`],
        { env, encoding: "utf8", timeout: 15_000 },
      );
      const data = (JSON.parse(out) as { data?: Array<{ id: string }> }).data ?? [];
      return data[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  function sessionHitProviderLimit(sessionID: string): boolean {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    try {
      const out = execFileSync(
        BIN,
        ["api", "--server", url, "session.message.list", "--param", `sessionID=${sessionID}`],
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
        ["api", "--server", url, "session.get", "--param", `sessionID=${sessionID}`],
        { env, encoding: "utf8", timeout: 15_000 },
      );
      return (JSON.parse(out) as { data?: { outcome?: string } }).data?.outcome ?? "";
    } catch {
      return "";
    }
  }
});

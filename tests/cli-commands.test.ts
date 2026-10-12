import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDaemonInfo,
  removeDaemonInfo,
  resolveTuiTarget,
  writeDaemonInfo,
} from "../src/cli/daemon-info.js";
import { main } from "../src/cli/index.js";
import { httpToConfigView, httpToSnapshot } from "../src/cli/tui-helpers.js";

describe("cli-commands: status", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-cmd-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 when no daemon metadata", async () => {
    const code = await main(["node", "tasking", "status"]);
    expect(code).toBe(1);
  });

  it("reports PID-only when no HTTP port configured", async () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeDaemonInfo({
      pid: process.pid,
      port: null,
      host: null,
      started_at: Date.now(),
      workflow_path: null,
      log_path: null,
    });
    const code = await main(["node", "tasking", "status"]);
    expect(code).toBe(0);
  });

  it("cleans up stale metadata when process not running", async () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeDaemonInfo({
      pid: 999999,
      port: 8080,
      host: "127.0.0.1",
      started_at: Date.now(),
      workflow_path: null,
      log_path: null,
    });
    const code = await main(["node", "tasking", "status"]);
    expect(code).toBe(1);
    expect(existsSync(join(tmpDir, ".tasking", "daemon.json"))).toBe(false);
  });
});

describe("cli-commands: logs", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-logs-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 when no log file", async () => {
    const code = await main(["node", "tasking", "logs"]);
    expect(code).toBe(1);
  });

  it("reads the daemon's recorded log_path when cwd has no tasking.log", async () => {
    const remoteDir = mkdtempSync(join(tmpdir(), "tasking-cli-logpath-"));
    try {
      writeFileSync(join(remoteDir, "daemon.log"), "from daemon dir\n");
      mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
      writeDaemonInfo({
        pid: process.pid,
        port: null,
        host: null,
        started_at: Date.now(),
        workflow_path: "/work/WORKFLOW.md",
        log_path: join(remoteDir, "daemon.log"),
      });
      const code = await main(["node", "tasking", "logs"]);
      expect(code).toBe(0);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it("returns 0 and prints log lines when file exists", async () => {
    writeFileSync(join(tmpDir, "tasking.log"), "line1\nline2\nline3\n");
    const code = await main(["node", "tasking", "logs"]);
    expect(code).toBe(0);
  });

  it("respects --lines option", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    writeFileSync(join(tmpDir, "tasking.log"), lines);
    const code = await main(["node", "tasking", "logs", "--lines", "50"]);
    expect(code).toBe(0);
  });

  it("filters by --level for JSON logs", async () => {
    const logLines = [
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", level: "info", msg: "hello" }),
      JSON.stringify({ ts: "2026-01-01T00:00:01Z", level: "error", msg: "bad" }),
      JSON.stringify({ ts: "2026-01-01T00:00:02Z", level: "info", msg: "world" }),
    ].join("\n");
    writeFileSync(join(tmpDir, "tasking.log"), logLines);
    const code = await main(["node", "tasking", "logs", "--level", "error"]);
    expect(code).toBe(0);
  });
});

describe("cli-commands: stop", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-stop-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 when no daemon metadata", async () => {
    const code = await main(["node", "tasking", "stop"]);
    expect(code).toBe(1);
  });

  it("cleans up stale metadata when process not running", async () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeDaemonInfo({
      pid: 999999,
      port: null,
      host: null,
      started_at: Date.now(),
      workflow_path: null,
      log_path: null,
    });
    const code = await main(["node", "tasking", "stop"]);
    expect(code).toBe(1);
    expect(existsSync(join(tmpDir, ".tasking", "daemon.json"))).toBe(false);
  });
});

describe("cli-commands: triage hidden", () => {
  it("returns 1 with not-yet-available message", async () => {
    const code = await main(["node", "tasking", "triage"]);
    expect(code).toBe(1);
  });

  it("USAGE does not contain triage", async () => {
    const savedCwd = process.cwd();
    const tmpDir = mkdtempSync(join(tmpdir(), "tasking-usage-"));
    process.chdir(tmpDir);
    try {
      const origWrite = process.stdout.write;
      let captured = "";
      process.stdout.write = ((data: unknown) => {
        captured += String(data);
        return true;
      }) as typeof origWrite;
      await main(["node", "tasking", "--help"]);
      process.stdout.write = origWrite;
      expect(captured).not.toContain("triage");
      expect(captured).toContain("tui");
      expect(captured).toContain("stop");
    } finally {
      process.chdir(savedCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("cli-commands: daemon-info", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-daemoninfo-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeDaemonInfo then readDaemonInfo round-trip", () => {
    writeDaemonInfo({
      pid: 12345,
      port: 8080,
      host: "0.0.0.0",
      started_at: 1700000000,
      workflow_path: "/repo/WORKFLOW.md",
      log_path: "/repo/tasking.log",
    });
    const info = readDaemonInfo();
    expect(info).toEqual({
      pid: 12345,
      port: 8080,
      host: "0.0.0.0",
      started_at: 1700000000,
      workflow_path: "/repo/WORKFLOW.md",
      log_path: "/repo/tasking.log",
    });
  });

  it("readDaemonInfo falls back to daemon.pid", () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeFileSync(join(tmpDir, ".tasking", "daemon.pid"), "67890");
    const info = readDaemonInfo();
    expect(info).toEqual({
      pid: 67890,
      port: null,
      host: null,
      started_at: expect.any(Number),
      workflow_path: null,
      log_path: null,
    });
  });

  it("readDaemonInfo returns null when nothing exists", () => {
    const info = readDaemonInfo();
    expect(info).toBeNull();
  });

  it("removeDaemonInfo cleans both json and pid", () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeFileSync(join(tmpDir, ".tasking", "daemon.json"), "{}");
    writeFileSync(join(tmpDir, ".tasking", "daemon.pid"), "123");
    removeDaemonInfo();
    expect(existsSync(join(tmpDir, ".tasking", "daemon.json"))).toBe(false);
    expect(existsSync(join(tmpDir, ".tasking", "daemon.pid"))).toBe(false);
  });

  it("resolveTuiTarget prefers explicit port override", () => {
    const info = {
      pid: 1,
      port: 5000,
      host: "0.0.0.0",
      started_at: 1,
      workflow_path: null,
      log_path: null,
    };
    expect(resolveTuiTarget(9000, info)).toEqual({ host: "0.0.0.0", port: 9000 });
    expect(resolveTuiTarget(9000, null)).toEqual({ host: "127.0.0.1", port: 9000 });
  });

  it("resolveTuiTarget uses daemon.json port when no override", () => {
    const info = { pid: 1, port: 5000, host: "127.0.0.1", started_at: 1, workflow_path: null };
    expect(resolveTuiTarget(undefined, info)).toEqual({ host: "127.0.0.1", port: 5000 });
  });

  it("resolveTuiTarget falls back to 8080 when no daemon.json or null port", () => {
    expect(resolveTuiTarget(undefined, null)).toEqual({ host: "127.0.0.1", port: 8080 });
    const info = { pid: 1, port: null, host: "0.0.0.0", started_at: 1, workflow_path: null };
    expect(resolveTuiTarget(undefined, info)).toEqual({ host: "0.0.0.0", port: 8080 });
  });
});

describe("cli-commands: httpToSnapshot adapter", () => {
  it("converts ISO timestamps to epoch ms", () => {
    const json = {
      generated_at: "2026-01-01T00:00:00.000Z",
      max_concurrent_agents: 10,
      counts: { running: 1, retrying: 0 },
      running: [
        {
          task_id: "1",
          task_identifier: "ABC-1",
          state: "In Progress",
          session_id: "ses_123",
          turn_count: 2,
          last_event: "turn_completed",
          last_message: null,
          started_at: "2026-01-01T00:00:00.000Z",
          last_event_at: "2026-01-01T00:01:00.000Z",
          workspace_path: "/tmp/ws",
          tokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          elapsed_ms: 60000,
        },
      ],
      retrying: [],
      codex_totals: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        seconds_running: 60,
      },
    };
    const snap = httpToSnapshot(json);
    expect(snap.max_concurrent_agents).toBe(10);
    expect(snap.counts.running).toBe(1);
    expect(snap.running).toHaveLength(1);
    expect(snap.running[0]?.started_at).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(snap.running[0]?.last_event_at).toBe(Date.parse("2026-01-01T00:01:00.000Z"));
    expect(snap.totals.total_tokens).toBe(150);
    expect(snap.totals.seconds_running).toBe(60);
  });

  it("handles codex_totals -> totals mapping", () => {
    const json = {
      generated_at: "2026-01-01T00:00:00.000Z",
      max_concurrent_agents: 5,
      counts: { running: 0, retrying: 0 },
      running: [],
      retrying: [],
      codex_totals: { input_tokens: 10, output_tokens: 20, total_tokens: 30, seconds_running: 5 },
    };
    const snap = httpToSnapshot(json);
    expect(snap.totals.input_tokens).toBe(10);
    expect(snap.totals.output_tokens).toBe(20);
    expect(snap.totals.total_tokens).toBe(30);
  });

  it("handles retrying entries with ISO due_at", () => {
    const json = {
      generated_at: "2026-01-01T00:00:00.000Z",
      max_concurrent_agents: 5,
      counts: { running: 0, retrying: 1 },
      running: [],
      retrying: [
        {
          task_id: "2",
          task_identifier: "ABC-2",
          attempt: 3,
          due_at: "2026-01-01T00:05:00.000Z",
          error: "timeout",
        },
      ],
      codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    };
    const snap = httpToSnapshot(json);
    expect(snap.retrying).toHaveLength(1);
    expect(snap.retrying[0]?.attempt).toBe(3);
    expect(snap.retrying[0]?.due_at).toBe(Date.parse("2026-01-01T00:05:00.000Z"));
    expect(snap.retrying[0]?.error).toBe("timeout");
  });
});

describe("cli-commands: httpToConfigView adapter", () => {
  it("parses config and converts ISO started_at to epoch", () => {
    const json = {
      generated_at: "2026-01-01T00:00:00.000Z",
      config: {
        tracker: { api_key: "****", endpoint: "http://jira.example" },
        env: { GITLAB_TOKEN: "****" },
      },
      runtime: {
        pid: 42,
        started_at: "2026-01-01T00:00:00.000Z",
        workflow_path: "/repo/WORKFLOW.md",
        workspace_root: "/repo/tasking_workspaces",
        log_path: "/repo/tasking.log",
        host: "0.0.0.0",
        port: 8080,
      },
    };
    const view = httpToConfigView(json);
    expect(view.config.tracker).toEqual({
      api_key: "****",
      endpoint: "http://jira.example",
    });
    expect(view.runtime.pid).toBe(42);
    expect(view.runtime.started_at).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(view.runtime.workflow_path).toBe("/repo/WORKFLOW.md");
    expect(view.runtime.port).toBe(8080);
  });

  it("degrades missing fields to null", () => {
    const view = httpToConfigView({ config: {}, runtime: {} });
    expect(view.config).toEqual({});
    expect(view.runtime.pid).toBeNull();
    expect(view.runtime.started_at).toBeNull();
    expect(view.runtime.workflow_path).toBeNull();
    expect(view.runtime.host).toBeNull();
  });
});

describe("cli-commands: doctor", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-doctor-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 1 with an init hint when WORKFLOW.md is missing", async () => {
    const code = await main(["node", "tasking", "doctor"]);
    expect(code).toBe(1);
  });

  it("rejects arguments", async () => {
    const code = await main(["node", "tasking", "doctor", "--whatever"]);
    expect(code).toBe(1);
  });
});

describe("cli-commands: workflow path positional", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-wfpath-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init writes to a positional custom path", async () => {
    const code = await main(["node", "tasking", "init", "--non-interactive", "configs/my-flow.md"]);
    expect(code).toBe(0);
    expect(existsSync(join(tmpDir, "configs", "my-flow.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "WORKFLOW.md"))).toBe(false);
  });

  it("doctor reads a positional custom path", async () => {
    const cfgDir = join(tmpDir, "configs");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "my-flow.md"),
      "---\ntracker:\n  kind: none\n---\n\n# body\n",
      "utf8",
    );
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await main(["node", "tasking", "doctor", "configs/my-flow.md"]);
      const out = write.mock.calls.map((c) => String(c[0])).join("");
      expect(out).toContain("tracker: none");
    } finally {
      write.mockRestore();
    }
  });
});

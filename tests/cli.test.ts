import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDaemonInfo, writeDaemonInfo } from "../src/cli/daemon-info.js";
import { main } from "../src/cli/index.js";

function captureStdout(run: () => Promise<number>): Promise<{ code: number; output: string }> {
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  return run()
    .then((code) => ({
      code,
      output: spy.mock.calls.map((call) => String(call[0])).join(""),
    }))
    .finally(() => spy.mockRestore());
}

function captureStderr(run: () => Promise<number>): Promise<{ code: number; output: string }> {
  const origError = console.error;
  let captured = "";
  console.error = (data: unknown) => {
    captured += String(data);
  };
  return run()
    .then((code) => ({ code, output: captured }))
    .finally(() => {
      console.error = origError;
    });
}

describe("cli main", () => {
  it("returns nonzero with usage when no subcommand", async () => {
    const code = await main(["node", "tasking"]);
    expect(code).toBe(1);
  });

  it("returns 0 for --help", async () => {
    const code = await main(["node", "tasking", "--help"]);
    expect(code).toBe(0);
  });

  it("prints bare semver and exits 0 for --version", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "--version"]));
    expect(code).toBe(0);
    expect(output).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("prints bare semver and exits 0 for -v", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "-v"]));
    expect(code).toBe(0);
    expect(output).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("returns nonzero for unknown subcommand", async () => {
    const code = await main(["node", "tasking", "bogus"]);
    expect(code).toBe(1);
  });

  it("top-level --help prints command descriptions to stdout", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "--help"]));
    expect(code).toBe(0);
    for (const name of ["init", "start", "status", "logs", "stop", "tui", "doctor"]) {
      expect(output).toContain(name);
    }
    expect(output).toContain("--help");
    expect(output).toContain("Run 'tasking <command> --help'");
    expect(output).not.toContain("triage");
  });

  it("top-level --help lists --version in Options", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "--help"]));
    expect(code).toBe(0);
    expect(output).toMatch(/-v, --version\s+Print the installed version/);
  });

  it("top-level -h prints help to stdout", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "-h"]));
    expect(code).toBe(0);
    expect(output).toContain("Usage:");
  });

  it("no subcommand prints usage to stderr and exits 1", async () => {
    const { code, output } = await captureStderr(() => main(["node", "tasking"]));
    expect(code).toBe(1);
    expect(output).toContain("Usage:");
    expect(output).not.toContain("triage");
  });

  it("unknown subcommand prints error to stderr and exits 1", async () => {
    const { code, output } = await captureStderr(() => main(["node", "tasking", "bogus"]));
    expect(code).toBe(1);
    expect(output).toContain("unknown subcommand");
  });

  it("tasking help prints top-level help to stdout", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "help"]));
    expect(code).toBe(0);
    expect(output).toContain("Commands:");
    expect(output).toContain("tui");
  });

  it("tasking help <command> prints that command's help to stdout", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "help", "logs"]));
    expect(code).toBe(0);
    expect(output).toContain("tasking logs - Print recent daemon logs");
    expect(output).toContain("--lines");
    expect(output).toContain("--follow");
  });

  it("tasking help <unknown> prints error to stderr and exits 1", async () => {
    const { code, output } = await captureStderr(() => main(["node", "tasking", "help", "bogus"]));
    expect(code).toBe(1);
    expect(output).toContain("unknown subcommand");
  });

  it("start returns nonzero when workflow file missing", async () => {
    const cwd = process.cwd();
    const code = await main(["node", "tasking", "start", "/does/not/exist.md"]);
    expect(code).toBe(1);
    process.chdir(cwd);
  });

  it("init rejects combining --update with --force", async () => {
    const code = await main(["node", "tasking", "init", "--update", "--force"]);
    expect(code).toBe(1);
  });

  it("init rejects combining --update with --restore", async () => {
    const code = await main(["node", "tasking", "init", "--update", "--restore"]);
    expect(code).toBe(1);
  });
});

describe("cli subcommand help", () => {
  it("init --help covers init options and not triage", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "init", "--help"]));
    expect(code).toBe(0);
    for (const opt of ["--force", "--non-interactive", "--workflow", "--update", "--restore"]) {
      expect(output).toContain(opt);
    }
    expect(output).not.toContain("triage");
  });
  it("init --help describes --update as syncing skills AND reporting workflow drift", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "init", "--help"]));
    expect(code).toBe(0);
    const updateLine = output.split("\n").find((line) => line.trim().startsWith("--update")) ?? "";
    expect(updateLine).toContain("Re-sync tasking skills");
    expect(updateLine).toContain("<file>.bak");
    expect(updateLine).toContain("WORKFLOW.md drift");
    expect(updateLine).toContain("fresh init today");
  });

  it("init --help documents that --workflow/--lang also feed --update drift reporting", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "init", "--help"]));
    expect(code).toBe(0);
    const optionLine = (flag: string) =>
      output.split("\n").find((line) => line.trim().startsWith(flag)) ?? "";
    expect(optionLine("--workflow <name>")).toContain("--update");
    expect(optionLine("--lang <zh|en>")).toContain("--update");
  });

  it("init --help lists all four variants with feishu-direct as the default", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "init", "--help"]));
    expect(code).toBe(0);
    const optionLine = (flag: string) =>
      output.split("\n").find((line) => line.trim().startsWith(flag)) ?? "";
    expect(optionLine("--workflow <name>")).toContain(
      "minimal | code-mr | grill-openspec | feishu-direct",
    );
    expect(optionLine("--workflow <name>")).toContain("default: feishu-direct");
    expect(output).toContain("minimal (workspace task");
    expect(output).not.toMatch(/Workflow variants:[^\n]*default \(/);
  });

  it("start -h covers start options", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "start", "-h"]));
    expect(code).toBe(0);
    for (const opt of ["workflow-path", "-p", "--port", "--tui", "--detach", "--fresh"]) {
      expect(output).toContain(opt);
    }
  });

  it("init --help documents the workflow-path positional", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "init", "--help"]));
    expect(code).toBe(0);
    expect(output).toContain("tasking init [workflow-path]");
    expect(output).toContain("workflow-path");
  });

  it("doctor --help documents the workflow-path positional", async () => {
    const { code, output } = await captureStdout(() =>
      main(["node", "tasking", "doctor", "--help"]),
    );
    expect(code).toBe(0);
    expect(output).toContain("tasking doctor [workflow-path]");
    expect(output).toContain("workflow-path");
  });

  it("status --help covers --json", async () => {
    const { code, output } = await captureStdout(() =>
      main(["node", "tasking", "status", "--help"]),
    );
    expect(code).toBe(0);
    expect(output).toContain("--json");
  });

  it("logs --help covers logs options", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "logs", "--help"]));
    expect(code).toBe(0);
    for (const opt of ["-n", "--lines", "-f", "--follow", "--level"]) {
      expect(output).toContain(opt);
    }
  });

  it("stop --help prints stop help", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "stop", "--help"]));
    expect(code).toBe(0);
    expect(output).toContain("tasking stop - Stop the running daemon");
  });

  it("tui --help covers tui options", async () => {
    const { code, output } = await captureStdout(() => main(["node", "tasking", "tui", "--help"]));
    expect(code).toBe(0);
    expect(output).toContain("-p");
    expect(output).toContain("--port");
  });
});

describe("cli process exit codes", () => {
  const cli = join(process.cwd(), "src", "cli", "index.ts");

  function runCli(args: string[]): { code: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
      encoding: "utf8",
      timeout: 15000,
    });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("propagates help exit code 0", () => {
    const { code, stdout } = runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Commands:");
  });

  it("propagates unknown-subcommand exit code 1", () => {
    const { code } = runCli(["bogus"]);
    expect(code).toBe(1);
  });

  it("propagates no-subcommand exit code 1", () => {
    const { code } = runCli([]);
    expect(code).toBe(1);
  });

  it("propagates status-no-daemon exit code 1", () => {
    const savedCwd = process.cwd();
    const tmpDir = mkdtempSync(join(tmpdir(), "tasking-exit-"));
    process.chdir(tmpDir);
    try {
      const { code } = runCli(["status"]);
      expect(code).toBe(1);
    } finally {
      process.chdir(savedCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("cli status", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-status-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 when daemon is not running (no pid file)", async () => {
    const code = await main(["node", "tasking", "status"]);
    expect(code).toBe(1);
  });

  it("returns 0 and prints pid when pid file exists", async () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeFileSync(join(tmpDir, ".tasking", "daemon.pid"), String(process.pid));
    const code = await main(["node", "tasking", "status"]);
    expect(code).toBe(0);
  });
});

describe("cli triage", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-triage-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 (not yet available)", async () => {
    const code = await main(["node", "tasking", "triage"]);
    expect(code).toBe(1);
  });
});

describe("cli logs", () => {
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

  it("returns 1 when no log file exists", async () => {
    const code = await main(["node", "tasking", "logs"]);
    expect(code).toBe(1);
  });

  it("returns 0 when log file exists", async () => {
    writeFileSync(join(tmpDir, "tasking.log"), "log content");
    const code = await main(["node", "tasking", "logs"]);
    expect(code).toBe(0);
  });
});

describe("cli pid file lifecycle", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-pid-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pid file does not exist before start writes it", () => {
    expect(existsSync(join(tmpDir, ".tasking", "daemon.json"))).toBe(false);
    expect(existsSync(join(tmpDir, ".tasking", "daemon.pid"))).toBe(false);
  });

  it("status sees daemon after pid file is created", async () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeFileSync(join(tmpDir, ".tasking", "daemon.pid"), String(process.pid));
    const code = await main(["node", "tasking", "status"]);
    expect(code).toBe(0);
  });

  it("status sees daemon gone after pid file is removed", async () => {
    const pidFile = join(tmpDir, ".tasking", "daemon.pid");
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeFileSync(pidFile, String(process.pid));
    expect(await main(["node", "tasking", "status"])).toBe(0);
    rmSync(pidFile, { force: true });
    expect(await main(["node", "tasking", "status"])).toBe(1);
  });
});

describe("cli tui port override", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-cli-tui-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 when no daemon and no port override", async () => {
    const code = await main(["node", "tasking", "tui"]);
    expect(code).toBe(1);
  });

  it("returns 1 for an invalid --port value", async () => {
    const code = await main(["node", "tasking", "tui", "--port", "abc"]);
    expect(code).toBe(1);
  });

  it("exits 1 when dashboard unreachable with --port override", async () => {
    const code = await main(["node", "tasking", "tui", "--port", "1"]);
    expect(code).toBe(1);
  });
});

describe("cli daemon info workflow_path", () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), "tasking-daemon-info-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeDaemonInfo persists workflow_path", () => {
    writeDaemonInfo({
      pid: 42,
      port: 8080,
      host: "127.0.0.1",
      started_at: 1700000000000,
      workflow_path: "/repo/WORKFLOW.md",
      log_path: "/repo/tasking.log",
    });
    const info = readDaemonInfo();
    expect(info?.workflow_path).toBe("/repo/WORKFLOW.md");
    expect(info?.pid).toBe(42);
    expect(info?.port).toBe(8080);
  });

  it("degrades workflow_path to null for old daemon.json", () => {
    mkdirSync(join(tmpDir, ".tasking"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".tasking", "daemon.json"),
      JSON.stringify({ pid: 42, port: null, host: "127.0.0.1", started_at: 1700000000000 }),
    );
    const info = readDaemonInfo();
    expect(info?.workflow_path).toBeNull();
    expect(info?.pid).toBe(42);
  });

  it("writeDaemonInfo with null port survives roundtrip", () => {
    writeDaemonInfo({
      pid: 42,
      port: null,
      host: null,
      started_at: 1700000000000,
      workflow_path: null,
      log_path: null,
    });
    const info = readDaemonInfo();
    expect(info?.port).toBeNull();
    expect(info?.host).toBeNull();
    expect(info?.workflow_path).toBeNull();
  });
});

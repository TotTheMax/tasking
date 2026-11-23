import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Daemon } from "../src/cli/daemon.js";
import { ConfigManager } from "../src/config/manager.js";
import { ConsoleLogger } from "../src/observability/logger.js";

const logger = new ConsoleLogger({}, () => {});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tasking-daemon-"));
}

describe("Daemon ConfigManager unification (B1)", () => {
  it("config reload propagates to the same ConfigManager the daemon uses", () => {
    const dir = tempDir();
    try {
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(wfPath, "---\npolling:\n  interval_ms: 1000\n---\nbody");
      const mgr = ConfigManager.fromFile(wfPath);
      const daemon = new Daemon({ configManager: mgr, logger });

      expect(daemon.config.current.polling.interval_ms).toBe(1000);

      writeFileSync(wfPath, "---\npolling:\n  interval_ms: 2000\n---\nbody");
      daemon.config.reload();

      expect(daemon.config.current.polling.interval_ms).toBe(2000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("daemon and scheduler share the same ConfigManager instance", () => {
    const dir = tempDir();
    try {
      const wfPath = join(dir, "WORKFLOW.md");
      writeFileSync(wfPath, "---\npolling:\n  interval_ms: 5000\n---\nbody");
      const mgr = ConfigManager.fromFile(wfPath);
      const daemon = new Daemon({ configManager: mgr, logger });

      writeFileSync(wfPath, "---\npolling:\n  interval_ms: 9999\n---\nbody");
      daemon.config.reload();

      expect(mgr.current.polling.interval_ms).toBe(9999);
      expect(daemon.config.current.polling.interval_ms).toBe(9999);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ConfigManager hot reload watcher", () => {
  it("keeps reloading after an editor replaces WORKFLOW.md atomically", async () => {
    const dir = tempDir();
    const wfPath = join(dir, "WORKFLOW.md");
    const content = (n: number) => `---\npolling:\n  interval_ms: ${n}\n---\nbody`;
    writeFileSync(wfPath, content(1000));
    const mgr = ConfigManager.fromFile(wfPath);
    let reloads = 0;
    mgr.onReload(() => {
      reloads += 1;
    });
    try {
      mgr.startWatch();

      writeFileSync(wfPath, content(20000));
      await vi.waitFor(() => expect(reloads).toBeGreaterThanOrEqual(1), { timeout: 5000 });

      const tmp = `${wfPath}.tmp`;
      writeFileSync(tmp, content(300000));
      renameSync(tmp, wfPath);
      await vi.waitFor(() => expect(reloads).toBeGreaterThanOrEqual(2), { timeout: 5000 });

      writeFileSync(wfPath, content(4000000));
      await vi.waitFor(() => expect(reloads).toBeGreaterThanOrEqual(3), { timeout: 5000 });
      expect(mgr.current.polling.interval_ms).toBe(4000000);

      mgr.stopWatch();
      const beforeStop = reloads;
      writeFileSync(wfPath, content(50000000));
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(reloads).toBe(beforeStop);
      expect(mgr.current.polling.interval_ms).toBe(4000000);
    } finally {
      mgr.stopWatch();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("reloads direct verbosity both ways after atomic saves", async () => {
    const dir = tempDir();
    const wfPath = join(dir, "WORKFLOW.md");
    const content = (verbosity: "summary" | "detailed") =>
      `---\nfeishu:\n  enabled: true\n  app_id: c\n  app_secret: s\n  intake_chat_id: oc\n  direct:\n    verbosity: ${verbosity}\n---\nbody`;
    const atomicWrite = (text: string): void => {
      const tmp = `${wfPath}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, wfPath);
    };
    writeFileSync(wfPath, content("detailed"));
    const mgr = ConfigManager.fromFile(wfPath);
    expect(mgr.current.feishu.direct.verbosity).toBe("detailed");
    try {
      mgr.startWatch();

      atomicWrite(content("summary"));
      await vi.waitFor(() => expect(mgr.current.feishu.direct.verbosity).toBe("summary"), {
        timeout: 5000,
      });

      atomicWrite(content("detailed"));
      await vi.waitFor(() => expect(mgr.current.feishu.direct.verbosity).toBe("detailed"), {
        timeout: 5000,
      });
    } finally {
      mgr.stopWatch();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("task-source change requires restart (tracker.kind hot-flip guard)", () => {
  function tmpWorkflow(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "tasking-kindflip-"));
    const p = join(dir, "WORKFLOW.md");
    writeFileSync(p, content);
    return p;
  }

  it("warns on reload when tracker.kind differs from the startup value", () => {
    const p = tmpWorkflow(
      "---\ntracker:\n  kind: none\nfeishu:\n  enabled: true\n  app_id: c\n  app_secret: s\n  intake_chat_id: oc\n---\nbody",
    );
    try {
      const mgr = ConfigManager.fromFile(p);
      expect(mgr.current.tracker.kind).toBe("none");
      writeFileSync(
        p,
        "---\ntracker:\n  kind: jira\n  api_key: t\n  api_user: u\n  project_key: E\nfeishu:\n  enabled: true\n  app_id: c\n  app_secret: s\n  intake_chat_id: oc\n---\nbody",
      );
      const r = mgr.reload();
      expect(r.error).toBeNull();
      expect(r.warnings.some((w) => w.includes("重启"))).toBe(true);
    } finally {
      rmSync(dirname(p), { recursive: true });
    }
  });

  it("no warning when the kind stays the same", () => {
    const p = tmpWorkflow(
      "---\ntracker:\n  kind: none\nfeishu:\n  enabled: true\n  app_id: c\n  app_secret: s\n  intake_chat_id: oc\n---\nbody",
    );
    try {
      const mgr = ConfigManager.fromFile(p);
      writeFileSync(
        p,
        "---\ntracker:\n  kind: none\nfeishu:\n  enabled: true\n  app_id: c2\n  app_secret: s\n  intake_chat_id: oc\n---\nbody",
      );
      const r = mgr.reload();
      expect(r.error).toBeNull();
      expect(r.warnings.some((w) => w.includes("重启"))).toBe(false);
    } finally {
      rmSync(dirname(p), { recursive: true });
    }
  });
});

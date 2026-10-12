import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireInstanceLock, releaseInstanceLock } from "../src/cli/instance-lock.js";

const APP = "cli_lock_test";
const CHAT = "oc_lock_chat";

describe("instance lock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tasking-lock-"));
  });

  afterEach(() => {
    releaseInstanceLock(APP, CHAT);
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires when free, rejects a second live holder, releases cleanly", () => {
    const first = acquireInstanceLock(APP, CHAT, join(dir, "WORKFLOW.md"));
    expect(first.ok).toBe(true);
    const second = acquireInstanceLock(APP, CHAT, join(dir, "OTHER.md"));
    expect(second.ok).toBe(false);
    expect(second.heldBy?.pid).toBe(process.pid);
    expect(second.heldBy?.workflow_path).toBe(join(dir, "WORKFLOW.md"));
    releaseInstanceLock(APP, CHAT);
    const third = acquireInstanceLock(APP, CHAT, join(dir, "WORKFLOW.md"));
    expect(third.ok).toBe(true);
  });

  it("takes over a stale lock whose holder pid is dead", () => {
    const deadPid = 2 ** 22; // pid max range; overwhelmingly not alive
    const lockFile = acquireInstanceLock(APP, CHAT, join(dir, "W.md"));
    expect(lockFile.ok).toBe(true);
    writeFileSync(
      lockFile.path,
      JSON.stringify({ pid: deadPid, started_at: 0, workflow_path: "ghost" }),
    );
    const takeover = acquireInstanceLock(APP, CHAT, join(dir, "W.md"));
    expect(takeover.ok).toBe(true);
  });
});

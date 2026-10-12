import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface InstanceLockInfo {
  pid: number;
  started_at: number;
  workflow_path: string;
}

function lockPath(appId: string, intakeChatId: string): string {
  const hash = createHash("sha256").update(`${appId}|${intakeChatId}`).digest("hex").slice(0, 16);
  return join(homedir(), ".tasking", "instances", `${hash}.json`);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export interface AcquireResult {
  ok: boolean;
  heldBy?: InstanceLockInfo;
  path: string;
}

export function acquireInstanceLock(
  appId: string,
  intakeChatId: string,
  workflowPath: string,
): AcquireResult {
  const path = lockPath(appId, intakeChatId);
  mkdirSync(join(homedir(), ".tasking", "instances"), { recursive: true });
  if (existsSync(path)) {
    try {
      const held = JSON.parse(readFileSync(path, "utf8")) as InstanceLockInfo;
      if (typeof held.pid === "number" && pidAlive(held.pid)) {
        return { ok: false, heldBy: held, path };
      }
    } catch {
      // unreadable lock falls through to overwrite
    }
  }
  const info: InstanceLockInfo = {
    pid: process.pid,
    started_at: Date.now(),
    workflow_path: workflowPath,
  };
  writeFileSync(path, JSON.stringify(info));
  return { ok: true, path };
}

export function releaseInstanceLock(appId: string, intakeChatId: string): void {
  const path = lockPath(appId, intakeChatId);
  try {
    const held = JSON.parse(readFileSync(path, "utf8")) as InstanceLockInfo;
    if (held.pid !== process.pid) return;
    rmSync(path, { force: true });
  } catch {
    // nothing to release
  }
}

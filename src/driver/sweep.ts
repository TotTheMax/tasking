import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../observability/logger.js";
import { execApi, type ApiExecFn } from "./api-client.js";
import { interruptSession, type SessionOpBase } from "./session-ops.js";

const SIDECAR_FILENAME = ".tasking-session.json";

export function collectWorkspaceSessionIds(workspaceRoot: string): string[] {
  if (!existsSync(workspaceRoot)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sidecar = join(workspaceRoot, entry.name, SIDECAR_FILENAME);
    if (!existsSync(sidecar)) continue;
    try {
      const data = JSON.parse(readFileSync(sidecar, "utf8")) as { session_id?: string };
      if (typeof data.session_id === "string" && data.session_id !== "") {
        ids.push(data.session_id);
      }
    } catch {
      // unreadable sidecar: skip
    }
  }
  return ids;
}

function extractActiveIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) =>
        typeof item === "string" ? item : ((item as { id?: unknown })?.id as string | undefined),
      )
      .filter((id): id is string => typeof id === "string" && id !== "");
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["sessionIDs", "ids", "sessions"]) {
      const value = record[key];
      if (Array.isArray(value)) return extractActiveIds(value);
    }
  }
  return [];
}

export interface SweepResult {
  interrupted: string[];
  failed: string[];
  untouched: string[];
}

export async function sweepActiveSessions(opts: {
  exec: ApiExecFn;
  base: SessionOpBase;
  sessionIds: string[];
  logger: Logger;
}): Promise<SweepResult> {
  const result: SweepResult = { interrupted: [], failed: [], untouched: [] };
  if (opts.sessionIds.length === 0) return result;
  let activeIds: Set<string>;
  try {
    const res = await execApi(
      {
        command: opts.base.command,
        serverUrl: opts.base.serverUrl,
        operation: "session.active",
      },
      opts.exec,
    );
    activeIds = new Set(extractActiveIds(res?.data));
  } catch (e) {
    opts.logger.warn("restart sweep: session.active unavailable, skipping sweep", {
      error: e instanceof Error ? e.message : String(e),
    });
    return result;
  }
  for (const sessionId of opts.sessionIds) {
    if (!activeIds.has(sessionId)) {
      result.untouched.push(sessionId);
      continue;
    }
    try {
      await interruptSession(opts.exec, opts.base, sessionId);
      result.interrupted.push(sessionId);
      opts.logger.info("restart sweep: interrupted orphan session", { session_id: sessionId });
    } catch (e) {
      result.failed.push(sessionId);
      opts.logger.warn("restart sweep: interrupt failed", {
        session_id: sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}

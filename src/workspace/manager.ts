import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import type { HooksConfig, WorkspaceConfig } from "../config/config-types.js";
import type { Logger } from "../observability/logger.js";
import { TaskingError } from "../shared/errors.js";
import type { Workspace } from "../shared/types.js";

const ALLOWED_KEY_CHARS = /^[A-Za-z0-9._-]+$/;

export function sanitizeWorkspaceKey(identifier: string): string {
  const sanitized = identifier.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!ALLOWED_KEY_CHARS.test(sanitized) || sanitized === "") {
    throw new TaskingError(
      "workspace_key_unsafe",
      `sanitized workspace key is empty or invalid: ${sanitized}`,
      { identifier },
    );
  }
  return sanitized;
}

export function resolveWorkspacePath(identifier: string, workspaceRoot: string): string {
  return resolvePath(workspaceRoot, sanitizeWorkspaceKey(identifier));
}

export function isWithinRoot(workspacePath: string, workspaceRoot: string): boolean {
  const absRoot = resolvePath(workspaceRoot);
  const absPath = resolvePath(workspacePath);
  const rel = relative(absRoot, absPath);
  if (rel === "") return false;
  if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  try {
    const realRoot = realpathSync(absRoot);
    const realPath = realpathSync(absPath);
    const realRel = relative(realRoot, realPath);
    if (realRel === "") return false;
    return !realRel.startsWith(`..${sep}`) && !isAbsolute(realRel);
  } catch {
    return !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }
}

export interface HookResult {
  success: boolean;
  error: string | null;
  timeout?: boolean;
}

export function runHook(
  script: string | null,
  cwd: string,
  hooksConfig: HooksConfig,
  logger: Logger,
  hookName: string,
): Promise<HookResult> {
  if (!script || script.trim() === "") return Promise.resolve({ success: true, error: null });
  return new Promise((resolve) => {
    execFile(
      "bash",
      ["-lc", script],
      {
        cwd,
        timeout: hooksConfig.timeout_ms,
      },
      (e) => {
        if (e) {
          const isTimeout = e.killed === true && e.signal === "SIGTERM";
          logger.warn("hook failed", {
            hook: hookName,
            cwd,
            error: e.message,
            timeout: isTimeout,
          });
          resolve({ success: false, error: e.message, timeout: isTimeout });
          return;
        }
        logger.debug("hook completed", { hook: hookName, cwd });
        resolve({ success: true, error: null });
      },
    );
  });
}

export interface CreateWorkspaceOptions {
  identifier: string;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  logger: Logger;
}

export async function createWorkspace(opts: CreateWorkspaceOptions): Promise<Workspace> {
  const { identifier, workspace, hooks, logger } = opts;
  const workspace_key = sanitizeWorkspaceKey(identifier);
  const workspacePath = resolveWorkspacePath(identifier, workspace.root);

  if (!isWithinRoot(workspacePath, workspace.root)) {
    throw new TaskingError(
      "workspace_outside_root",
      `workspace path escapes or equals root: ${workspacePath}`,
      { workspacePath, root: workspace.root },
    );
  }

  let created_now = false;
  if (existsSync(workspacePath)) {
    const stat = statSync(workspacePath);
    if (!stat.isDirectory()) {
      throw new TaskingError(
        "workspace_creation_failed",
        `workspace path exists but is not a directory: ${workspacePath}`,
        { workspacePath },
      );
    }
  } else {
    mkdirSync(workspacePath, { recursive: true });
    created_now = true;
  }

  if (created_now) {
    const result = await runHook(hooks.after_create, workspacePath, hooks, logger, "after_create");
    if (!result.success) {
      rmSync(workspacePath, { recursive: true, force: true });
      throw new TaskingError("hook_failed", `after_create hook failed: ${result.error}`, {
        workspacePath,
      });
    }
  }

  return { path: workspacePath, workspace_key, created_now };
}

export function deleteSession(sessionId: string, logger: Logger): Promise<void> {
  return new Promise((resolve) => {
    execFile("opencode", ["session", "delete", sessionId], { timeout: 15000 }, (e) => {
      if (e) {
        logger.warn("session delete failed", { session_id: sessionId, error: e.message });
      } else {
        logger.debug("session deleted", { session_id: sessionId });
      }
      resolve();
    });
  });
}

const SIDECAR_FILENAME = ".tasking-session.json";

export interface SessionSidecar {
  sessionId: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SidecarTokens {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export function writeSessionSidecar(
  workspacePath: string,
  sessionId: string,
  turnCount = 0,
  tokens?: SidecarTokens,
): void {
  const sidecarPath = join(workspacePath, SIDECAR_FILENAME);
  const data = JSON.stringify({
    session_id: sessionId,
    turn_count: turnCount,
    ...(tokens
      ? {
          input_tokens: tokens.input_tokens,
          output_tokens: tokens.output_tokens,
          total_tokens: tokens.total_tokens,
        }
      : {}),
    updated_at: Date.now(),
  });
  writeFileSync(sidecarPath, data, "utf8");
}

export function readSessionSidecar(workspacePath: string): SessionSidecar | null {
  const sidecarPath = join(workspacePath, SIDECAR_FILENAME);
  if (!existsSync(sidecarPath)) return null;
  try {
    const data = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;
    if (typeof data.session_id !== "string") return null;
    const turnCount = typeof data.turn_count === "number" ? data.turn_count : 0;
    const num = (v: unknown): number => (typeof v === "number" ? v : 0);
    return {
      sessionId: data.session_id,
      turnCount,
      inputTokens: num(data.input_tokens),
      outputTokens: num(data.output_tokens),
      totalTokens: num(data.total_tokens),
    };
  } catch {
    return null;
  }
}

export async function removeWorkspace(
  workspacePath: string,
  hooks: HooksConfig,
  logger: Logger,
  sessionId?: string | null,
): Promise<void> {
  if (!existsSync(workspacePath)) return;
  await runHook(hooks.before_remove, workspacePath, hooks, logger, "before_remove");
  const sid = sessionId ?? readSessionSidecar(workspacePath)?.sessionId ?? null;
  if (sid) {
    await deleteSession(sid, logger);
  }
  rmSync(workspacePath, { recursive: true, force: true });
  logger.info("workspace removed", { workspacePath });
}

export function assertCwdIsWorkspace(cwd: string, workspacePath: string): void {
  if (resolvePath(cwd) !== resolvePath(workspacePath)) {
    throw new TaskingError(
      "invalid_workspace_cwd",
      `worker cwd ${cwd} does not match workspace ${workspacePath}`,
      { cwd, workspacePath },
    );
  }
}

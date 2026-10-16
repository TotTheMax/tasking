import { type ChildProcess, spawn } from "node:child_process";
import type {
  AgentConfig,
  HooksConfig,
  OpencodeConfig,
  TrackerConfig,
} from "../config/config-types.js";
import type { WorkspaceConfig } from "../config/config-types.js";
import { type ApiExecFn, defaultApiExec } from "../driver/api-client.js";
import { switchSessionAgent } from "../driver/session-ops.js";
import { type TurnDriverEvent, runTurn } from "../driver/turn-driver.js";
import { injectMcpConfig } from "../mcp/inject.js";
import type { ActivityEvent } from "../observability/activity-store.js";
import type { Logger } from "../observability/logger.js";
import { resolveAgent } from "../shared/agent-resolver.js";
import { TaskingError, toTaskingError } from "../shared/errors.js";
import type { AttemptStatus, Task, Workspace } from "../shared/types.js";
import {
  assertCwdIsWorkspace,
  createWorkspace,
  runHook,
  writeSessionSidecar,
} from "../workspace/manager.js";
import { buildContinuationGuidance, renderPrompt } from "./prompt.js";

export interface WorkerEvents {
  onEvent?: (event: WorkerEvent) => void;
}

export interface WorkerEvent {
  event: string;
  timestamp: number;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  message?: string;
  session_id?: string;
  agent?: string;
  model?: string | null;
  variant?: string | null;
}

export interface AttemptResult {
  status: AttemptStatus;
  error: string | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  session_id: string | null;
  started_at: number;
  ended_at: number;
}

export interface RunAttemptOptions {
  task: Task;
  attempt: number | null;
  config: {
    opencode: OpencodeConfig;
    hooks: HooksConfig;
    agent: AgentConfig;
    workspace: WorkspaceConfig;
    tracker: TrackerConfig;
    env: Record<string, string>;
  };
  promptTemplate: string;
  logger: Logger;
  trackerStateChecker?: (task: Task) => Promise<Task | null>;
  events?: WorkerEvents;
  onActivity?: (evt: ActivityEvent) => void;
  apiExec?: ApiExecFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  interruptGraceMs?: number;
  onPendingPermissions?: (
    pending: import("../driver/session-ops.js").PendingPermission[],
  ) => void | Promise<void>;
  onPermissionReply?: (
    requestID: string,
    decision: import("../driver/session-ops.js").PermissionDecision,
  ) => void;
  sessionId?: string | null;
  startTurn?: number;
  baseTokens?: { input_tokens: number; output_tokens: number; total_tokens: number };
  signal?: AbortSignal;
}

export interface SubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timedOutReason?: "wall_clock" | "inactivity";
  sessionAndUsage?: SessionAndUsage;
}

const DEFAULT_KILL_GRACE_MS = 10000;
const STDOUT_TAIL_CHARS = 65536;

export function buildOpencodeCommand(
  opencode: OpencodeConfig,
  workspacePath: string,
  prompt: string,
  sessionId?: string | null,
): string[] {
  const parts = opencode.command.split(/\s+/).filter(Boolean);
  parts.push("--format", "json");
  if (opencode.auto_approve) {
    parts.push("--auto");
  }
  if (sessionId) {
    parts.push("-s", sessionId);
  }
  parts.push("--dir", workspacePath);
  parts.push("--agent", opencode.agent);
  if (opencode.model) {
    parts.push("--model", opencode.model);
  }
  if (opencode.variant) {
    parts.push("--variant", opencode.variant);
  }
  parts.push(prompt);
  return parts;
}

export async function runDefaultSubprocess(
  cmd: string[],
  cwd: string,
  timeout: number,
  inactivityTimeout = 0,
  signal?: AbortSignal,
  extraEnv?: Record<string, string>,
  onOpencodeEvent?: (evt: OpencodeEvent) => void,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
): Promise<SubprocessResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0] ?? "opencode", cmd.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
      detached: true,
    });
    let stdoutTail = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let timedOut = false;
    let timedOutReason: "wall_clock" | "inactivity" | undefined;
    let sessionId: string | null = null;
    const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

    const killTree = (): void => {
      if (child.pid === undefined || process.platform === "win32") {
        child.kill("SIGKILL");
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    };

    const handleEvent = (evt: OpencodeEvent): void => {
      if (sessionId === null && evt.sessionId) sessionId = evt.sessionId;
      if (evt.type === "step_finish" && evt.tokens) {
        usage.input_tokens += evt.tokens.input;
        usage.output_tokens += evt.tokens.output;
        usage.total_tokens += evt.tokens.total;
      }
      onOpencodeEvent?.(evt);
    };

    const drainLineBuffer = () => {
      for (;;) {
        const nl = stdoutLineBuffer.indexOf("\n");
        if (nl === -1) break;
        const line = stdoutLineBuffer.slice(0, nl);
        stdoutLineBuffer = stdoutLineBuffer.slice(nl + 1);
        if (line.trim()) {
          const evt = parseOpencodeLine(line);
          if (evt) handleEvent(evt);
        }
      }
    };
    const handleStdout = (d: Buffer) => {
      const s = d.toString();
      stdoutTail = stdoutTail + s;
      if (stdoutTail.length > STDOUT_TAIL_CHARS) {
        stdoutTail = stdoutTail.slice(stdoutTail.length - STDOUT_TAIL_CHARS);
      }
      stdoutLineBuffer += s;
      drainLineBuffer();
    };

    let graceTimer: NodeJS.Timeout | null = null;
    const terminateWithGrace = (reason: "wall_clock" | "inactivity"): void => {
      timedOut = true;
      timedOutReason = reason;
      if (graceTimer) return;
      child.kill("SIGTERM");
      if (killGraceMs <= 0) {
        killTree();
        return;
      }
      graceTimer = setTimeout(() => killTree(), killGraceMs);
    };

    const wallClockTimer = setTimeout(() => terminateWithGrace("wall_clock"), timeout);

    let inactivityTimer: NodeJS.Timeout | null = null;
    if (inactivityTimeout > 0) {
      const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => terminateWithGrace("inactivity"), inactivityTimeout);
      };
      resetInactivityTimer();

      child.stdout?.on("data", (d: Buffer) => {
        handleStdout(d);
        resetInactivityTimer();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
        resetInactivityTimer();
      });
    } else {
      child.stdout?.on("data", handleStdout);
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
    }

    const onAbort = () => {
      killTree();
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("close", (code) => {
      clearTimeout(wallClockTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (stdoutLineBuffer.trim()) {
        const evt = parseOpencodeLine(stdoutLineBuffer);
        if (evt) handleEvent(evt);
      }
      resolve({
        exitCode: code ?? -1,
        stdout: stdoutTail,
        stderr,
        timedOut,
        timedOutReason,
        sessionAndUsage: { session_id: sessionId, usage },
      });
    });
    child.on("error", () => {
      clearTimeout(wallClockTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({ exitCode: -1, stdout: stdoutTail, stderr, timedOut: false });
    });
  });
}

export interface SessionAndUsage {
  session_id: string | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}

export interface OpencodeEvent {
  type: string;
  text?: string;
  tool?: string;
  tokens?: { input: number; output: number; total: number };
  sessionId?: string;
  title?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  exit?: number;
  status?: string;
  durationMs?: number;
  truncated?: boolean;
}

export function parseOpencodeLine(line: string): OpencodeEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = parsed.type;
  if (typeof type !== "string") return null;
  const evt: OpencodeEvent = { type };
  if (typeof parsed.sessionID === "string") {
    evt.sessionId = parsed.sessionID;
  }
  const part = parsed.part as Record<string, unknown> | undefined;
  if (part) {
    if (typeof part.text === "string") evt.text = part.text;
    if (typeof part.tool === "string") evt.tool = part.tool;
    const tokens = part.tokens as Record<string, unknown> | undefined;
    if (tokens) {
      const input = typeof tokens.input === "number" ? tokens.input : 0;
      const output = typeof tokens.output === "number" ? tokens.output : 0;
      const total = typeof tokens.total === "number" ? tokens.total : 0;
      if (input || output || total) {
        evt.tokens = { input, output, total };
      }
    }
    if (type === "tool_use") {
      const state = part.state as Record<string, unknown> | undefined;
      if (state) {
        if (typeof state.title === "string") evt.title = state.title;
        if (typeof state.status === "string") evt.status = state.status;
        if (state.input !== undefined) evt.input = state.input as Record<string, unknown>;
        if (typeof state.output === "string") evt.output = state.output;
        if (typeof state.error === "string") evt.error = state.error;
        const metadata = state.metadata as Record<string, unknown> | undefined;
        if (metadata && typeof metadata.exit === "number") evt.exit = metadata.exit;
        if (metadata && typeof metadata.truncated === "boolean") evt.truncated = metadata.truncated;
        const time = state.time as Record<string, unknown> | undefined;
        if (time && typeof time.start === "number" && typeof time.end === "number") {
          evt.durationMs = Math.max(0, time.end - time.start);
        }
      }
    }
  }
  return evt;
}

export function extractSessionAndUsage(stdout: string): SessionAndUsage {
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let session_id: string | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (session_id === null && typeof parsed.sessionID === "string") {
        session_id = parsed.sessionID;
      }
      if (parsed.type === "step_finish") {
        const part = parsed.part as Record<string, unknown> | undefined;
        const tokens = part?.tokens as Record<string, unknown> | undefined;
        if (tokens) {
          usage.input_tokens += typeof tokens.input === "number" ? tokens.input : 0;
          usage.output_tokens += typeof tokens.output === "number" ? tokens.output : 0;
          usage.total_tokens += typeof tokens.total === "number" ? tokens.total : 0;
        }
      }
    } catch {
      // not JSON, skip
    }
  }
  return { session_id, usage };
}

export async function runAttempt(opts: RunAttemptOptions): Promise<AttemptResult> {
  const { task, attempt, config, promptTemplate, logger } = opts;
  const started_at = Date.now();
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const apiExec = opts.apiExec ?? defaultApiExec();
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let workspace: Workspace;
  try {
    workspace = await createWorkspace({
      identifier: task.identifier,
      workspace: config.workspace,
      hooks: config.hooks,
      logger,
    });
  } catch (e) {
    return {
      status: "failed",
      error: toTaskingError(e).message,
      usage,
      session_id: null,
      started_at,
      ended_at: Date.now(),
    };
  }

  injectMcpConfig(workspace.path, config.tracker);

  const beforeResult = await runHook(
    config.hooks.before_run,
    workspace.path,
    config.hooks,
    logger,
    "before_run",
  );
  if (!beforeResult.success) {
    await runHook(config.hooks.after_run, workspace.path, config.hooks, logger, "after_run");
    return {
      status: "failed",
      error: `before_run hook failed: ${beforeResult.error}`,
      usage,
      session_id: null,
      started_at,
      ended_at: Date.now(),
    };
  }

  assertCwdIsWorkspace(workspace.path, workspace.path);
  logger.debug("worker spawn cwd verified", { cwd: workspace.path });

  let turn = opts.startTurn ?? 1;
  let lastStatus: AttemptStatus = "succeeded";
  let lastError: string | null = null;
  let currentTask = task;
  let sessionId: string | null = opts.sessionId ?? null;
  let knownAgent: string | null = null;
  const baseTokens = opts.baseTokens ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  try {
    let turnsRun = 0;
    while (turnsRun < config.agent.max_turns) {
      const prompt =
        turn === 1
          ? renderPrompt(promptTemplate, {
              task: currentTask,
              attempt,
              terminal_states: config.tracker.terminal_states.join(", "),
              active_states: config.tracker.active_states.join(", "),
              review_state: config.tracker.review_state ?? "",
            })
          : buildContinuationGuidance(currentTask, attempt ?? 1, turn);

      const resolved = resolveAgent(currentTask, config);
      if (resolved.warned) {
        logger.warn("agent label resolved to unknown agent, falling back to default", {
          task_identifier: task.identifier,
          default_agent: config.opencode.agent,
        });
      }
      const turnNo = turn;
      if (knownAgent !== null && resolved.agent !== knownAgent && sessionId) {
        try {
          await switchSessionAgent(
            apiExec,
            { command: config.opencode.command, serverUrl: config.opencode.server_url },
            sessionId,
            resolved.agent,
          );
        } catch (e) {
          logger.warn("session agent switch failed", {
            task_identifier: task.identifier,
            agent: resolved.agent,
            error: toTaskingError(e).message,
          });
        }
      }
      knownAgent = resolved.agent;

      opts.events?.onEvent?.({
        event: "turn_started",
        timestamp: Date.now(),
        message: `turn ${turn} of ${config.agent.max_turns}`,
        agent: resolved.agent,
        model: config.opencode.model,
        variant: config.opencode.variant,
      });

      logger.info("launching opencode v2 turn", {
        task_identifier: task.identifier,
        turn,
        agent: resolved.agent,
        session_id: sessionId ?? undefined,
      });

      const onEvent =
        opts.onActivity || opts.events?.onEvent
          ? (evt: TurnDriverEvent) => {
              if (opts.onActivity) {
                const activity: ActivityEvent = { ts: Date.now(), turn: turnNo, type: evt.type };
                if (evt.text !== undefined) activity.text = evt.text;
                if (evt.tool !== undefined) activity.tool = evt.tool;
                if (evt.input !== undefined) activity.input = evt.input;
                if (evt.output !== undefined) activity.output = evt.output;
                if (evt.exit !== undefined) activity.exit = evt.exit;
                if (evt.status !== undefined) activity.status = evt.status;
                if (evt.durationMs !== undefined) activity.durationMs = evt.durationMs;
                if (evt.truncated !== undefined) activity.truncated = evt.truncated;
                opts.onActivity(activity);
              }
              if (evt.type === "step_usage" && evt.usage !== undefined && opts.events?.onEvent) {
                opts.events.onEvent({
                  event: "step_usage",
                  timestamp: Date.now(),
                  usage: {
                    input_tokens: evt.usage.input_tokens,
                    output_tokens: evt.usage.output_tokens,
                    total_tokens: evt.usage.total_tokens,
                  },
                });
              }
            }
          : undefined;

      let result: Awaited<ReturnType<typeof runTurn>>;
      try {
        result = await runTurn({
          exec: apiExec,
          base: {
            command: config.opencode.command,
            serverUrl: config.opencode.server_url,
          },
          directory: workspace.path,
          prompt,
          sessionId,
          createOptions: {
            model: config.opencode.model,
            variant: config.opencode.variant,
            agent: resolved.agent,
            autoApprove: config.opencode.auto_approve,
          },
          pollIntervalMs: config.opencode.poll_interval_ms,
          permissionTimeoutMs: config.opencode.permission_timeout_ms,
          turnTimeoutMs: config.opencode.turn_timeout_ms,
          inactivityTimeoutMs: config.opencode.inactivity_timeout_ms,
          interruptGraceMs: opts.interruptGraceMs,
          sleep,
          now: opts.now,
          onEvent,
          onPendingPermissions: opts.onPendingPermissions,
          onPermissionReply: opts.onPermissionReply,
          signal: opts.signal,
        });
      } catch (e) {
        lastStatus = "failed";
        lastError = toTaskingError(e).message;
        break;
      }

      usage.input_tokens += result.usage.input_tokens;
      usage.output_tokens += result.usage.output_tokens;
      usage.total_tokens += result.usage.total_tokens;
      if (result.sessionId) {
        sessionId = result.sessionId;
        writeSessionSidecar(workspace.path, sessionId, turn, {
          input_tokens: baseTokens.input_tokens + usage.input_tokens,
          output_tokens: baseTokens.output_tokens + usage.output_tokens,
          total_tokens: baseTokens.total_tokens + usage.total_tokens,
        });
      }

      opts.events?.onEvent?.({
        event: "turn_completed",
        timestamp: Date.now(),
        session_id: sessionId ?? undefined,
      });

      if (result.status === "timed_out") {
        lastStatus = "timed_out";
        lastError = `turn ${turn} timed out (${result.error ?? "turn_timeout"})`;
        break;
      }
      if (
        result.status === "failed" ||
        result.status === "error" ||
        result.status === "interrupted"
      ) {
        lastStatus = "failed";
        lastError = result.error ?? `turn ${turn} ${result.status}`;
        break;
      }

      if (opts.trackerStateChecker) {
        const refreshed = await opts.trackerStateChecker(currentTask);
        if (!refreshed) {
          lastStatus = "succeeded";
          logger.info("task no longer active, stopping continuation", {
            task_identifier: task.identifier,
          });
          break;
        }
        currentTask = refreshed;
      } else {
        lastStatus = "succeeded";
        break;
      }

      turn++;
      turnsRun++;
    }
  } finally {
    await runHook(config.hooks.after_run, workspace.path, config.hooks, logger, "after_run");
  }

  return {
    status: lastStatus,
    error: lastError,
    usage,
    session_id: sessionId,
    started_at,
    ended_at: Date.now(),
  };
}

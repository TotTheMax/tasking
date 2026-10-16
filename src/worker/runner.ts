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

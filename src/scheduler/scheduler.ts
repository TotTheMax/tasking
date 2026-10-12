import { EventEmitter } from "node:events";
import { isActiveState, isTerminalState } from "../adapters/jira/tracker.js";
import type { EffectiveConfig } from "../config/config-types.js";
import { validateDispatchConfig } from "../config/validator.js";
import { ActivityStore } from "../observability/activity-store.js";
import type { Logger } from "../observability/logger.js";
import { TaskingError, toTaskingError } from "../shared/errors.js";
import {
  type OrchestratorRuntimeState,
  type RetryEntry,
  type RunningEntry,
  type Task,
  createInitialState,
} from "../shared/types.js";
import type { AttemptResult, runAttempt } from "../worker/runner.js";
import { readSessionSidecar, removeWorkspace, resolveWorkspacePath } from "../workspace/manager.js";

export interface TrackerPort {
  fetchCandidateIssues(): Promise<Task[]>;
  fetchIssuesByStates(states: string[]): Promise<Task[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Task[]>;
}

export interface SchedulerDeps {
  tracker: TrackerPort;
  config: () => EffectiveConfig;
  logger: Logger;
  runAttemptFn: typeof runAttempt;
  spawnRunner?: (
    cmd: string[],
    cwd: string,
    timeout: number,
    inactivityTimeout: number,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

const CONTINUATION_DELAY_MS = 1000;
const BASE_BACKOFF_MS = 10000;
const MAX_BACKOFF_POWER = 10;

export function normalizeState(state: string): string {
  return state.trim().toLowerCase();
}

export function isRoutable(task: Task, config: EffectiveConfig): boolean {
  for (const label of config.tracker.required_labels) {
    if (!task.labels.includes(label.trim().toLowerCase())) return false;
  }
  if (config.tracker.assignee && config.tracker.assignee !== "me") {
    if (task.assignee !== config.tracker.assignee) return false;
  }
  return true;
}

export function computeBackoffDelay(attempt: number, maxBackoffMs: number): number {
  const power = Math.min(attempt - 1, MAX_BACKOFF_POWER);
  return Math.min(BASE_BACKOFF_MS * 2 ** power, maxBackoffMs);
}

export function sortForDispatch(issues: Task[]): Task[] {
  return [...issues].sort((a, b) => {
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    const ca = a.created_at ?? Number.MAX_SAFE_INTEGER;
    const cb = b.created_at ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    return a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0;
  });
}

export function isDispatchEligible(
  task: Task,
  state: OrchestratorRuntimeState,
  config: EffectiveConfig,
): boolean {
  if (!task.id || !task.identifier || !task.title || !task.state) return false;
  const active = isActiveState(task.state, config.tracker.active_states);
  const terminal = isTerminalState(task.state, config.tracker.terminal_states);
  if (!active || terminal) return false;
  if (state.running.has(task.id) || state.claimed.has(task.id)) return false;
  if (!isRoutable(task, config)) return false;

  const isTodo = normalizeState(task.state).replace(/\s+/g, "") === "todo";
  if (isTodo) {
    for (const blocker of task.blocked_by) {
      const blockerTerminal =
        blocker.state !== null && isTerminalState(blocker.state, config.tracker.terminal_states);
      if (!blockerTerminal) return false;
    }
  }
  return true;
}

export function availableGlobalSlots(
  state: OrchestratorRuntimeState,
  config: EffectiveConfig,
): number {
  return Math.max(config.agent.max_concurrent_agents - state.running.size, 0);
}

export function hasStateSlot(
  task: Task,
  state: OrchestratorRuntimeState,
  config: EffectiveConfig,
): boolean {
  const normalized = normalizeState(task.state);
  const cap = config.agent.max_concurrent_agents_by_state[normalized];
  if (cap === undefined) return true;
  let count = 0;
  for (const entry of state.running.values()) {
    if (normalizeState(entry.task.state) === normalized) count++;
  }
  return count < cap;
}

export class Scheduler extends EventEmitter {
  readonly state: OrchestratorRuntimeState;
  readonly activityStore: ActivityStore;
  private readonly deps: SchedulerDeps;
  private running = false;
  private refreshRequested = false;
  private tickInFlight = false;

  constructor(deps: SchedulerDeps) {
    super();
    this.deps = deps;
    const config = deps.config();
    this.state = createInitialState(config.polling.interval_ms, config.agent.max_concurrent_agents);
    this.activityStore = new ActivityStore();
    this.running = true;
  }

  stop(): void {
    this.running = false;
    for (const entry of this.state.running.values()) {
      entry.abort?.abort();
    }
    for (const retry of this.state.retry_attempts.values()) {
      if (retry.timer) clearTimeout(retry.timer);
    }
    this.state.retry_attempts.clear();
  }

  requestRefresh(): boolean {
    const already = this.refreshRequested;
    this.refreshRequested = true;
    if (!already && !this.tickInFlight && this.running) {
      queueMicrotask(() => this.selfDrivenTick());
    }
    return !already;
  }

  private selfDrivenTick(): void {
    void this.tick().catch((e) => {
      this.deps.logger.error("refresh tick failed", {
        error: toTaskingError(e).message,
      });
    });
  }

  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    this.refreshRequested = false;
    try {
      await this.tickBody();
    } finally {
      this.tickInFlight = false;
      if (this.refreshRequested && this.running) {
        this.selfDrivenTick();
      }
    }
  }

  private async tickBody(): Promise<void> {
    await this.reconcileRunningIssues();
    const config = this.deps.config();

    const validation = validateDispatchConfig(config);
    if (!validation.ok) {
      for (const e of validation.errors) {
        this.deps.logger.warn("dispatch validation failed", {
          category: e.category,
          message: e.message,
        });
      }
      return;
    }

    let issues: Task[];
    try {
      issues = await this.deps.tracker.fetchCandidateIssues();
    } catch (e) {
      this.deps.logger.warn("candidate fetch failed, skipping dispatch", {
        error: toTaskingError(e).message,
      });
      return;
    }

    this.deps.logger.debug("fetched candidates", {
      count: issues.length,
      running: this.state.running.size,
      retrying: this.state.retry_attempts.size,
    });

    const sorted = sortForDispatch(issues);
    let dispatched = 0;
    let skipped = 0;
    for (const task of sorted) {
      if (availableGlobalSlots(this.state, config) === 0) {
        this.deps.logger.info("global slots exhausted, stopping dispatch", {
          running: this.state.running.size,
          max: config.agent.max_concurrent_agents,
        });
        break;
      }
      if (isDispatchEligible(task, this.state, config) && hasStateSlot(task, this.state, config)) {
        this.dispatch(task, null);
        dispatched++;
      } else {
        skipped++;
      }
    }

    if (dispatched > 0 || skipped > 0) {
      this.deps.logger.info("dispatch summary", {
        candidates: issues.length,
        dispatched,
        skipped,
      });
    }
  }

  private dispatch(task: Task, attempt: number | null, sessionId?: string | null): void {
    const config = this.deps.config();
    const workspacePath = resolveWorkspacePath(task.identifier, config.workspace.root);
    const sidecar = readSessionSidecar(workspacePath);
    const sid = sessionId ?? sidecar?.sessionId ?? null;
    const savedTurns = sidecar?.turnCount ?? 0;
    const entry: RunningEntry = {
      task,
      task_identifier: task.identifier,
      workspace_path: workspacePath,
      session_id: sid,
      last_event: null,
      last_message: null,
      last_event_at: null,
      started_at: Date.now(),
      turn_count: savedTurns,
      input_tokens: sidecar?.inputTokens ?? 0,
      output_tokens: sidecar?.outputTokens ?? 0,
      total_tokens: sidecar?.totalTokens ?? 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      retry_attempt: attempt,
      abort: new AbortController(),
      agent: null,
      model: null,
      variant: null,
    };
    this.state.running.set(task.id, entry);
    this.state.claimed.add(task.id);
    this.state.retry_attempts.delete(task.id);
    this.emit("dispatch", task.id);

    void this.runWorker(task, attempt, entry, savedTurns > 0 ? savedTurns + 1 : undefined);
  }

  private async runWorker(
    task: Task,
    attempt: number | null,
    entry: RunningEntry,
    startTurn?: number,
  ): Promise<void> {
    const config = this.deps.config();
    const trackerStateChecker = async (t: Task): Promise<Task | null> => {
      try {
        const refreshed = await this.deps.tracker.fetchIssueStatesByIds([t.id]);
        const fresh = refreshed.find((r) => r.id === t.id);
        if (!fresh) return null;
        if (!isActiveState(fresh.state, config.tracker.active_states)) return null;
        return fresh;
      } catch {
        return t;
      }
    };

    let result: AttemptResult;
    try {
      result = await this.deps.runAttemptFn({
        task,
        attempt,
        config: {
          opencode: config.opencode,
          hooks: config.hooks,
          agent: config.agent,
          workspace: config.workspace,
          tracker: config.tracker,
          env: config.env,
        },
        promptTemplate: config.prompt_template,
        logger: this.deps.logger.child({ task_identifier: task.identifier }),
        trackerStateChecker,
        spawnRunner: this.deps.spawnRunner as never,
        sessionId: entry.session_id,
        startTurn,
        signal: entry.abort?.signal,
        baseTokens: {
          input_tokens: entry.input_tokens,
          output_tokens: entry.output_tokens,
          total_tokens: entry.total_tokens,
        },
        onActivity: (evt) => this.activityStore.record(task.id, evt),
        events: {
          onEvent: (event) => {
            entry.last_event = event.event;
            entry.last_event_at = Date.now();
            if (event.message) {
              entry.last_message = event.message;
            }
            if (event.event === "turn_started") {
              entry.turn_count++;
            }
            if (event.agent !== undefined) {
              entry.agent = event.agent;
            }
            if (event.model !== undefined) {
              entry.model = event.model;
            }
            if (event.variant !== undefined) {
              entry.variant = event.variant;
            }
            if (event.session_id) {
              entry.session_id = event.session_id;
            }
            if (event.usage) {
              entry.input_tokens += event.usage.input_tokens;
              entry.output_tokens += event.usage.output_tokens;
              entry.total_tokens += event.usage.total_tokens;
            }
          },
        },
      });
    } catch (e) {
      result = {
        status: "failed",
        error: toTaskingError(e).message,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        session_id: null,
        started_at: entry.started_at,
        ended_at: Date.now(),
      };
    }

    if (result.session_id) {
      entry.session_id = result.session_id;
    }

    this.onWorkerExit(task, result);
  }

  private onWorkerExit(task: Task, result: AttemptResult): void {
    const entry = this.state.running.get(task.id);
    this.state.running.delete(task.id);
    this.activityStore.clear(task.id);
    const elapsed = entry ? Math.max(0, (result.ended_at - entry.started_at) / 1000) : 0;
    this.state.totals.seconds_running += elapsed;
    this.state.totals.input_tokens += result.usage.input_tokens;
    this.state.totals.output_tokens += result.usage.output_tokens;
    this.state.totals.total_tokens += result.usage.total_tokens;

    if (!entry) {
      this.emit("workerExit", task.id, result.status);
      return;
    }

    const normal = result.status === "succeeded";
    if (normal) {
      this.state.completed.add(task.id);
      this.scheduleRetry(task, 1, null, true, result.session_id ?? entry.session_id ?? null);
    } else {
      const nextAttempt = (entry.retry_attempt ?? 0) + 1;
      this.scheduleRetry(task, nextAttempt, result.error, false);
    }
    this.emit("workerExit", task.id, result.status);
  }

  private scheduleRetry(
    task: Task,
    attempt: number,
    error: string | null,
    continuation: boolean,
    sessionId?: string | null,
  ): void {
    const existing = this.state.retry_attempts.get(task.id);
    if (existing?.timer) clearTimeout(existing.timer);

    const config = this.deps.config();
    const useContinuationDelay = continuation && attempt === 1;
    const delay = useContinuationDelay
      ? CONTINUATION_DELAY_MS
      : computeBackoffDelay(attempt, config.agent.max_retry_backoff_ms);
    const dueAt = Date.now() + delay;

    const entry: RetryEntry = {
      task_id: task.id,
      identifier: task.identifier,
      attempt,
      due_at_ms: dueAt,
      timer: setTimeout(() => void this.onRetry(task.id), delay),
      error,
      continuation,
      session_id: sessionId ?? null,
    };
    this.state.retry_attempts.set(task.id, entry);
    this.emit("retry", task.id, attempt);
  }

  private async onRetry(taskId: string): Promise<void> {
    const retry = this.state.retry_attempts.get(taskId);
    if (!retry) return;
    this.state.retry_attempts.delete(taskId);
    this.state.claimed.delete(taskId);

    const config = this.deps.config();
    let candidates: Task[];
    try {
      candidates = await this.deps.tracker.fetchCandidateIssues();
    } catch (e) {
      this.scheduleRetry(
        {
          id: taskId,
          identifier: retry.identifier,
          title: "",
          description: null,
          priority: null,
          state: "",
          branch_name: null,
          url: null,
          labels: [],
          blocked_by: [],
          assignee: null,
          created_at: null,
          updated_at: null,
          source: "jira",
        },
        retry.attempt + 1,
        `retry poll failed: ${toTaskingError(e).message}`,
        false,
      );
      return;
    }

    const task = candidates.find((t) => t.id === taskId);
    if (!task) {
      this.state.claimed.delete(taskId);
      if (retry.continuation) {
        try {
          const refreshed = await this.deps.tracker.fetchIssueStatesByIds([taskId]);
          const fresh = refreshed.find((t) => t.id === taskId);
          if (fresh && isTerminalState(fresh.state, config.tracker.terminal_states)) {
            const wsPath = resolveWorkspacePath(retry.identifier, config.workspace.root);
            await removeWorkspace(wsPath, config.hooks, this.deps.logger);
            this.deps.logger.info("continuation retry found terminal task, cleaned workspace", {
              task_identifier: retry.identifier,
            });
          }
        } catch (e) {
          this.deps.logger.debug("continuation retry state check failed", {
            error: toTaskingError(e).message,
          });
        }
      }
      return;
    }
    if (!isDispatchEligible(task, this.state, config)) {
      this.state.claimed.delete(taskId);
      return;
    }
    if (availableGlobalSlots(this.state, config) === 0) {
      this.scheduleRetry(task, retry.attempt + 1, "no available orchestrator slots", false);
      return;
    }
    this.dispatch(task, retry.attempt, retry.session_id);
  }

  async reconcileRunningIssues(): Promise<void> {
    await this.reconcileStalledRuns();
    await this.reconcileTrackerStates();
  }

  private async reconcileStalledRuns(): Promise<void> {
    const config = this.deps.config();
    if (config.opencode.stall_timeout_ms <= 0) return;
    const now = Date.now();
    for (const [taskId, entry] of this.state.running) {
      const lastActivity = entry.last_event_at ?? entry.started_at;
      if (now - lastActivity > config.opencode.stall_timeout_ms) {
        await this.terminateRunning(taskId, false, "stalled");
        this.scheduleRetry(entry.task, (entry.retry_attempt ?? 0) + 1, "stalled", false);
        this.deps.logger.warn("stalled run terminated", { task_identifier: entry.task_identifier });
      }
    }
  }

  private async reconcileTrackerStates(): Promise<void> {
    const ids = [...this.state.running.keys()];
    if (ids.length === 0) return;
    const config = this.deps.config();
    let refreshed: Task[];
    try {
      refreshed = await this.deps.tracker.fetchIssueStatesByIds(ids);
    } catch (e) {
      this.deps.logger.debug("state refresh failed, keeping workers", {
        error: toTaskingError(e).message,
      });
      return;
    }
    const refreshedIds = new Set(refreshed.map((t) => t.id));
    for (const task of refreshed) {
      const entry = this.state.running.get(task.id);
      if (!entry) continue;
      if (isTerminalState(task.state, config.tracker.terminal_states)) {
        await this.terminateRunning(task.id, true, "terminal");
        this.deps.logger.info("terminal state, cleaned workspace", {
          task_identifier: task.identifier,
          workspace_path: entry.workspace_path,
        });
      } else if (isActiveState(task.state, config.tracker.active_states)) {
        if (!isRoutable(task, config)) {
          await this.terminateRunning(task.id, false, "routability lost");
          this.deps.logger.info("routability lost, stopped without cleanup", {
            task_identifier: task.identifier,
          });
        } else {
          entry.task = task;
        }
      } else {
        await this.terminateRunning(task.id, false, "non-active");
        this.deps.logger.info("non-active state, stopped without cleanup", {
          task_identifier: task.identifier,
        });
      }
    }
    for (const taskId of ids) {
      if (!refreshedIds.has(taskId)) {
        const entry = this.state.running.get(taskId);
        if (entry) {
          await this.terminateRunning(taskId, false, "missing from tracker");
          this.deps.logger.warn("running issue no longer visible during state refresh", {
            task_identifier: entry.task_identifier,
          });
        }
      }
    }
  }

  private async terminateRunning(taskId: string, cleanup: boolean, reason: string): Promise<void> {
    const entry = this.state.running.get(taskId);
    if (!entry) return;
    entry.abort?.abort();
    this.state.running.delete(taskId);
    this.state.retry_attempts.delete(taskId);
    this.state.claimed.delete(taskId);
    const elapsed = Math.max(0, (Date.now() - entry.started_at) / 1000);
    this.state.totals.seconds_running += elapsed;
    if (cleanup) {
      await removeWorkspace(
        entry.workspace_path,
        this.deps.config().hooks,
        this.deps.logger,
        entry.session_id,
      );
    }
    this.emit("terminate", taskId, reason);
  }

  async startupTerminalCleanup(): Promise<void> {
    const config = this.deps.config();
    let terminal: Task[];
    try {
      terminal = await this.deps.tracker.fetchIssuesByStates(config.tracker.terminal_states);
    } catch (e) {
      this.deps.logger.warn("terminal cleanup fetch failed, continuing startup", {
        error: toTaskingError(e).message,
      });
      return;
    }
    for (const task of terminal) {
      try {
        const wsPath = resolveWorkspacePath(task.identifier, config.workspace.root);
        await removeWorkspace(wsPath, config.hooks, this.deps.logger);
      } catch (e) {
        this.deps.logger.debug("workspace cleanup skipped", { error: toTaskingError(e).message });
      }
    }
  }
}

export { TaskingError };

import type {
  OrchestratorRuntimeState,
  RuntimeDirectSession,
  RuntimeSnapshot,
} from "../shared/types.js";

export interface SnapshotExtras {
  direct?: RuntimeDirectSession[];
  directTotals?: { input_tokens: number; output_tokens: number; total_tokens: number };
}

export function buildSnapshot(
  state: OrchestratorRuntimeState,
  extras: SnapshotExtras = {},
): RuntimeSnapshot {
  const direct = extras.direct ?? [];
  const directTotals = extras.directTotals ?? {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  const running = [...state.running.values()].map((entry) => {
    const now = Date.now();
    return {
      task_id: entry.task.id,
      task_identifier: entry.task_identifier,
      state: entry.task.state,
      session_id: entry.session_id,
      turn_count: entry.turn_count,
      last_event: entry.last_event,
      last_message: entry.last_message,
      started_at: entry.started_at,
      last_event_at: entry.last_event_at,
      workspace_path: entry.workspace_path,
      tokens: {
        input_tokens: entry.input_tokens,
        output_tokens: entry.output_tokens,
        total_tokens: entry.total_tokens,
      },
      elapsed_ms: now - entry.started_at,
      agent: entry.agent,
      model: entry.model,
      variant: entry.variant,
    };
  });

  const retrying = [...state.retry_attempts.values()].map((entry) => ({
    task_id: entry.task_id,
    task_identifier: entry.identifier,
    attempt: entry.attempt,
    due_at: entry.due_at_ms,
    error: entry.error,
  }));

  const activeSeconds =
    state.totals.seconds_running +
    [...state.running.values()].reduce((acc, e) => acc + (Date.now() - e.started_at) / 1000, 0);

  return {
    generated_at: Date.now(),
    max_concurrent_agents: state.max_concurrent_agents,
    direct,
    counts: {
      running: running.length,
      retrying: retrying.length,
    },
    running,
    retrying,
    totals: {
      input_tokens: state.totals.input_tokens + directTotals.input_tokens,
      output_tokens: state.totals.output_tokens + directTotals.output_tokens,
      total_tokens: state.totals.total_tokens + directTotals.total_tokens,
      seconds_running: activeSeconds,
    },
  };
}

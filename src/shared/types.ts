export type TaskSource = "jira";

export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}
export interface Task {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  assignee: string | null;
  created_at: number | null;
  updated_at: number | null;
  source: TaskSource;
}

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  prompt_template: string;
  path: string;
}

export interface Workspace {
  path: string;
  workspace_key: string;
  created_now: boolean;
}

export type AttemptStatus =
  | "preparing_workspace"
  | "building_prompt"
  | "launching_agent"
  | "finishing"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "stalled"
  | "canceled_by_reconciliation";

export interface RunAttempt {
  task_id: string;
  task_identifier: string;
  attempt: number | null;
  workspace_path: string;
  started_at: number;
  status: AttemptStatus;
  error: string | null;
}

export interface RunningEntry {
  task: Task;
  task_identifier: string;
  workspace_path: string;
  session_id: string | null;
  last_event: string | null;
  last_message: string | null;
  last_event_at: number | null;
  started_at: number;
  turn_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  retry_attempt: number | null;
  abort: AbortController | null;
  agent: string | null;
  model: string | null;
  variant: string | null;
}

export interface RetryEntry {
  task_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer: NodeJS.Timeout | null;
  error: string | null;
  continuation: boolean;
  session_id: string | null;
}

export interface AggregateTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  seconds_running: number;
}

export interface OrchestratorRuntimeState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  totals: AggregateTotals;
}

export interface RuntimeDirectSession {
  id: string;
  root_id: string;
  name: string | null;
  project: string | null;
  path: string;
  status: "running" | "idle";
  session_id: string | null;
  queued: number;
  updated_at: number;
  agent: string | null;
  model: string | null;
  variant: string | null;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface RuntimeSnapshot {
  generated_at: number;
  max_concurrent_agents: number;
  direct?: RuntimeDirectSession[];
  counts: {
    running: number;
    retrying: number;
  };
  running: Array<{
    task_id: string;
    task_identifier: string;
    state: string;
    session_id: string | null;
    turn_count: number;
    last_event: string | null;
    last_message: string | null;
    started_at: number;
    last_event_at: number | null;
    workspace_path: string;
    tokens: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    elapsed_ms: number;
    agent: string | null;
    model: string | null;
    variant: string | null;
  }>;
  retrying: Array<{
    task_id: string;
    task_identifier: string;
    attempt: number;
    due_at: number;
    error: string | null;
  }>;
  totals: AggregateTotals;
}

export function createEmptyTotals(): AggregateTotals {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 };
}

export function createInitialState(
  poll_interval_ms: number,
  max_concurrent_agents: number,
): OrchestratorRuntimeState {
  return {
    poll_interval_ms,
    max_concurrent_agents,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    totals: createEmptyTotals(),
  };
}

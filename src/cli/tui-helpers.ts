import type { ConfigRuntimeInfo, ConfigView } from "../observability/config-view.js";
import type { RuntimeSnapshot } from "../shared/types.js";

function toEpoch(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function httpToConfigView(json: Record<string, unknown>): ConfigView {
  const config =
    typeof json.config === "object" && json.config !== null
      ? (json.config as Record<string, unknown>)
      : {};
  const raw =
    typeof json.runtime === "object" && json.runtime !== null
      ? (json.runtime as Record<string, unknown>)
      : {};
  const runtime: ConfigRuntimeInfo = {
    pid: typeof raw.pid === "number" ? raw.pid : null,
    started_at:
      typeof raw.started_at === "string"
        ? toEpoch(raw.started_at)
        : typeof raw.started_at === "number"
          ? raw.started_at
          : null,
    workflow_path: typeof raw.workflow_path === "string" ? raw.workflow_path : null,
    workspace_root: typeof raw.workspace_root === "string" ? raw.workspace_root : null,
    log_path: typeof raw.log_path === "string" ? raw.log_path : null,
    host: typeof raw.host === "string" ? raw.host : null,
    port: typeof raw.port === "number" ? raw.port : null,
  };
  return { config, runtime };
}

export function httpToSnapshot(json: Record<string, unknown>): RuntimeSnapshot {
  const running = Array.isArray(json.running) ? json.running : [];
  const retrying = Array.isArray(json.retrying) ? json.retrying : [];
  const direct = Array.isArray(json.direct) ? json.direct : [];
  const totalsRaw = json.codex_totals ?? json.totals;
  const totals =
    typeof totalsRaw === "object" && totalsRaw !== null
      ? (totalsRaw as Record<string, number>)
      : {};

  return {
    generated_at:
      typeof json.generated_at === "string"
        ? (toEpoch(json.generated_at) ?? Date.now())
        : Date.now(),
    max_concurrent_agents:
      typeof json.max_concurrent_agents === "number" ? json.max_concurrent_agents : 0,
    direct: direct.map((e: unknown) => {
      const r = e as Record<string, unknown>;
      return {
        id: String(r.id ?? ""),
        root_id: String(r.root_id ?? ""),
        name: r.name ? String(r.name) : null,
        project: r.project ? String(r.project) : null,
        path: String(r.path ?? ""),
        status: r.status === "running" ? "running" : "idle",
        session_id: r.session_id ? String(r.session_id) : null,
        queued: Number(r.queued ?? 0),
        updated_at:
          typeof r.updated_at === "string"
            ? (toEpoch(r.updated_at) ?? 0)
            : Number(r.updated_at ?? 0),
        agent: r.agent ? String(r.agent) : null,
        model: r.model ? String(r.model) : null,
        variant: r.variant ? String(r.variant) : null,
        turns: Number(r.turns ?? 0),
        input_tokens: Number(r.input_tokens ?? 0),
        output_tokens: Number(r.output_tokens ?? 0),
        total_tokens: Number(r.total_tokens ?? 0),
      };
    }),
    counts: {
      running:
        typeof json.counts === "object" && json.counts !== null
          ? ((json.counts as Record<string, number>).running ?? 0)
          : 0,
      retrying:
        typeof json.counts === "object" && json.counts !== null
          ? ((json.counts as Record<string, number>).retrying ?? 0)
          : 0,
    },
    running: running.map((e: unknown) => {
      const r = e as Record<string, unknown>;
      const tokens =
        typeof r.tokens === "object" && r.tokens !== null
          ? (r.tokens as Record<string, number>)
          : {};
      return {
        task_id: String(r.task_id ?? ""),
        task_identifier: String(r.task_identifier ?? ""),
        state: String(r.state ?? ""),
        session_id: r.session_id ? String(r.session_id) : null,
        turn_count: Number(r.turn_count ?? 0),
        last_event: r.last_event ? String(r.last_event) : null,
        last_message: r.last_message ? String(r.last_message) : null,
        started_at:
          typeof r.started_at === "string"
            ? (toEpoch(r.started_at) ?? 0)
            : Number(r.started_at ?? 0),
        last_event_at:
          r.last_event_at === null || r.last_event_at === undefined
            ? null
            : typeof r.last_event_at === "string"
              ? toEpoch(r.last_event_at)
              : Number(r.last_event_at),
        workspace_path: String(r.workspace_path ?? ""),
        tokens: {
          input_tokens: Number(tokens.input_tokens ?? 0),
          output_tokens: Number(tokens.output_tokens ?? 0),
          total_tokens: Number(tokens.total_tokens ?? 0),
        },
        elapsed_ms: 0,
        agent: r.agent ? String(r.agent) : null,
        model: r.model ? String(r.model) : null,
        variant: r.variant ? String(r.variant) : null,
      };
    }),
    retrying: retrying.map((e: unknown) => {
      const r = e as Record<string, unknown>;
      return {
        task_id: String(r.task_id ?? ""),
        task_identifier: String(r.task_identifier ?? ""),
        attempt: Number(r.attempt ?? 0),
        due_at: typeof r.due_at === "string" ? (toEpoch(r.due_at) ?? 0) : Number(r.due_at ?? 0),
        error: r.error ? String(r.error) : null,
      };
    }),
    totals: {
      input_tokens: Number(totals.input_tokens ?? 0),
      output_tokens: Number(totals.output_tokens ?? 0),
      total_tokens: Number(totals.total_tokens ?? 0),
      seconds_running: Number(totals.seconds_running ?? 0),
    },
  };
}

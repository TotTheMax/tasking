import { type Server, createServer } from "node:http";
import type { OrchestratorRuntimeState, RuntimeDirectSession } from "../shared/types.js";
import type { ActivityStore } from "./activity-store.js";
import type { ConfigView } from "./config-view.js";
import type { LogRingBuffer } from "./log-buffer.js";
import type { Logger } from "./logger.js";
import { buildSnapshot } from "./snapshot.js";

export interface HttpDashboardOptions {
  port: number;
  host: string;
  state: () => OrchestratorRuntimeState;
  logger: Logger;
  requestRefresh?: () => boolean;
  configView?: () => ConfigView;
  logBuffer?: LogRingBuffer;
  activityStore?: ActivityStore;
  directSessions?: () => RuntimeDirectSession[];
  directTotals?: () => { input_tokens: number; output_tokens: number; total_tokens: number };
  permissionTimeoutMs?: () => number | undefined;
  deleteDirectSession?: (rootId: string) => Promise<boolean>;
}

function isoNow(): string {
  return new Date().toISOString();
}

function toIso(epoch: number | null): string | null {
  return epoch !== null ? new Date(epoch).toISOString() : null;
}

function buildSnapshotResponse(
  state: OrchestratorRuntimeState,
  direct: RuntimeDirectSession[],
  directTotals: { input_tokens: number; output_tokens: number; total_tokens: number },
  permissionTimeoutMs?: number,
): Record<string, unknown> {
  const snap = buildSnapshot(state, { direct, directTotals, permissionTimeoutMs });
  return {
    generated_at: isoNow(),
    max_concurrent_agents: snap.max_concurrent_agents,
    counts: snap.counts,
    direct,
    running: snap.running.map((e) => ({
      ...e,
      started_at: toIso(e.started_at),
      last_event_at: toIso(e.last_event_at),
      workspace_path: e.workspace_path,
    })),
    retrying: snap.retrying.map((e) => ({
      ...e,
      due_at: toIso(e.due_at),
    })),
    codex_totals: snap.totals,
  };
}

function buildConfigResponse(configView: () => ConfigView): Record<string, unknown> {
  const view = configView();
  return {
    generated_at: isoNow(),
    config: view.config,
    runtime: {
      ...view.runtime,
      started_at: toIso(view.runtime.started_at),
    },
  };
}

export class HttpDashboard {
  private server: Server | null = null;
  private readonly opts: HttpDashboardOptions;

  constructor(opts: HttpDashboardOptions) {
    this.opts = opts;
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handle(req, res));
      const host = this.opts.host;
      this.server.listen(this.opts.port, host, () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : this.opts.port;
        this.opts.logger.info("http dashboard started", { port: actualPort, host });
        resolve(actualPort);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private getPath(url: string): string {
    try {
      return new URL(url, "http://localhost").pathname;
    } catch {
      return url;
    }
  }

  private sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private sendError(
    res: import("node:http").ServerResponse,
    status: number,
    code: string,
    message: string,
  ): void {
    this.sendJson(res, status, { error: { code, message } });
  }

  private handle(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): void {
    const path = this.getPath(req.url ?? "/");
    const method = req.method ?? "GET";
    void (async () => {
      try {
        if ((path === "/" || path === "/index.html") && method === "GET") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderHtml());
          return;
        }
        if (path === "/" || path === "/index.html") {
          this.sendError(res, 405, "method_not_allowed", "Method not allowed");
          return;
        }
        if (path === "/api/v1/state" && method === "GET") {
          this.sendJson(
            res,
            200,
            buildSnapshotResponse(
              this.opts.state(),
              this.opts.directSessions?.() ?? [],
              this.opts.directTotals?.() ?? {
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
              },
              this.opts.permissionTimeoutMs?.(),
            ),
          );
          return;
        }
        if (path === "/api/v1/state") {
          this.sendError(res, 405, "method_not_allowed", "Method not allowed");
          return;
        }
        if (path === "/api/v1/config" && method === "GET") {
          const configView = this.opts.configView;
          if (!configView) {
            this.sendError(res, 404, "config_not_available", "Config view not available");
            return;
          }
          this.sendJson(res, 200, buildConfigResponse(configView));
          return;
        }
        if (path === "/api/v1/config") {
          this.sendError(res, 405, "method_not_allowed", "Method not allowed");
          return;
        }
        if (path === "/api/v1/logs" && method === "GET") {
          const buf = this.opts.logBuffer;
          if (!buf) {
            this.sendError(res, 404, "logs_not_available", "Log buffer not available");
            return;
          }
          let n = 200;
          try {
            const u = new URL(req.url ?? "/", "http://localhost");
            const parsed = Number.parseInt(u.searchParams.get("lines") ?? "", 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              n = Math.min(parsed, 500);
            }
          } catch {
            // fall back to default n
          }
          this.sendJson(res, 200, { logs: buf.recent(n) });
          return;
        }
        if (path === "/api/v1/logs") {
          this.sendError(res, 405, "method_not_allowed", "Method not allowed");
          return;
        }
        if (path === "/api/v1/refresh" && method === "POST") {
          const coalesced = this.opts.requestRefresh ? !this.opts.requestRefresh() : false;
          this.sendJson(res, 202, {
            queued: true,
            coalesced,
            requested_at: isoNow(),
            operations: ["poll", "reconcile"],
          });
          return;
        }
        if (path === "/api/v1/refresh") {
          this.sendError(res, 405, "method_not_allowed", "Method not allowed");
          return;
        }
        const directDelete = "/api/v1/direct/";
        const deleteSuffix = "/delete";
        if (path.startsWith(directDelete) && path.endsWith(deleteSuffix)) {
          const rootId = decodeURIComponent(
            path.slice(directDelete.length, path.length - deleteSuffix.length),
          );
          if (method === "POST") {
            if (!this.opts.deleteDirectSession) {
              this.sendError(
                res,
                404,
                "direct_delete_unavailable",
                "Direct session delete not wired",
              );
              return;
            }
            try {
              const ok = await this.opts.deleteDirectSession(rootId);
              if (ok) this.sendJson(res, 200, { ok: true, root_id: rootId });
              else this.sendError(res, 404, "direct_session_not_found", "Unknown direct session");
            } catch (e) {
              this.sendError(
                res,
                500,
                "direct_delete_failed",
                e instanceof Error ? e.message : "error",
              );
            }
            return;
          }
          this.sendError(res, 405, "method_not_allowed", "Method not allowed");
          return;
        }
        if (path.startsWith("/api/v1/") && method === "GET") {
          const suffix = "/activity";
          if (path.endsWith(suffix)) {
            const identifier = decodeURIComponent(path.slice("/api/v1/".length, -suffix.length));
            let limit = 200;
            try {
              const u = new URL(req.url ?? "/", "http://localhost");
              const parsed = Number.parseInt(u.searchParams.get("limit") ?? "", 10);
              if (Number.isFinite(parsed) && parsed > 0) {
                limit = Math.min(parsed, 500);
              }
            } catch {
              // fall back to default limit
            }
            const activity = this.lookupActivity(identifier, limit);
            if (activity === null) {
              this.sendError(res, 404, "activity_not_available", "Activity store not available");
              return;
            }
            if (activity.issueNotFound) {
              this.sendError(res, 404, "issue_not_found", `Issue not found: ${identifier}`);
              return;
            }
            this.sendJson(res, 200, { activity: activity.events });
            return;
          }
          const identifier = decodeURIComponent(path.slice("/api/v1/".length));
          const issueDetail = this.lookupIssue(identifier);
          if (issueDetail) {
            this.sendJson(res, 200, issueDetail);
          } else {
            this.sendError(res, 404, "issue_not_found", `Issue not found: ${identifier}`);
          }
          return;
        }
        if (path.startsWith("/api/v1/")) {
          this.sendError(res, 405, "method_not_allowed", "Method not allowed");
          return;
        }
        this.sendError(res, 404, "not_found", `Route not found: ${path}`);
      } catch (e) {
        this.sendError(res, 500, "internal", String(e));
      }
    })();
  }

  private lookupIssue(identifier: string): Record<string, unknown> | null {
    const state = this.opts.state();
    for (const entry of state.running.values()) {
      if (entry.task_identifier === identifier || entry.task.id === identifier) {
        return {
          issue_identifier: entry.task_identifier,
          task_id: entry.task.id,
          status: "running",
          workspace: { path: entry.workspace_path },
          running: {
            session_id: entry.session_id,
            turn_count: entry.turn_count,
            state: entry.task.state,
            agent: entry.agent,
            model: entry.model,
            variant: entry.variant,
            started_at: toIso(entry.started_at),
            last_event: entry.last_event,
            last_message: entry.last_message,
            last_event_at: toIso(entry.last_event_at),
            tokens: {
              input_tokens: entry.input_tokens,
              output_tokens: entry.output_tokens,
              total_tokens: entry.total_tokens,
            },
          },
          retry: null,
          last_error: null,
        };
      }
    }
    for (const retry of state.retry_attempts.values()) {
      if (retry.identifier === identifier || retry.task_id === identifier) {
        return {
          issue_identifier: retry.identifier,
          task_id: retry.task_id,
          status: "retrying",
          workspace: { path: null },
          running: null,
          retry: {
            attempt: retry.attempt,
            due_at: toIso(retry.due_at_ms),
            error: retry.error,
          },
          last_error: retry.error,
        };
      }
    }
    return null;
  }

  private lookupActivity(
    identifier: string,
    limit: number,
  ): { events: unknown[]; issueNotFound: false } | { issueNotFound: true } | null {
    const store = this.opts.activityStore;
    if (!store) return null;
    const state = this.opts.state();
    let taskId: string | null = null;
    for (const entry of state.running.values()) {
      if (entry.task_identifier === identifier || entry.task.id === identifier) {
        taskId = entry.task.id;
        break;
      }
    }
    if (taskId === null) {
      for (const retry of state.retry_attempts.values()) {
        if (retry.identifier === identifier || retry.task_id === identifier) {
          taskId = retry.task_id;
          break;
        }
      }
    }
    if (taskId === null) {
      const direct = this.opts.directSessions?.().find((d) => d.id === identifier);
      if (direct) {
        return { events: store.recent(direct.id, limit), issueNotFound: false };
      }
    }
    if (taskId === null) return { issueNotFound: true };
    return { events: store.recent(taskId, limit), issueNotFound: false };
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><title>Tasking Dashboard</title></head>
<body>
<h1>Tasking</h1>
<p>Runtime state: see <a href="/api/v1/state">/api/v1/state</a></p>
</body>
</html>`;
  }
}

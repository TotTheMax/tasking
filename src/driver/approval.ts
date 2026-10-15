import type { PendingPermission, PermissionDecision } from "./session-ops.js";

export type ApprovalState = "pending" | "replied" | "expired" | "cancelled" | "external";

export interface ApprovalRequest {
  requestID: string;
  sessionId: string;
  action: string;
  resources: string[];
  save?: string[];
}

export type ReplyOutcome = "replied" | "already" | "unknown" | "failed";

export interface ApprovalCoordinatorDeps {
  replyPermission: (
    sessionId: string,
    requestID: string,
    decision: PermissionDecision,
  ) => Promise<void>;
  onCardRequested?: (request: ApprovalRequest) => void;
  onCardResolved?: (requestID: string, state: ApprovalState, decision?: PermissionDecision) => void;
}

interface ApprovalEntry {
  request: ApprovalRequest;
  state: ApprovalState;
  decision?: PermissionDecision;
}

export class ApprovalCoordinator {
  private readonly entries = new Map<string, ApprovalEntry>();
  private readonly deps: ApprovalCoordinatorDeps;

  constructor(deps: ApprovalCoordinatorDeps) {
    this.deps = deps;
  }

  ingest(sessionId: string, pending: PendingPermission[]): void {
    const seen = new Set<string>();
    for (const p of pending) {
      seen.add(p.id);
      if (this.entries.has(p.id)) continue;
      const entry: ApprovalEntry = {
        request: {
          requestID: p.id,
          sessionId,
          action: p.action,
          resources: p.resources,
          ...(p.save ? { save: p.save } : {}),
        },
        state: "pending",
      };
      this.entries.set(p.id, entry);
      this.deps.onCardRequested?.(entry.request);
    }
    for (const [id, entry] of this.entries) {
      if (entry.state !== "pending") continue;
      if (entry.request.sessionId !== sessionId) continue;
      if (!seen.has(id)) {
        entry.state = "external";
        this.deps.onCardResolved?.(id, "external", undefined);
      }
    }
  }

  state(requestID: string): ApprovalState | undefined {
    return this.entries.get(requestID)?.state;
  }

  async reply(requestID: string, decision: PermissionDecision): Promise<ReplyOutcome> {
    const entry = this.entries.get(requestID);
    if (entry === undefined) return "unknown";
    if (entry.state !== "pending") return "already";
    try {
      await this.deps.replyPermission(entry.request.sessionId, requestID, decision);
    } catch {
      return "failed";
    }
    entry.state = "replied";
    entry.decision = decision;
    this.deps.onCardResolved?.(requestID, "replied", decision);
    return "replied";
  }

  markExpired(requestID: string): void {
    const entry = this.entries.get(requestID);
    if (entry === undefined || entry.state !== "pending") return;
    entry.state = "expired";
    this.deps.onCardResolved?.(requestID, "expired", undefined);
  }

  cancelAll(sessionId: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.state !== "pending") continue;
      if (entry.request.sessionId !== sessionId) continue;
      entry.state = "cancelled";
      this.deps.onCardResolved?.(id, "cancelled", undefined);
    }
  }
}

import { ApiError, type ApiExecFn, execApi } from "./api-client.js";
import {
  type PendingPermission,
  type PermissionDecision,
  type SessionMessage,
  type SessionOpBase,
  createSession,
  getSession,
  interruptSession,
  listPendingPermissions,
  listSessionMessages,
  promptSession,
  replyPermission,
} from "./session-ops.js";

export interface TurnDriverEvent {
  type: string;
  text?: string;
  tool?: string;
  title?: string;
  error?: string;
  input?: Record<string, unknown>;
  output?: string;
  exit?: number;
  truncated?: boolean;
  durationMs?: number;
  status?: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
}

export interface TurnUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export function mapContentEntry(entry: Record<string, unknown>): TurnDriverEvent[] {
  const type = entry.type;
  if (type === "text" && typeof entry.text === "string") {
    return [{ type: "text", text: entry.text }];
  }
  if (type === "reasoning" && typeof entry.text === "string") {
    return [{ type: "reasoning", text: entry.text }];
  }
  if (type === "tool") {
    const evt: TurnDriverEvent = { type: "tool_use" };
    const toolName =
      typeof entry.name === "string"
        ? entry.name
        : typeof entry.tool === "string"
          ? entry.tool
          : null;
    if (toolName !== null) evt.tool = toolName;
    const state = entry.state as Record<string, unknown> | undefined;
    if (state) {
      if (typeof state.status === "string") evt.status = state.status;
      if (state.input !== undefined && typeof state.input === "object") {
        evt.input = state.input as Record<string, unknown>;
      }
      if (typeof state.output === "string") evt.output = state.output;
      const metadata = state.metadata as Record<string, unknown> | undefined;
      if (metadata) {
        if (typeof metadata.exit === "number") evt.exit = metadata.exit;
        if (typeof metadata.truncated === "boolean") evt.truncated = metadata.truncated;
      }
      const time = state.time as Record<string, unknown> | undefined;
      if (time && typeof time.created === "number" && typeof time.completed === "number") {
        evt.durationMs = Math.max(0, time.completed - time.created);
      }
    }
    return [evt];
  }
  return [];
}

export function messageTokensUsage(message: SessionMessage): {
  usage: TurnUsage;
  hasTokens: boolean;
} {
  const t = message.tokens;
  if (!t)
    return { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, hasTokens: false };
  const total = t.input + t.output + t.reasoning;
  return {
    usage: { input_tokens: t.input, output_tokens: t.output, total_tokens: total },
    hasTokens: true,
  };
}

function messageSettled(message: SessionMessage): boolean {
  const time = message.time as Record<string, unknown> | undefined;
  return typeof time?.completed === "number";
}

export function diffMessagesToEvents(
  messages: SessionMessage[],
  seen: Map<string, string>,
): { events: TurnDriverEvent[]; usage: TurnUsage; lastActivityAt: number | null } {
  const events: TurnDriverEvent[] = [];
  const usage: TurnUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let lastActivityAt: number | null = null;
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    if (!messageSettled(message)) continue;
    const fingerprint = JSON.stringify(message.content ?? []);
    if (seen.get(message.id) === fingerprint) continue;
    seen.set(message.id, fingerprint);
    const time = message.time as Record<string, number>;
    if (typeof time.completed === "number") lastActivityAt = time.completed;
    for (const entry of message.content ?? []) {
      events.push(...mapContentEntry(entry));
    }
    const { usage: msgUsage, hasTokens } = messageTokensUsage(message);
    if (hasTokens) {
      usage.input_tokens += msgUsage.input_tokens;
      usage.output_tokens += msgUsage.output_tokens;
      usage.total_tokens += msgUsage.total_tokens;
      events.push({ type: "step_usage", usage: msgUsage });
    }
  }
  return { events, usage, lastActivityAt };
}

export interface TurnDriverOptions {
  exec: ApiExecFn;
  base: SessionOpBase;
  directory: string;
  prompt: string;
  sessionId: string | null;
  createOptions: {
    model?: string | null;
    variant?: string | null;
    agent?: string | null;
    autoApprove: boolean;
    title?: string | null;
  };
  pollIntervalMs: number;
  permissionTimeoutMs: number;
  turnTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  interruptGraceMs?: number;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  onEvent?: (evt: TurnDriverEvent) => void;
  onPendingPermissions?: (pending: PendingPermission[]) => void | Promise<void>;
  onPermissionReply?: (requestID: string, decision: PermissionDecision) => void;
  onWaitingForApproval?: (waiting: boolean) => void;
  signal?: AbortSignal;
}

export interface TurnResult {
  status: "succeeded" | "failed" | "interrupted" | "timed_out" | "error";
  sessionId: string;
  usage: TurnUsage;
  error: string | null;
}

export async function runTurn(opts: TurnDriverOptions): Promise<TurnResult> {
  const usage: TurnUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const emit = (evt: TurnDriverEvent): void => {
    opts.onEvent?.(evt);
  };

  let sessionId = opts.sessionId;
  try {
    if (sessionId === null) {
      const session = await createSession(opts.exec, {
        command: opts.base.command,
        serverUrl: opts.base.serverUrl,
        directory: opts.directory,
        model: opts.createOptions.model,
        variant: opts.createOptions.variant,
        agent: opts.createOptions.agent,
        autoApprove: opts.createOptions.autoApprove,
        title: opts.createOptions.title,
      });
      sessionId = session.id;
    }
    await promptSession(opts.exec, opts.base, sessionId, opts.prompt);
  } catch (e) {
    return {
      status: "error",
      sessionId: sessionId ?? "",
      usage,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const seen = new Map<string, string>();
  const now = opts.now ?? Date.now;
  const startAt = now();
  let waitAccumMs = 0;
  let waitStartedAt: number | null = null;
  let lastActivityAt = startAt;
  let pendingSince: number | null = null;
  let waitingNotified = false;

  const settleTimeout = async (
    reason: "turn_timeout" | "inactivity_timeout",
  ): Promise<TurnResult> => {
    try {
      await interruptSession(opts.exec, opts.base, sessionId);
    } catch {
      void 0;
    }
    const grace = opts.interruptGraceMs ?? 10000;
    const graceUntil = now() + grace;
    while (now() < graceUntil) {
      await opts.sleep(opts.pollIntervalMs);
      try {
        const session = await getSession(opts.exec, opts.base, sessionId);
        if (session.outcome !== null) break;
      } catch {
        void 0;
      }
    }
    return { status: "timed_out", sessionId, usage, error: reason };
  };

  for (;;) {
    if (opts.signal?.aborted) {
      return settleTimeout("turn_timeout").then((r) => ({
        ...r,
        status: "interrupted" as const,
        error: "aborted",
      }));
    }
    await opts.sleep(opts.pollIntervalMs);

    let outcome: string | null = null;
    try {
      const session = await getSession(opts.exec, opts.base, sessionId);
      outcome = session.outcome;
      let pending: PendingPermission[] = [];
      try {
        pending = await listPendingPermissions(opts.exec, opts.base, sessionId);
      } catch {
        void 0;
      }
      const nowTs = now();
      if (pending.length > 0) {
        if (!waitingNotified) {
          waitingNotified = true;
          opts.onWaitingForApproval?.(true);
        }
        if (waitStartedAt === null) waitStartedAt = nowTs;
        if (pendingSince === null) pendingSince = nowTs;
        await opts.onPendingPermissions?.(pending);
        if (opts.permissionTimeoutMs > 0 && nowTs - pendingSince >= opts.permissionTimeoutMs) {
          for (const p of pending) {
            try {
              await replyPermission(opts.exec, opts.base, sessionId, p.id, "reject");
              opts.onPermissionReply?.(p.id, "reject");
            } catch {
              void 0;
            }
          }
          pendingSince = nowTs;
        }
      } else {
        if (waitStartedAt !== null) {
          waitAccumMs += nowTs - waitStartedAt;
          waitStartedAt = null;
        }
        pendingSince = null;
        if (waitingNotified) {
          waitingNotified = false;
          opts.onWaitingForApproval?.(false);
        }
      }
      const messages = await listSessionMessages(opts.exec, opts.base, sessionId);
      const diff = diffMessagesToEvents(messages, seen);
      if (diff.events.length > 0 || pending.length > 0) {
        lastActivityAt = nowTs;
      }
      for (const evt of diff.events) emit(evt);
      usage.input_tokens += diff.usage.input_tokens;
      usage.output_tokens += diff.usage.output_tokens;
      usage.total_tokens += diff.usage.total_tokens;
    } catch (e) {
      void e;
    }

    if (outcome === "succeeded") {
      return { status: "succeeded", sessionId, usage, error: null };
    }
    if (outcome === "failed") {
      return { status: "failed", sessionId, usage, error: "turn failed" };
    }
    if (outcome === "interrupted") {
      return { status: "interrupted", sessionId, usage, error: "interrupted" };
    }

    const nowTs = now();
    const waiting = waitStartedAt !== null;
    if (!waiting && opts.turnTimeoutMs !== undefined && opts.turnTimeoutMs > 0) {
      const executionMs = nowTs - startAt - waitAccumMs;
      if (executionMs >= opts.turnTimeoutMs) {
        return settleTimeout("turn_timeout");
      }
    }
    if (
      !waiting &&
      opts.inactivityTimeoutMs !== undefined &&
      opts.inactivityTimeoutMs > 0 &&
      nowTs - lastActivityAt >= opts.inactivityTimeoutMs
    ) {
      return settleTimeout("inactivity_timeout");
    }
  }
}

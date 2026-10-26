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

export function messageContextTokens(message: SessionMessage): number {
  const t = message.tokens;
  if (!t) return 0;
  return t.input + t.output + t.reasoning + t.cache.read + t.cache.write;
}

const REJECT_QUIESCENT_POLLS = 15;
const MESSAGE_REFETCH_POLLS = 15;

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
      if (typeof state.output === "string") {
        evt.output = state.output;
      } else if (Array.isArray(state.content)) {
        const text = state.content
          .filter(
            (c): c is { type: string; text: string } =>
              typeof c === "object" &&
              c !== null &&
              (c as { type?: unknown }).type === "text" &&
              typeof (c as { text?: unknown }).text === "string",
          )
          .map((c) => c.text)
          .join("");
        if (text !== "") evt.output = text;
      }
      const metadata = state.metadata as Record<string, unknown> | undefined;
      if (metadata) {
        if (typeof metadata.exit === "number") evt.exit = metadata.exit;
        if (typeof metadata.truncated === "boolean") evt.truncated = metadata.truncated;
      }
      const time = (entry.time ?? state.time) as Record<string, unknown> | undefined;
      if (time && typeof time.completed === "number") {
        const startedAt = typeof time.ran === "number" ? time.ran : time.created;
        if (typeof startedAt === "number") {
          evt.durationMs = Math.max(0, time.completed - startedAt);
        }
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

export function turnErrorMessage(messages: SessionMessage[]): string | null {
  for (const message of messages) {
    const err = message.error as Record<string, unknown> | undefined;
    if (err === undefined || typeof err.message !== "string" || err.message === "") continue;
    const type = typeof err.type === "string" && err.type !== "" ? err.type : null;
    return type === null ? err.message : `${type}: ${err.message}`;
  }
  return null;
}

export function freshIdleOutcome(
  messages: SessionMessage[],
  baselineIds: Set<string> | null,
): string | null {
  if (baselineIds === null) return null;
  for (const message of messages) {
    if (message.type !== "idle") continue;
    if (baselineIds.has(message.id)) continue;
    const outcome = message.outcome;
    return typeof outcome === "string" && outcome !== "" ? outcome : null;
  }
  return null;
}

export function promptAnchoredSignals(
  messages: SessionMessage[],
  promptMessageID: string,
): {
  sawOurPrompt: boolean;
  streaming: boolean;
  idleOutcome: string | null;
  hasAssistant: boolean;
} {
  const ourIdx = messages.findIndex((m) => m.id === promptMessageID);
  if (ourIdx === -1) {
    return { sawOurPrompt: false, streaming: true, idleOutcome: null, hasAssistant: false };
  }
  let streaming = false;
  let idleOutcome: string | null = null;
  let hasAssistant = false;
  for (let i = 0; i < ourIdx; i++) {
    const m = messages[i] as SessionMessage;
    if (m.type === "idle" && idleOutcome === null) {
      const outcome = m.outcome;
      idleOutcome = typeof outcome === "string" && outcome !== "" ? outcome : null;
      continue;
    }
    if (m.type === "assistant") {
      hasAssistant = true;
      if (typeof (m.time as { completed?: unknown } | undefined)?.completed !== "number") {
        streaming = true;
      }
    }
  }
  return { sawOurPrompt: true, streaming, idleOutcome, hasAssistant };
}

export function hasUnsettledAssistant(
  messages: SessionMessage[],
  baselineIds: Set<string> | null,
): boolean {
  if (baselineIds === null) return false;
  return messages.some(
    (m) =>
      m.type === "assistant" &&
      !baselineIds.has(m.id) &&
      typeof (m.time as { completed?: unknown } | undefined)?.completed !== "number",
  );
}

function messageSettled(message: SessionMessage): boolean {
  const time = message.time as Record<string, unknown> | undefined;
  return typeof time?.completed === "number";
}

function messageSortKey(message: SessionMessage): number {
  const time = message.time as Record<string, unknown> | undefined;
  const completed = typeof time?.completed === "number" ? time.completed : 0;
  const created = typeof time?.created === "number" ? time.created : 0;
  return completed || created;
}

interface SeenMessage {
  keys: string[];
  tokensCounted: boolean;
}

function parseSeen(raw: string | undefined): SeenMessage {
  if (raw === undefined) return { keys: [], tokensCounted: false };
  try {
    const parsed = JSON.parse(raw) as { k?: unknown; t?: unknown };
    const keys = Array.isArray(parsed.k)
      ? parsed.k.filter((k): k is string => typeof k === "string")
      : [];
    return { keys, tokensCounted: parsed.t === 1 };
  } catch {
    return { keys: [], tokensCounted: false };
  }
}

function entryKey(entry: Record<string, unknown>, index: number): string {
  const id = typeof entry.id === "string" ? entry.id : null;
  const prefix = id ?? `i${index}`;
  return `${prefix}:${JSON.stringify(entry)}`;
}

export function diffMessagesToEvents(
  messages: SessionMessage[],
  seen: Map<string, string>,
): {
  events: TurnDriverEvent[];
  usage: TurnUsage;
  lastActivityAt: number | null;
  contextTokens: number;
} {
  const events: TurnDriverEvent[] = [];
  const usage: TurnUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let lastActivityAt: number | null = null;
  let contextTokens = 0;
  const ordered = [...messages].sort((a, b) => messageSortKey(a) - messageSortKey(b));
  for (const message of ordered) {
    if (message.type !== "assistant") continue;
    if (!messageSettled(message)) continue;
    const prev = parseSeen(seen.get(message.id));
    const emitted = new Set(prev.keys);
    let added = 0;
    let index = 0;
    for (const entry of message.content ?? []) {
      const key = entryKey(entry, index);
      index++;
      if (emitted.has(key)) continue;
      emitted.add(key);
      added++;
      events.push(...mapContentEntry(entry));
    }
    let tokensCounted = prev.tokensCounted;
    if (!tokensCounted) {
      const { usage: msgUsage, hasTokens } = messageTokensUsage(message);
      if (hasTokens) {
        usage.input_tokens += msgUsage.input_tokens;
        usage.output_tokens += msgUsage.output_tokens;
        usage.total_tokens += msgUsage.total_tokens;
        events.push({ type: "step_usage", usage: msgUsage });
        tokensCounted = true;
      }
    }
    contextTokens = Math.max(contextTokens, messageContextTokens(message));
    if (added > 0) {
      const time = message.time as Record<string, number>;
      if (typeof time.completed === "number") lastActivityAt = time.completed;
    }
    if (added > 0 || tokensCounted !== prev.tokensCounted) {
      seen.set(message.id, JSON.stringify({ k: [...emitted], t: tokensCounted ? 1 : 0 }));
    }
  }
  return { events, usage, lastActivityAt, contextTokens };
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
  onSessionCreated?: (sessionId: string) => void;
  seenMessages?: Map<string, string>;
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
  contextTokens?: number;
}

export async function runTurn(opts: TurnDriverOptions): Promise<TurnResult> {
  const usage: TurnUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const emit = (evt: TurnDriverEvent): void => {
    opts.onEvent?.(evt);
  };

  let sessionId = opts.sessionId;
  let staleOutcome: string | null = null;
  let baselineIds: Set<string> | null = null;
  let previousIds: Set<string> | null = null;
  let promptMessageID: string | null = null;
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
      opts.onSessionCreated?.(sessionId);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        staleOutcome = (await getSession(opts.exec, opts.base, sessionId)).outcome;
        baselineIds = new Set(
          (await listSessionMessages(opts.exec, opts.base, sessionId)).map((m) => m.id),
        );
        previousIds = new Set(baselineIds);
        break;
      } catch {
        staleOutcome = null;
        baselineIds = null;
        previousIds = null;
      }
    }
    promptMessageID = await promptSession(opts.exec, opts.base, sessionId, opts.prompt);
  } catch (e) {
    return {
      status: "error",
      sessionId: sessionId ?? "",
      usage,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const seen = opts.seenMessages ?? new Map<string, string>();
  const now = opts.now ?? Date.now;
  const startAt = now();
  let waitAccumMs = 0;
  let waitStartedAt: number | null = null;
  let lastActivityAt = startAt;
  let contextTokens = 0;
  let lastSessionUpdated: number | null = null;
  let quiescentPolls = 0;
  let rejectedAt: number | null = null;
  let lastFetchUpdated: number | null | undefined = undefined;
  let lastFetchPendingCount = -1;
  let pollsSinceFetch = 0;
  let pendingSince: number | null = null;
  let waitingNotified = false;
  let latestMessages: SessionMessage[] = [];

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
    return { status: "timed_out", sessionId, usage, error: reason, contextTokens };
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
    let progressed = false;
    let pendingKnown = false;
    try {
      const session = await getSession(opts.exec, opts.base, sessionId);
      outcome = session.outcome;
      let pending: PendingPermission[] = [];
      try {
        pending = await listPendingPermissions(opts.exec, opts.base, sessionId);
        pendingKnown = true;
      } catch {
        void 0;
      }
      const nowTs = now();
      if (session.updatedAt !== null && session.updatedAt !== lastSessionUpdated) {
        lastSessionUpdated = session.updatedAt ?? null;
        lastActivityAt = nowTs;
        progressed = true;
      }
      if (pendingKnown) {
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
            rejectedAt = nowTs;
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
      }
      const pendingCountForGate = pendingKnown ? pending.length : lastFetchPendingCount;
      const shouldFetchMessages =
        lastFetchUpdated === undefined ||
        session.updatedAt !== lastFetchUpdated ||
        pendingCountForGate !== lastFetchPendingCount ||
        pollsSinceFetch >= MESSAGE_REFETCH_POLLS;
      if (shouldFetchMessages) {
        const messages = await listSessionMessages(opts.exec, opts.base, sessionId);
        latestMessages = messages;
        lastFetchUpdated = session.updatedAt ?? null;
        lastFetchPendingCount = pending.length;
        pollsSinceFetch = 0;
        const diff = diffMessagesToEvents(messages, seen);
        if (diff.events.length > 0 || pending.length > 0) {
          lastActivityAt = nowTs;
          progressed = true;
        }
        if (previousIds !== null) {
          for (const m of messages) {
            if (!previousIds.has(m.id)) {
              progressed = true;
              break;
            }
          }
          previousIds = new Set(messages.map((m) => m.id));
        }
        for (const evt of diff.events) emit(evt);
        usage.input_tokens += diff.usage.input_tokens;
        usage.output_tokens += diff.usage.output_tokens;
        usage.total_tokens += diff.usage.total_tokens;
        contextTokens = Math.max(contextTokens, diff.contextTokens);
      } else {
        pollsSinceFetch += 1;
      }
      quiescentPolls = progressed ? 0 : quiescentPolls + 1;
    } catch (e) {
      void e;
    }

    const anchored =
      promptMessageID === null ? null : promptAnchoredSignals(latestMessages, promptMessageID);
    const idleOutcome = anchored
      ? anchored.idleOutcome
      : freshIdleOutcome(latestMessages, baselineIds);
    const streaming = anchored
      ? anchored.streaming
      : hasUnsettledAssistant(latestMessages, baselineIds);
    const registered = anchored === null || anchored.sawOurPrompt;
    const produced = anchored === null || anchored.hasAssistant;
    let terminal: string | null = idleOutcome;
    if (terminal === null && outcome !== null && baselineIds !== null && outcome !== staleOutcome) {
      terminal = outcome;
    }
    if (terminal === null && rejectedAt !== null && quiescentPolls >= REJECT_QUIESCENT_POLLS) {
      terminal = "failed";
    }
    if (registered && produced && !streaming && terminal === "succeeded") {
      return { status: "succeeded", sessionId, usage, error: null, contextTokens };
    }
    if (registered && produced && !streaming && terminal === "failed") {
      const fallback =
        outcome === "failed" ? "turn failed" : "permission auto-rejected; turn did not continue";
      return {
        status: "failed",
        sessionId,
        usage,
        error: turnErrorMessage(latestMessages) ?? fallback,
        contextTokens,
      };
    }
    if (registered && produced && !streaming && terminal === "interrupted") {
      return { status: "interrupted", sessionId, usage, error: "interrupted", contextTokens };
    }
    const nowTs = now();
    const waiting = waitStartedAt !== null;
    const turnStarted = anchored === null || anchored.sawOurPrompt || promptMessageID === null;
    if (!waiting && opts.turnTimeoutMs !== undefined && opts.turnTimeoutMs > 0) {
      const executionMs = nowTs - startAt - waitAccumMs;
      if (executionMs >= opts.turnTimeoutMs) {
        return settleTimeout("turn_timeout");
      }
    }
    if (
      !waiting &&
      turnStarted &&
      opts.inactivityTimeoutMs !== undefined &&
      opts.inactivityTimeoutMs > 0 &&
      nowTs - lastActivityAt >= opts.inactivityTimeoutMs
    ) {
      return settleTimeout("inactivity_timeout");
    }
  }
}

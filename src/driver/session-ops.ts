import { TaskingError } from "../shared/errors.js";
import { type ApiExecFn, execApi } from "./api-client.js";

export interface SessionOpBase {
  command: string;
  serverUrl?: string | null;
}

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "ask" | "deny";
}

export const ALLOW_ALL_RULES: PermissionRule[] = [{ action: "*", resource: "*", effect: "allow" }];

export interface CreateSessionOptions extends SessionOpBase {
  directory: string;
  model?: string | null;
  variant?: string | null;
  agent?: string | null;
  autoApprove: boolean;
  title?: string | null;
}

export interface SessionTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface SessionInfo {
  id: string;
  outcome: string | null;
  tokens?: SessionTokens;
  updatedAt?: number | null;
}

export interface PendingPermission {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  source?: { type?: string; messageID?: string; id?: string };
}

export type PermissionDecision = "once" | "always" | "reject";

function parseModelRef(
  model?: string | null,
  variant?: string | null,
): { id: string; providerID?: string; variant?: string } | undefined {
  if (!model) return undefined;
  const sep = model.indexOf("/");
  if (sep === -1) return { id: model, ...(variant ? { variant } : {}) };
  const providerID = model.slice(0, sep);
  const id = model.slice(sep + 1);
  return { id, providerID, ...(variant ? { variant } : {}) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

export async function createSession(
  exec: ApiExecFn,
  opts: CreateSessionOptions,
): Promise<SessionInfo> {
  const data: Record<string, unknown> = {
    location: { directory: opts.directory },
  };
  const modelRef = parseModelRef(opts.model, opts.variant);
  if (modelRef) data.model = modelRef;
  if (opts.agent) data.agent = opts.agent;
  if (opts.title) data.title = opts.title;
  if (opts.autoApprove) {
    data.permissions = ALLOW_ALL_RULES;
  }
  const res = await execApi(
    {
      command: opts.command,
      serverUrl: opts.serverUrl,
      operation: "session.create",
      data,
    },
    exec,
  );
  const payload = asRecord(res?.data);
  const tokens = payload.tokens as SessionTokens | undefined;
  return {
    id: String(payload.id ?? ""),
    outcome: (payload.outcome as string | null) ?? null,
    ...(tokens ? { tokens } : {}),
  };
}

const PROMPT_MAX_CHARS = 120_000;

export async function promptSession(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
  text: string,
): Promise<string | null> {
  if (text.length > PROMPT_MAX_CHARS) {
    throw new TaskingError(
      "prompt_too_large",
      `prompt is ${text.length} chars (max ${PROMPT_MAX_CHARS}); refusing to pass oversized --data on argv`,
      { length: text.length },
    );
  }
  const res = await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.prompt",
      params: { sessionID },
      data: { text },
    },
    exec,
  );
  const payload = asRecord(res?.data);
  const id = payload.id;
  return typeof id === "string" && id !== "" ? id : null;
}

export async function getSession(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
): Promise<SessionInfo> {
  const res = await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.get",
      params: { sessionID },
    },
    exec,
  );
  const payload = asRecord(res?.data);
  const tokens = payload.tokens as SessionTokens | undefined;
  const time = payload.time as Record<string, unknown> | undefined;
  const updatedAt = typeof time?.updated === "number" ? time.updated : null;
  return {
    id: String(payload.id ?? sessionID),
    outcome: (payload.outcome as string | null) ?? null,
    ...(tokens ? { tokens } : {}),
    updatedAt,
  };
}

export async function listPendingPermissions(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
): Promise<PendingPermission[]> {
  const res = await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.permission.list",
      params: { sessionID },
    },
    exec,
  );
  const list = (res?.data as PendingPermission[] | undefined) ?? [];
  return list;
}

export async function replyPermission(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
  requestID: string,
  decision: PermissionDecision,
): Promise<void> {
  await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.permission.reply",
      params: { sessionID, requestID },
      data: { decision },
    },
    exec,
  );
}

export async function interruptSession(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
): Promise<{ interrupted: boolean }> {
  const res = await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.interrupt",
      params: { sessionID },
      timeoutMs: 30000,
    },
    exec,
  );
  return { interrupted: res?.interrupted === true };
}

export async function deleteSession(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
): Promise<void> {
  await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.remove",
      params: { sessionID },
    },
    exec,
  );
}

export interface SessionMessage {
  id: string;
  type: string;
  content?: Array<Record<string, unknown>>;
  tokens?: SessionTokens;
  [key: string]: unknown;
}

export async function listSessionMessages(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
): Promise<SessionMessage[]> {
  const res = await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.message.list",
      params: { sessionID },
    },
    exec,
  );
  return (res?.data as SessionMessage[] | undefined) ?? [];
}

export async function setSessionPermissions(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
  rules: PermissionRule[] | null,
): Promise<void> {
  await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.update",
      params: { sessionID },
      data: { permissions: rules ?? [] },
    },
    exec,
  );
}

export async function switchSessionAgent(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
  agent: string,
): Promise<void> {
  await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.switchAgent",
      params: { sessionID },
      data: { agent },
    },
    exec,
  );
}

export async function switchSessionModel(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
  model: string | null | undefined,
  variant?: string | null,
): Promise<boolean> {
  const ref = parseModelRef(model, variant);
  if (!ref || !ref.providerID) return false;
  await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.switchModel",
      params: { sessionID },
      data: { model: ref },
    },
    exec,
  );
  return true;
}

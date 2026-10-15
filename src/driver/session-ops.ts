import { execApi, type ApiExecFn } from "./api-client.js";

export interface SessionOpBase {
  command: string;
  serverUrl?: string | null;
}

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "ask" | "deny";
}

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
    data.permissions = [{ action: "*", resource: "*", effect: "allow" }];
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

export async function promptSession(
  exec: ApiExecFn,
  base: SessionOpBase,
  sessionID: string,
  text: string,
): Promise<void> {
  await execApi(
    {
      command: base.command,
      serverUrl: base.serverUrl,
      operation: "session.prompt",
      params: { sessionID },
      data: { text },
    },
    exec,
  );
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
  return {
    id: String(payload.id ?? sessionID),
    outcome: (payload.outcome as string | null) ?? null,
    ...(tokens ? { tokens } : {}),
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
      data: { permissions: rules },
    },
    exec,
  );
}

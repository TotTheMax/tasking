import type { ApiExecFn } from "../driver/api-client.js";
import {
  type PendingPermission,
  createSession,
  setSessionPermissions,
} from "../driver/session-ops.js";
import { type TurnDriverEvent, type TurnResult, runTurn } from "../driver/turn-driver.js";

export interface DirectTurnRequest {
  command: string;
  serverUrl: string | null;
  directory: string;
  prompt: string;
  sessionId: string | null;
  autoApprove: boolean;
  postureOpen: boolean;
  agent: string | null;
  model: string | null;
  variant: string | null;
  pollIntervalMs: number;
  permissionTimeoutMs: number;
  turnTimeoutMs: number;
  inactivityTimeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  onEvent?: (evt: TurnDriverEvent) => void;
  onPendingPermissions?: (pending: PendingPermission[]) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface DirectTurnOutcome extends TurnResult {
  postureOpened: boolean;
}

export type DirectTurnDriver = (request: DirectTurnRequest) => Promise<DirectTurnOutcome>;

const ALLOW_ALL = [{ action: "*", resource: "*", effect: "allow" as const }];

export function createDefaultTurnDriver(exec: ApiExecFn): DirectTurnDriver {
  return async (request) => {
    let sessionId = request.sessionId;
    let postureOpen = request.postureOpen;
    const base = { command: request.command, serverUrl: request.serverUrl };
    if (sessionId === null) {
      const session = await createSession(exec, {
        ...base,
        directory: request.directory,
        model: request.model,
        variant: request.variant,
        agent: request.agent,
        autoApprove: request.autoApprove,
      });
      sessionId = session.id;
      postureOpen = request.autoApprove;
    } else if (request.autoApprove && !postureOpen) {
      await setSessionPermissions(exec, base, sessionId, ALLOW_ALL);
      postureOpen = true;
    } else if (!request.autoApprove && postureOpen) {
      await setSessionPermissions(exec, base, sessionId, null);
      postureOpen = false;
    }
    const result = await runTurn({
      exec,
      base,
      directory: request.directory,
      prompt: request.prompt,
      sessionId,
      createOptions: {
        model: request.model,
        variant: request.variant,
        agent: request.agent,
        autoApprove: request.autoApprove,
      },
      pollIntervalMs: request.pollIntervalMs,
      permissionTimeoutMs: request.permissionTimeoutMs,
      turnTimeoutMs: request.turnTimeoutMs,
      inactivityTimeoutMs: request.inactivityTimeoutMs,
      sleep: request.sleep,
      onEvent: request.onEvent,
      onPendingPermissions: request.onPendingPermissions,
      signal: request.signal,
    });
    return { ...result, postureOpened: postureOpen };
  };
}

export { ALLOW_ALL };

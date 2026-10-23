import type { ApiExecFn } from "../driver/api-client.js";

import {
  ALLOW_ALL_RULES,
  type PendingPermission,
  createSession,
  setSessionPermissions,
  switchSessionAgent,
  switchSessionModel,
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
  switchAgent?: boolean;
  switchModel?: boolean;
  pollIntervalMs: number;
  permissionTimeoutMs: number;
  turnTimeoutMs: number;
  inactivityTimeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  onEvent?: (evt: TurnDriverEvent) => void;
  seenMessages?: Map<string, string>;
  onPendingPermissions?: (pending: PendingPermission[]) => void | Promise<void>;
  onPermissionReply?: (requestID: string, decision: "once" | "always" | "reject") => void;
  onWaitingForApproval?: (waiting: boolean) => void;
  signal?: AbortSignal;
}

export interface DirectTurnOutcome extends TurnResult {
  postureOpened: boolean;
  agentSwitched?: boolean;
  modelSwitched?: boolean;
}

export type DirectTurnDriver = (request: DirectTurnRequest) => Promise<DirectTurnOutcome>;

export function createDefaultTurnDriver(exec: ApiExecFn): DirectTurnDriver {
  return async (request) => {
    let sessionId = request.sessionId;
    let postureOpen = request.postureOpen;
    let agentSwitched = false;
    let modelSwitched = false;
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
      agentSwitched = true;
    } else {
      if (request.switchAgent && request.agent) {
        try {
          await switchSessionAgent(exec, base, sessionId, request.agent);
          agentSwitched = true;
        } catch {
          void 0;
        }
      }
      if (request.switchModel && request.model) {
        try {
          modelSwitched = await switchSessionModel(
            exec,
            base,
            sessionId,
            request.model,
            request.variant,
          );
        } catch {
          void 0;
        }
      }
      if (request.autoApprove && !postureOpen) {
        await setSessionPermissions(exec, base, sessionId, ALLOW_ALL_RULES);
        postureOpen = true;
      } else if (!request.autoApprove && postureOpen) {
        await setSessionPermissions(exec, base, sessionId, null);
        postureOpen = false;
      }
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
      seenMessages: request.seenMessages,
      onPendingPermissions: request.onPendingPermissions,
      onPermissionReply: request.onPermissionReply,
      onWaitingForApproval: request.onWaitingForApproval,
      signal: request.signal,
    });
    return { ...result, postureOpened: postureOpen, agentSwitched, modelSwitched };
  };
}

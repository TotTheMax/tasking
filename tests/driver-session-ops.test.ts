import { describe, expect, it } from "vitest";
import {
  type ApiExecFn,
  type ApiExecResult,
  createSession,
  deleteSession,
  getSession,
  interruptSession,
  listPendingPermissions,
  listSessionMessages,
  promptSession,
  replyPermission,
  setSessionPermissions,
  switchSessionAgent,
  switchSessionModel,
} from "../src/driver/session-ops.js";
import {
  assistantMessage,
  interruptResponse,
  messageListResponse,
  permission,
  permissionListResponse,
  sessionCreateResponse,
  sessionGetResponse,
  userMessage,
} from "./helpers/opencode-fixtures.js";

interface Captured {
  args: string[][];
  results: ApiExecResult[];
}

function recorder(responses: string[]): { exec: ApiExecFn; captured: Captured } {
  const captured: Captured = { args: [], results: [] };
  let i = 0;
  const exec: ApiExecFn = async (args) => {
    captured.args.push(args);
    const stdout = responses[i] ?? "{}";
    i += 1;
    const res = { exitCode: 0, stdout, stderr: "", timedOut: false };
    captured.results.push(res);
    return res;
  };
  return { exec, captured };
}

const base = { command: "opencode" };

describe("createSession", () => {
  it("sends location, model ref, agent and permissive ruleset", async () => {
    const { exec, captured } = recorder(['{"data":{"id":"ses_1","location":{"directory":"/w"}}}']);
    const session = await createSession(exec, {
      ...base,
      directory: "/w",
      model: "zhipuai-coding-plan/glm-5.3",
      variant: "high",
      agent: "build",
      autoApprove: true,
      title: "TAS-1",
    });
    expect(session.id).toBe("ses_1");
    const dataIdx = captured.args[0]?.indexOf("--data") ?? -1;
    const body = JSON.parse(captured.args[0]?.[dataIdx + 1] ?? "{}");
    expect(captured.args[0]?.slice(0, 3)).toEqual(["opencode", "api", "session.create"]);
    expect(body.location).toEqual({ directory: "/w" });
    expect(body.model).toEqual({
      id: "glm-5.3",
      providerID: "zhipuai-coding-plan",
      variant: "high",
    });
    expect(body.agent).toBe("build");
    expect(body.title).toBe("TAS-1");
    expect(body.permissions).toEqual([{ action: "*", resource: "*", effect: "allow" }]);
  });

  it("omits model, ruleset and optional fields when unset", async () => {
    const { exec, captured } = recorder([sessionCreateResponse({ id: "ses_2" })]);
    await createSession(exec, { ...base, directory: "/w", autoApprove: false });
    const dataIdx = captured.args[0]?.indexOf("--data") ?? -1;
    const body = JSON.parse(captured.args[0]?.[dataIdx + 1] ?? "{}");
    expect(body.location).toEqual({ directory: "/w" });
    expect(body.model).toBeUndefined();
    expect(body.agent).toBeUndefined();
    expect(body.permissions).toBeUndefined();
    expect(body.title).toBeUndefined();
  });

  it("supports server_url passthrough", async () => {
    const { exec, captured } = recorder([sessionCreateResponse({ id: "ses_3" })]);
    await createSession(exec, {
      ...base,
      serverUrl: "http://127.0.0.1:48123",
      directory: "/w",
      autoApprove: false,
    });
    expect(captured.args[0]).toContain("--server");
    expect(captured.args[0]).toContain("http://127.0.0.1:48123");
  });
});

describe("session operations", () => {
  it("prompt carries sessionID path param and text body", async () => {
    const { exec, captured } = recorder(['{"data":{"id":"msg_1"}}']);
    await promptSession(exec, base, "ses_1", "do the thing");
    const args = captured.args[0] ?? [];
    expect(args[2]).toBe("session.prompt");
    expect(args).toContain("sessionID=ses_1");
    expect(args[args.indexOf("--data") + 1]).toBe('{"text":"do the thing"}');
  });

  it("get returns outcome and tokens", async () => {
    const { exec } = recorder([
      sessionGetResponse({
        id: "ses_1",
        outcome: "succeeded",
        tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 0 } },
      }),
    ]);
    const s = await getSession(exec, base, "ses_1");
    expect(s.outcome).toBe("succeeded");
    expect(s.tokens).toEqual({ input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 0 } });
  });

  it("pending permissions parse per_ ids and save suggestions", async () => {
    const { exec } = recorder([
      permissionListResponse([
        permission({ id: "per_1", sessionID: "ses_1", resources: ["echo x"], save: ["echo *"] }),
      ]),
    ]);
    const pending = await listPendingPermissions(exec, base, "ses_1");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe("per_1");
    expect(pending[0]?.save).toEqual(["echo *"]);
  });

  it("reply passes both path params and decision enum", async () => {
    const { exec, captured } = recorder([""]);
    await replyPermission(exec, base, "ses_1", "per_1", "once");
    const args = captured.args[0] ?? [];
    expect(args[2]).toBe("session.permission.reply");
    expect(args).toContain("sessionID=ses_1");
    expect(args).toContain("requestID=per_1");
    expect(args[args.indexOf("--data") + 1]).toBe('{"decision":"once"}');
  });

  it("interrupt reports interrupted flag", async () => {
    const { exec, captured } = recorder([interruptResponse()]);
    const res = await interruptSession(exec, base, "ses_1");
    expect(res.interrupted).toBe(true);
    expect(captured.args[0]?.[2]).toBe("session.interrupt");
  });

  it("delete calls session.remove with path param", async () => {
    const { exec, captured } = recorder([""]);
    await deleteSession(exec, base, "ses_1");
    const args = captured.args[0] ?? [];
    expect(args[2]).toBe("session.remove");
    expect(args).toContain("sessionID=ses_1");
  });

  it("setSessionPermissions sends ruleset for loosen", async () => {
    const { exec, captured } = recorder([""]);
    await setSessionPermissions(exec, base, "ses_1", [
      { action: "*", resource: "*", effect: "allow" },
    ]);
    const args = captured.args[0] ?? [];
    expect(args[2]).toBe("session.update");
    expect(args[args.indexOf("--data") + 1]).toBe(
      '{"permissions":[{"action":"*","resource":"*","effect":"allow"}]}',
    );
  });

  it("setSessionPermissions(null) clears posture with an empty ruleset", async () => {
    const { exec, captured } = recorder([""]);
    await setSessionPermissions(exec, base, "ses_1", null);
    const args = captured.args[0] ?? [];
    expect(args[args.indexOf("--data") + 1]).toBe('{"permissions":[]}');
  });

  it("switchSessionAgent posts the agent to the session agent path", async () => {
    const { exec, captured } = recorder([""]);
    await switchSessionAgent(exec, base, "ses_1", "review");
    const args = captured.args[0] ?? [];
    expect(args[2]).toBe("session.switchAgent");
    expect(args).toContain("sessionID=ses_1");
    expect(args[args.indexOf("--data") + 1]).toBe('{"agent":"review"}');
  });

  it("switchSessionModel posts a full Model.Ref and reports success", async () => {
    const { exec, captured } = recorder([""]);
    const ok = await switchSessionModel(exec, base, "ses_1", "zhipuai/glm-5", "high");
    expect(ok).toBe(true);
    const args = captured.args[0] ?? [];
    expect(args[2]).toBe("session.switchModel");
    expect(args).toContain("sessionID=ses_1");
    expect(args[args.indexOf("--data") + 1]).toBe(
      '{"model":{"id":"glm-5","providerID":"zhipuai","variant":"high"}}',
    );
  });

  it("switchSessionModel is a no-op without a provider segment", async () => {
    const { exec, captured } = recorder([""]);
    const ok = await switchSessionModel(exec, base, "ses_1", "glm-5", null);
    expect(ok).toBe(false);
    expect(captured.args).toHaveLength(0);
  });

  it("listSessionMessages returns assistant messages with content arrays", async () => {
    const { exec, captured } = recorder([
      messageListResponse([
        assistantMessage({ id: "msg_1", content: [{ type: "text", text: "hi" }] }),
        userMessage({ id: "msg_0" }),
      ]),
    ]);
    const messages = await listSessionMessages(exec, base, "ses_1");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe("msg_1");
    expect(captured.args[0]?.[2]).toBe("session.message.list");
  });
});

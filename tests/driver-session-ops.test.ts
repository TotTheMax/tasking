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
} from "../src/driver/session-ops.js";

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
    const { exec, captured } = recorder(['{"data":{"id":"ses_2"}}']);
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
    const { exec, captured } = recorder(['{"data":{"id":"ses_3"}}']);
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
      '{"data":{"id":"ses_1","outcome":"succeeded","tokens":{"input":10,"output":2,"reasoning":1,"cache":{"read":5,"write":0}}}}',
    ]);
    const s = await getSession(exec, base, "ses_1");
    expect(s.outcome).toBe("succeeded");
    expect(s.tokens).toEqual({ input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 0 } });
  });

  it("pending permissions parse per_ ids and save suggestions", async () => {
    const { exec } = recorder([
      '{"data":[{"id":"per_1","sessionID":"ses_1","action":"shell","resources":["echo x"],"save":["echo *"],"source":{"type":"tool","messageID":"msg_1","id":"call_1"}}]}',
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
    const { exec, captured } = recorder(['{"interrupted":true}']);
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

  it("setSessionPermissions(null) clears posture", async () => {
    const { exec, captured } = recorder([""]);
    await setSessionPermissions(exec, base, "ses_1", null);
    const args = captured.args[0] ?? [];
    expect(args[args.indexOf("--data") + 1]).toBe('{"permissions":null}');
  });

  it("listSessionMessages returns assistant messages with content arrays", async () => {
    const { exec, captured } = recorder([
      '{"data":[{"id":"msg_1","type":"assistant","content":[{"type":"text","text":"hi"}]},{"id":"msg_0","type":"user"}]}',
    ]);
    const messages = await listSessionMessages(exec, base, "ses_1");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe("msg_1");
    expect(captured.args[0]?.[2]).toBe("session.message.list");
  });
});

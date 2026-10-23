import { describe, expect, it } from "vitest";
import { createDefaultTurnDriver } from "../src/direct/driver.js";
import type { ApiExecFn, ApiExecResult } from "../src/driver/api-client.js";
import {
  assistantMessage,
  idleMessage,
  messageListResponse,
  permissionListResponse,
  sessionCreateResponse,
  sessionGetResponse,
  userMessage,
} from "./helpers/opencode-fixtures.js";

interface Recorder {
  exec: ApiExecFn;
  ops: string[];
  bodyFor(op: string): Record<string, unknown> | null;
}

function recorder(): Recorder {
  const ops: string[] = [];
  const bodies = new Map<string, Record<string, unknown>>();
  const exec: ApiExecFn = async (args) => {
    const op = args[2] ?? "";
    ops.push(op);
    const dataIdx = args.indexOf("--data");
    if (dataIdx !== -1 && typeof args[dataIdx + 1] === "string") {
      bodies.set(op, JSON.parse(args[dataIdx + 1] as string) as Record<string, unknown>);
    }
    let stdout = "{}";
    if (op === "session.create") stdout = sessionCreateResponse({ id: "ses_new" });
    else if (op === "session.prompt") stdout = '{"data":{"id":"msg_user_1"}}';
    else if (op === "session.get")
      stdout = sessionGetResponse({ id: "ses_x", outcome: "succeeded" });
    else if (op === "session.permission.list") stdout = permissionListResponse([]);
    else if (op === "session.message.list")
      stdout = messageListResponse([
        idleMessage({ id: "idle_1", outcome: "succeeded" }),
        assistantMessage({
          id: "msg_1",
          content: [{ type: "text", text: "ok" }],
          time: { created: 1, streamed: 1, completed: 2 },
        }) as never,
        userMessage({ id: "msg_user_1" }),
      ]);
    return { exitCode: 0, stdout, stderr: "", timedOut: false } as ApiExecResult;
  };
  return {
    exec,
    ops,
    bodyFor: (op) => bodies.get(op) ?? null,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    command: "opencode",
    serverUrl: null,
    directory: "/w",
    prompt: "hi",
    sessionId: "ses_x",
    autoApprove: false,
    postureOpen: false,
    agent: "build",
    model: null as string | null,
    variant: null as string | null,
    pollIntervalMs: 1,
    permissionTimeoutMs: 60000,
    turnTimeoutMs: 60000,
    inactivityTimeoutMs: 60000,
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

describe("direct turn driver / agent + model switching", () => {
  it("switches agent and model on a continuation turn when asked", async () => {
    const rec = recorder();
    const driver = createDefaultTurnDriver(rec.exec);
    const result = await driver(
      request({ switchAgent: true, switchModel: true, agent: "review", model: "zhipuai/glm-5" }),
    );
    expect(rec.ops).not.toContain("session.create");
    expect(rec.ops).toContain("session.switchAgent");
    expect(rec.ops).toContain("session.switchModel");
    expect(rec.bodyFor("session.switchAgent")).toEqual({ agent: "review" });
    expect(rec.bodyFor("session.switchModel")).toEqual({
      model: { id: "glm-5", providerID: "zhipuai" },
    });
    expect(result.agentSwitched).toBe(true);
    expect(result.modelSwitched).toBe(true);
  });

  it("does not switch when the caller reports no change", async () => {
    const rec = recorder();
    const driver = createDefaultTurnDriver(rec.exec);
    await driver(request({ switchAgent: false, switchModel: false, agent: "build" }));
    expect(rec.ops).not.toContain("session.switchAgent");
    expect(rec.ops).not.toContain("session.switchModel");
  });

  it("skips session.switchModel when the model has no provider segment", async () => {
    const rec = recorder();
    const driver = createDefaultTurnDriver(rec.exec);
    const result = await driver(request({ switchModel: true, model: "glm-5" }));
    expect(rec.ops).not.toContain("session.switchModel");
    expect(result.modelSwitched).toBe(false);
  });

  it("creates the session with agent/model on the first turn and never switches", async () => {
    const rec = recorder();
    const driver = createDefaultTurnDriver(rec.exec);
    await driver(
      request({
        sessionId: null,
        switchAgent: true,
        switchModel: true,
        agent: "review",
        model: "zhipuai/glm-5",
      }),
    );
    expect(rec.ops).toContain("session.create");
    expect(rec.ops).not.toContain("session.switchAgent");
    expect(rec.ops).not.toContain("session.switchModel");
    expect(rec.bodyFor("session.create")?.agent).toBe("review");
    expect(rec.bodyFor("session.create")?.model).toEqual({
      id: "glm-5",
      providerID: "zhipuai",
    });
  });

  it("applies permission posture via session.update on continuation", async () => {
    const allow = recorder();
    await createDefaultTurnDriver(allow.exec)(request({ autoApprove: true, postureOpen: false }));
    expect(allow.ops).toContain("session.update");
    expect(allow.bodyFor("session.update")).toEqual({
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    });

    const clear = recorder();
    await createDefaultTurnDriver(clear.exec)(request({ autoApprove: false, postureOpen: true }));
    expect(clear.bodyFor("session.update")).toEqual({ permissions: [] });
  });
});

import { describe, expect, it } from "vitest";
import {
  buildApiArgs,
  execApi,
  type ApiExecResult,
  type ApiExecFn,
} from "../src/driver/api-client.js";

describe("buildApiArgs", () => {
  it("assembles base command with operation", () => {
    expect(buildApiArgs({ command: "opencode", operation: "session.create" })).toEqual([
      "opencode",
      "api",
      "session.create",
    ]);
  });

  it("splits multi-token commands", () => {
    expect(
      buildApiArgs({ command: "/usr/local/bin/opencode", operation: "server.info" }),
    ).toEqual(["/usr/local/bin/opencode", "api", "server.info"]);
  });

  it("places --server before the operation", () => {
    const args = buildApiArgs({
      command: "opencode",
      operation: "session.get",
      serverUrl: "http://127.0.0.1:48123",
      params: { sessionID: "ses_1" },
    });
    expect(args).toEqual([
      "opencode",
      "api",
      "--server",
      "http://127.0.0.1:48123",
      "session.get",
      "--param",
      "sessionID=ses_1",
    ]);
  });

  it("serializes params as key=value pairs", () => {
    const args = buildApiArgs({
      command: "opencode",
      operation: "session.permission.reply",
      params: { sessionID: "ses_1", requestID: "per_2" },
    });
    expect(args.slice(-4)).toEqual([
      "--param",
      "sessionID=ses_1",
      "--param",
      "requestID=per_2",
    ]);
  });

  it("serializes data body as JSON", () => {
    const args = buildApiArgs({
      command: "opencode",
      operation: "session.prompt",
      data: { text: "hi" },
    });
    const i = args.indexOf("--data");
    expect(args[i + 1]).toBe('{"text":"hi"}');
  });

  it("omits empty params and data", () => {
    expect(buildApiArgs({ command: "opencode", operation: "server.info" })).toHaveLength(3);
  });
});

describe("execApi", () => {
  const okExec: ApiExecFn = async (args) =>
    ({
      exitCode: 0,
      stdout: '{"data":{"id":"ses_1"}}',
      stderr: "",
      timedOut: false,
    }) as ApiExecResult;

  it("parses JSON stdout into result", async () => {
    const res = await execApi({ command: "opencode", operation: "session.create" }, okExec);
    expect(res).toEqual({ data: { id: "ses_1" } });
  });

  it("returns null body for empty stdout", async () => {
    const res = await execApi(
      { command: "opencode", operation: "session.remove" },
      async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    );
    expect(res).toBeNull();
  });

  it("throws with stderr detail on non-zero exit", async () => {
    await expect(
      execApi(
        { command: "opencode", operation: "session.get" },
        async () => ({
          exitCode: 1,
          stdout: "",
          stderr: "boom",
          timedOut: false,
        }),
      ),
    ).rejects.toThrow(/boom/);
  });

  it("throws a recognizable error on timeout", async () => {
    await expect(
      execApi(
        { command: "opencode", operation: "session.get" },
        async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
      ),
    ).rejects.toThrow(/timed out/i);
  });

  it("throws when stdout is not JSON on success exit", async () => {
    await expect(
      execApi(
        { command: "opencode", operation: "server.info" },
        async () => ({ exitCode: 0, stdout: "not json", stderr: "", timedOut: false }),
      ),
    ).rejects.toThrow();
  });
});

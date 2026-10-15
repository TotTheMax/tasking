import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiExecFn, ApiExecResult } from "../src/driver/api-client.js";
import {
  collectWorkspaceSessionIds,
  sweepActiveSessions,
} from "../src/driver/sweep.js";
import { writeSessionSidecar } from "../src/workspace/manager.js";
import { ConsoleLogger } from "../src/observability/logger.js";

const logger = new ConsoleLogger({}, () => {});

function responder(
  routes: Record<string, string | Error>,
): { exec: ApiExecFn; calls: string[] } {
  const calls: string[] = [];
  const exec: ApiExecFn = async (args) => {
    const op = args[2] ?? "";
    calls.push(op);
    const route = routes[op];
    if (route === undefined) {
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false } as ApiExecResult;
    }
    if (route instanceof Error) {
      return { exitCode: 1, stdout: "", stderr: route.message, timedOut: false } as ApiExecResult;
    }
    return { exitCode: 0, stdout: route, stderr: "", timedOut: false } as ApiExecResult;
  };
  return { exec, calls };
}

describe("sweepActiveSessions", () => {
  it("interrupts known sessions that are still active", async () => {
    const { exec, calls } = responder({
      "session.active": '{"data":{"sessionIDs":["ses_1","ses_2"]}}',
      "session.interrupt": '{"interrupted":true}',
    });
    const res = await sweepActiveSessions({
      exec,
      base: { command: "opencode" },
      sessionIds: ["ses_1", "ses_3"],
      logger,
    });
    expect(res.interrupted).toEqual(["ses_1"]);
    expect(res.untouched).toEqual(["ses_3"]);
    expect(calls).toContain("session.interrupt");
  });

  it("parses array-of-objects active shapes", async () => {
    const { exec } = responder({
      "session.active": '{"data":[{"id":"ses_a"},{"id":"ses_b"}]}',
      "session.interrupt": '{"interrupted":true}',
    });
    const res = await sweepActiveSessions({
      exec,
      base: { command: "opencode" },
      sessionIds: ["ses_a"],
      logger,
    });
    expect(res.interrupted).toEqual(["ses_a"]);
  });

  it("is non-blocking when the active list call fails", async () => {
    const { exec } = responder({
      "session.active": new Error("service down"),
    });
    const res = await sweepActiveSessions({
      exec,
      base: { command: "opencode" },
      sessionIds: ["ses_1"],
      logger,
    });
    expect(res.interrupted).toEqual([]);
    expect(res.untouched).toEqual([]);
  });

  it("continues when one interrupt fails", async () => {
    let interruptCount = 0;
    const calls: string[] = [];
    const exec: ApiExecFn = async (args) => {
      const op = args[2] ?? "";
      calls.push(op);
      if (op === "session.active") {
        return {
          exitCode: 0,
          stdout: '{"data":{"sessionIDs":["ses_1","ses_2"]}}',
          stderr: "",
          timedOut: false,
        };
      }
      if (op === "session.interrupt") {
        interruptCount += 1;
        if (interruptCount === 1) {
          return { exitCode: 1, stdout: "", stderr: "boom", timedOut: false };
        }
        return { exitCode: 0, stdout: '{"interrupted":true}', stderr: "", timedOut: false };
      }
      return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
    };
    const res = await sweepActiveSessions({
      exec,
      base: { command: "opencode" },
      sessionIds: ["ses_1", "ses_2"],
      logger,
    });
    expect(res.interrupted).toEqual(["ses_2"]);
    expect(res.failed).toEqual(["ses_1"]);
    expect(calls.filter((c) => c === "session.interrupt")).toHaveLength(2);
  });

  it("skips the sweep entirely when no known session ids", async () => {
    const { exec, calls } = responder({});
    const res = await sweepActiveSessions({
      exec,
      base: { command: "opencode" },
      sessionIds: [],
      logger,
    });
    expect(res.interrupted).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("collectWorkspaceSessionIds", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("reads sidecars under the workspace root", () => {
    const root = mkdtempSync(join(tmpdir(), "tasking-sweep-"));
    dirs.push(root);
    mkdirSync(join(root, "ENG-1"));
    mkdirSync(join(root, "ENG-2"));
    writeSessionSidecar(join(root, "ENG-1"), "ses_ws1");
    writeSessionSidecar(join(root, "ENG-2"), "ses_ws2");
    writeFileSync(join(root, "unrelated.txt"), "x", "utf8");
    const ids = collectWorkspaceSessionIds(root);
    expect(ids).toContain("ses_ws1");
    expect(ids).toContain("ses_ws2");
    expect(ids).toHaveLength(2);
  });

  it("returns empty for a missing root", () => {
    const missing = join(tmpdir(), `tasking-sweep-none-${Date.now()}`);
    expect(existsSync(missing)).toBe(false);
    expect(collectWorkspaceSessionIds(missing)).toEqual([]);
  });
});

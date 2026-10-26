import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultApiExec } from "../src/driver/api-client.js";
import { createOpencodeMock, mockPathEnv } from "./helpers/opencode-mock.js";

const mocksToClean: string[] = [];
afterAll(() => {
  for (const dir of mocksToClean.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function spawnMock(script: Parameters<typeof createOpencodeMock>[0]) {
  const mock = createOpencodeMock(script);
  mocksToClean.push(mock.binDir);
  const env = { ...process.env, ...mock.env, PATH: mockPathEnv(mock) };
  return { mock, run: (args: string[]) => runArgs(args, env) };
}

function runArgs(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile("opencode", args, { env, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: err ? ((err as { code?: number }).code ?? 1) : 0,
      });
    });
  });
}

describe("opencode CLI mock", () => {
  it("answers --version with the configured version", async () => {
    const { run } = spawnMock({ responses: [], version: "opencode v2.0.29" });
    const res = await run(["--version"]);
    expect(res.stdout.trim()).toBe("opencode v2.0.29");
    expect(res.code).toBe(0);
  });

  it("dispatches scripted api operations round-robin via PATH", async () => {
    const { run, mock } = spawnMock({
      responses: [
        { op: "session.get", stdout: '{"data":{"outcome":null}}' },
        { op: "session.get", stdout: '{"data":{"outcome":"succeeded"}}' },
      ],
    });
    const first = await run(["api", "session.get", "--param", "sessionID=ses_1"]);
    const second = await run(["api", "session.get", "--param", "sessionID=ses_1"]);
    expect(first.stdout).toContain('"outcome":null');
    expect(second.stdout).toContain("succeeded");
    expect(mock.usedCounts()["session.get"] ?? 0).toBe(2);
  });

  it("skips flag values when locating the operation", async () => {
    const { run } = spawnMock({
      responses: [{ op: "server.info", stdout: '{"version":"2.0.29"}' }],
    });
    const res = await run(["api", "--server", "http://x", "server.info"]);
    expect(res.stdout).toContain("2.0.29");
  });

  it("fails with guidance for unscripted operations", async () => {
    const { run } = spawnMock({ responses: [] });
    const res = await run(["api", "session.create", "--data", "{}"]);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("no response");
  });

  it("works end-to-end with defaultApiExec", async () => {
    const { mock } = spawnMock({
      responses: [{ op: "server.info", stdout: '{"version":"2.0.29"}' }],
    });
    const originalPath = process.env.PATH;
    process.env.PATH = mockPathEnv(mock);
    process.env.TASKING_OC_MOCK_RESPONSES = mock.env.TASKING_OC_MOCK_RESPONSES;
    try {
      const exec = defaultApiExec();
      const res = await exec(["opencode", "api", "server.info"], 5000);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("2.0.29");
    } finally {
      process.env.PATH = originalPath;
      delete process.env.TASKING_OC_MOCK_RESPONSES;
    }
  });
});

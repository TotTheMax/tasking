import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/index.js";

vi.mock("../src/shared/opencode-version.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/opencode-version.js")>();
  return { ...actual, probeOpencodeVersion: vi.fn(actual.probeOpencodeVersion) };
});

const { probeOpencodeVersion } = await import("../src/shared/opencode-version.js");
const probeMock = vi.mocked(probeOpencodeVersion);

describe("start opencode version gate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    probeMock.mockReset();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "tasking-gate-"));
    dirs.push(d);
    return d;
  }

  function writeWorkflow(dir: string): string {
    const path = join(dir, "WORKFLOW.md");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "---\ntracker:\n  kind: none\n---\n\n# body\n", "utf8");
    return path;
  }

  it("refuses to start on unsupported major version", async () => {
    const dir = tempDir();
    const wf = writeWorkflow(dir);
    probeMock.mockReturnValue("1.19.0");
    let captured = "";
    const origError = console.error;
    console.error = (data: unknown) => {
      captured += String(data);
    };
    let code: number;
    try {
      code = await main(["node", "tasking", "start", wf]);
    } finally {
      console.error = origError;
    }
    expect(code).toBe(1);
    expect(captured).toContain("opencode upgrade --major");
  });

  it("refuses to start when opencode is missing", async () => {
    const dir = tempDir();
    const wf = writeWorkflow(dir);
    probeMock.mockReturnValue(null);
    let code: number;
    try {
      code = await main(["node", "tasking", "start", wf]);
    } catch {
      code = -1;
    }
    expect(code).not.toBe(0);
  });
});

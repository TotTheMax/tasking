import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowPathError, resolveWorkflowPath } from "../src/cli/workflow-path.js";

describe("resolveWorkflowPath", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "tasking-wfpath-"));
    dirs.push(d);
    return d;
  }

  it("defaults to ./WORKFLOW.md under cwd", () => {
    const dir = tempDir();
    const resolved = resolveWorkflowPath(dir);
    expect(resolved.path).toBe(resolve(dir, "WORKFLOW.md"));
    expect(resolved.dir).toBe(resolve(dir));
    expect(resolved.name).toBe("WORKFLOW.md");
  });

  it("resolves an explicit relative path against cwd", () => {
    const dir = tempDir();
    const resolved = resolveWorkflowPath(dir, "configs/my-flow.md");
    expect(resolved.path).toBe(resolve(dir, "configs/my-flow.md"));
    expect(resolved.dir).toBe(resolve(dir, "configs"));
    expect(resolved.name).toBe("my-flow.md");
  });

  it("keeps an absolute path as-is", () => {
    const dir = tempDir();
    const abs = resolve(dir, "elsewhere", "wf.md");
    const resolved = resolveWorkflowPath("/tmp", abs);
    expect(resolved.path).toBe(abs);
    expect(resolved.name).toBe("wf.md");
  });

  it("does not throw for a non-existent file path", () => {
    const dir = tempDir();
    expect(() => resolveWorkflowPath(dir, "nope/missing.md")).not.toThrow();
  });

  it("throws when the path points at an existing directory", () => {
    const dir = tempDir();
    expect(() => resolveWorkflowPath(dir, dir)).toThrow(WorkflowPathError);
  });
});

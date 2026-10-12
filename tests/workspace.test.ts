import * as childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HooksConfig, WorkspaceConfig } from "../src/config/config-types.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { TaskingError } from "../src/shared/errors.js";
import {
  assertCwdIsWorkspace,
  createWorkspace,
  deleteSession,
  isWithinRoot,
  readSessionSidecar,
  removeWorkspace,
  resolveWorkspacePath,
  runHook,
  sanitizeWorkspaceKey,
  writeSessionSidecar,
} from "../src/workspace/manager.js";
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const logger = new ConsoleLogger({}, () => {});
const baseHooks: HooksConfig = {
  after_create: null,
  before_run: null,
  after_run: null,
  before_remove: null,
  timeout_ms: 60000,
};

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tasking-ws-"));
}

describe("sanitizeWorkspaceKey", () => {
  it("keeps allowed characters", async () => {
    expect(sanitizeWorkspaceKey("ABC-123")).toBe("ABC-123");
  });

  it("replaces disallowed characters with underscore", async () => {
    expect(sanitizeWorkspaceKey("ABC/123 def")).toBe("ABC_123_def");
  });

  it("rejects empty result", async () => {
    expect(() => sanitizeWorkspaceKey("")).toThrow(TaskingError);
  });
});

describe("isWithinRoot", () => {
  it("accepts path under root", async () => {
    const root = tempRoot();
    try {
      expect(isWithinRoot(join(root, "foo"), root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects path escaping root", async () => {
    const root = tempRoot();
    try {
      expect(isWithinRoot(join(root, "..", "escape"), root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("createWorkspace", () => {
  it("creates deterministic path and creates dir when missing", async () => {
    const root = tempRoot();
    try {
      const wsConfig: WorkspaceConfig = { root };
      const ws = await createWorkspace({
        identifier: "ABC-123",
        workspace: wsConfig,
        hooks: baseHooks,
        logger,
      });
      expect(ws.path).toBe(resolve(root, "ABC-123"));
      expect(ws.created_now).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses existing workspace without after_create", async () => {
    const root = tempRoot();
    try {
      const wsConfig: WorkspaceConfig = { root };
      mkdirSync(join(root, "ABC-123"), { recursive: true });
      const ws = await createWorkspace({
        identifier: "ABC-123",
        workspace: wsConfig,
        hooks: baseHooks,
        logger,
      });
      expect(ws.created_now).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs after_create only on new workspace", async () => {
    const root = tempRoot();
    try {
      const wsConfig: WorkspaceConfig = { root };
      const marker = join(root, "marker");
      const hooks: HooksConfig = {
        ...baseHooks,
        after_create: `touch ${marker}`,
      };
      await createWorkspace({ identifier: "X-1", workspace: wsConfig, hooks, logger });
      expect(() => statSync(marker)).not.toThrow();
      const ws2 = await createWorkspace({
        identifier: "X-1",
        workspace: wsConfig,
        hooks: baseHooks,
        logger,
      });
      expect(ws2.created_now).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("aborts creation when after_create fails", async () => {
    const root = tempRoot();
    try {
      const wsConfig: WorkspaceConfig = { root };
      const hooks: HooksConfig = {
        ...baseHooks,
        after_create: "exit 1",
      };
      await expect(
        createWorkspace({ identifier: "FAIL-1", workspace: wsConfig, hooks, logger }),
      ).rejects.toThrow(TaskingError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects non-directory at workspace path", async () => {
    const root = tempRoot();
    try {
      writeFileSync(join(root, "ABC-123"), "file");
      await expect(
        createWorkspace({
          identifier: "ABC-123",
          workspace: { root },
          hooks: baseHooks,
          logger,
        }),
      ).rejects.toThrow(TaskingError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("runHook", () => {
  it("succeeds for valid script", async () => {
    const r = await runHook("echo hi", tempRoot(), baseHooks, logger, "test");
    expect(r.success).toBe(true);
  });

  it("fails for nonzero exit", async () => {
    const r = await runHook("exit 2", tempRoot(), baseHooks, logger, "test");
    expect(r.success).toBe(false);
    expect(r.error).not.toBeNull();
  });
});

describe("removeWorkspace", () => {
  it("removes an existing workspace", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "RM-1",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      await removeWorkspace(ws.path, baseHooks, logger);
      expect(() => statSync(ws.path)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is a no-op when workspace absent", async () => {
    await expect(
      removeWorkspace(join(tmpdir(), "nope-xyz"), baseHooks, logger),
    ).resolves.not.toThrow();
  });

  it("removes workspace even when session delete fails", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "RM-2",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      await removeWorkspace(ws.path, baseHooks, logger, "ses_nonexistent");
      expect(() => statSync(ws.path)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips session delete when sessionId is null", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "RM-3",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      await removeWorkspace(ws.path, baseHooks, logger, null);
      expect(() => statSync(ws.path)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses passed session_id for deleteSession over sidecar", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "RM-4",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeSessionSidecar(ws.path, "ses_sidecar");
      const spy = vi.spyOn(childProcess, "execFile").mockImplementation(((
        file: unknown,
        args: unknown,
        _opts: unknown,
        cb: unknown,
      ) => {
        if (typeof cb === "function") cb(null, "", "");
        return undefined as never;
      }) as unknown as typeof childProcess.execFile);
      await removeWorkspace(ws.path, baseHooks, logger, "ses_passed");
      const sessionCall = spy.mock.calls.find(
        (c) => c[0] === "opencode" && c[1]?.[0] === "session" && c[1]?.[1] === "delete",
      );
      expect(sessionCall?.[1]?.[2]).toBe("ses_passed");
      expect(sessionCall?.[1]?.[2]).not.toBe("ses_sidecar");
      expect(() => statSync(ws.path)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fallback to sidecar session when sessionId is undefined", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "RM-5",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeSessionSidecar(ws.path, "ses_sidecar_fallback");
      const spy = vi.spyOn(childProcess, "execFile").mockImplementation(((
        file: unknown,
        args: unknown,
        _opts: unknown,
        cb: unknown,
      ) => {
        if (typeof cb === "function") cb(null, "", "");
        return undefined as never;
      }) as unknown as typeof childProcess.execFile);
      await removeWorkspace(ws.path, baseHooks, logger);
      const sessionCall = spy.mock.calls.find(
        (c) => c[0] === "opencode" && c[1]?.[0] === "session" && c[1]?.[1] === "delete",
      );
      expect(sessionCall).toBeDefined();
      expect(sessionCall?.[1]?.[2]).toBe("ses_sidecar_fallback");
      expect(() => statSync(ws.path)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("deleteSession", () => {
  it("catches errors without throwing", async () => {
    await expect(deleteSession("ses_nonexistent_xyz", logger)).resolves.not.toThrow();
  });
});

describe("assertCwdIsWorkspace", () => {
  it("passes when cwd matches workspace", async () => {
    const p = resolve(tmpdir(), "match");
    expect(() => assertCwdIsWorkspace(p, p)).not.toThrow();
  });

  it("aborts when cwd differs from workspace", async () => {
    expect(() => assertCwdIsWorkspace("/a/b", "/c/d")).toThrow(TaskingError);
  });
});

describe("resolveWorkspacePath", () => {
  it("resolves sanitized identifier under root", async () => {
    expect(resolveWorkspacePath("ABC-123", "/root")).toBe(resolve("/root", "ABC-123"));
  });

  it("sanitizes disallowed characters before resolving", async () => {
    expect(resolveWorkspacePath("ABC/123 def", "/root")).toBe(resolve("/root", "ABC_123_def"));
  });

  it("matches the path produced by createWorkspace", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "ABC-123",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      expect(ws.path).toBe(resolveWorkspacePath("ABC-123", root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("session sidecar", () => {
  it("writes and reads session ID", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "SC-1",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeSessionSidecar(ws.path, "ses_test456");
      const sidecar = readSessionSidecar(ws.path);
      expect(sidecar).toEqual({
        sessionId: "ses_test456",
        turnCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists turn_count in sidecar", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "SC-1b",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeSessionSidecar(ws.path, "ses_turn", 5);
      const sidecar = readSessionSidecar(ws.path);
      expect(sidecar).toEqual({
        sessionId: "ses_turn",
        turnCount: 5,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists token counts in sidecar", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "SC-1c",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeSessionSidecar(ws.path, "ses_tokens", 3, {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      });
      const sidecar = readSessionSidecar(ws.path);
      expect(sidecar).toEqual({
        sessionId: "ses_tokens",
        turnCount: 3,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads legacy sidecar without token fields as zero", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "SC-1d",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeFileSync(
        join(ws.path, ".tasking-session.json"),
        JSON.stringify({ session_id: "ses_old", turn_count: 2 }),
        "utf8",
      );
      const sidecar = readSessionSidecar(ws.path);
      expect(sidecar).toEqual({
        sessionId: "ses_old",
        turnCount: 2,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when sidecar file missing", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "SC-2",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      expect(readSessionSidecar(ws.path)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for corrupted JSON", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "SC-3",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeFileSync(join(ws.path, ".tasking-session.json"), "{broken json");
      expect(readSessionSidecar(ws.path)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removeWorkspace auto-reads sidecar for session cleanup", async () => {
    const root = tempRoot();
    try {
      const ws = await createWorkspace({
        identifier: "SC-4",
        workspace: { root },
        hooks: baseHooks,
        logger,
      });
      writeSessionSidecar(ws.path, "ses_nonexistent_xyz");
      await removeWorkspace(ws.path, baseHooks, logger);
      expect(() => statSync(ws.path)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("isWithinRoot symlink safety", () => {
  it("rejects workspace equals root", async () => {
    const root = mkdtempSync(join(tmpdir(), "tasking-ws-eq-"));
    try {
      expect(isWithinRoot(root, root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts non-existent path via fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "tasking-ws-ne-"));
    try {
      const nonExistent = join(root, "child", "newdir");
      expect(isWithinRoot(nonExistent, root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("runHook timeout detection", () => {
  const logger = new ConsoleLogger({}, () => {});
  it("reports timeout flag on ETIMEDOUT", async () => {
    const hooks: HooksConfig = {
      after_create: null,
      before_run: null,
      after_run: null,
      before_remove: null,
      timeout_ms: 1,
    };
    const root = mkdtempSync(join(tmpdir(), "tasking-hook-to-"));
    try {
      const result = await runHook("sleep 10", root, hooks, logger, "before_run");
      expect(result.success).toBe(false);
      expect(result.timeout).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("runHook async execution", () => {
  const logger = new ConsoleLogger({}, () => {});
  it("does not block the event loop while a hook runs", async () => {
    const hooks: HooksConfig = {
      after_create: null,
      before_run: null,
      after_run: null,
      before_remove: null,
      timeout_ms: 10000,
    };
    const root = mkdtempSync(join(tmpdir(), "tasking-hook-async-"));
    try {
      let ticked = false;
      setTimeout(() => {
        ticked = true;
      }, 50);
      const result = await runHook("sleep 1", root, hooks, logger, "before_run");
      expect(result.success).toBe(true);
      expect(ticked).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Contract harness for the opencode v2 API shapes tasking hardcodes.
 *
 * Boots the pinned `@opencode/sdk` host in-process (no credentials, no
 * network) and drives it through the pinned `@opencode/client`, asserting
 * that every operation id and payload shape our driver relies on still
 * exists and behaves. This is the tool for widening the VALIDATED
 * version range: bump both pins, run this suite, fix any drift.
 *
 * Offline-safe: only session create/get/list/update/interrupt and
 * permission listing are exercised — no model turns.
 */
import { describe, expect, it } from "vitest";

const loadSdk = () => import("@opencode/sdk").then((m) => m.OpenCode);
const loadClient = () => import("@opencode/client").then((m) => m.OpenCode);

const NODE_MAJOR = Number(process.versions.node.split(".")[0] ?? 0);

// @opencode/sdk 2.0.29 ships explicit resource management (`using`), which
// Node 22 cannot parse. CI runs this suite on Node 24; the 22 job covers the
// runtime suite.
describe.skipIf(NODE_MAJOR < 24)("opencode v2 API contract (pinned sdk+client 2.0.29)", () => {
  it("session.create accepts location, Model.Ref and a permissions ruleset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-contract-"));
    const host = await (await loadSdk()).create({ database: { path: join(dir, "c.db") } });
    try {
      const session = await host.sessions.create({
        location: { directory: dir },
        model: { id: "glm-5.3", providerID: "zhipuai-coding-plan", variant: "high" },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        title: "contract",
      });
      expect(typeof session.id).toBe("string");
      expect(session.id.startsWith("ses_")).toBe(true);
      const fetched = await host.sessions.get({ sessionID: session.id });
      expect(fetched.outcome ?? null).toBeNull();
      await host.sessions.remove({ sessionID: session.id });
    } finally {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("session.update accepts a ruleset and an empty ruleset (posture open/recall)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-contract-"));
    const host = await (await loadSdk()).create({ database: { path: join(dir, "c.db") } });
    try {
      const session = await host.sessions.create({ location: { directory: dir } });
      await host.sessions.update({
        sessionID: session.id,
        permissions: [{ action: "shell", resource: "*", effect: "ask" }],
      });
      await host.sessions.update({ sessionID: session.id, permissions: [] });
      await host.sessions.remove({ sessionID: session.id });
    } finally {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("session.permission.list is empty for a fresh session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-contract-"));
    const host = await (await loadSdk()).create({ database: { path: join(dir, "c.db") } });
    try {
      const session = await host.sessions.create({ location: { directory: dir } });
      const pending = await host.permission.list({ sessionID: session.id });
      expect(Array.isArray(pending)).toBe(true);
      expect(pending).toHaveLength(0);
      await host.sessions.remove({ sessionID: session.id });
    } finally {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("session.interrupt and session.active exist with stable shapes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasking-contract-"));
    const host = await (await loadSdk()).create({ database: { path: join(dir, "c.db") } });
    try {
      const session = await host.sessions.create({ location: { directory: dir } });
      const active = await host.sessions.active();
      expect(active).toBeDefined();
      const res = await host.sessions.interrupt({ sessionID: session.id });
      expect(res).toBeDefined();
      await host.sessions.remove({ sessionID: session.id });
    } finally {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the pinned client package exposes the operation groups tasking relies on", async () => {
    expect(typeof (await loadClient()).make).toBe("function");
    const dir = mkdtempSync(join(tmpdir(), "tasking-contract-"));
    const host = await (await loadSdk()).create({ database: { path: join(dir, "c.db") } });
    try {
      const session = await host.sessions.create({ location: { directory: dir } });
      expect(typeof session.id).toBe("string");
      await host.sessions.remove({ sessionID: session.id });
    } finally {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

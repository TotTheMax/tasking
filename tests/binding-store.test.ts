import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BindingStore } from "../src/bridge/binding-store.js";
import { TaskingError } from "../src/shared/errors.js";

let dbPath: string;
let store: BindingStore;

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), "tasking-bind-")), "bindings.db");
  store = new BindingStore(dbPath);
});

afterEach(() => {
  store.close();
});

describe("BindingStore", () => {
  it("creates the parent directory when the db path is nested in a missing dir", () => {
    const root = mkdtempSync(join(tmpdir(), "tasking-bind-mkdir-"));
    const nested = join(root, "tasking_workspaces", "nested", "bindings.db");
    const store2 = new BindingStore(nested);
    store2.upsertBinding({
      issue_id: "1",
      issue_key: "T-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    expect(store2.getBinding("1")?.issue_key).toBe("T-1");
    store2.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("upsert then get returns active binding with null cursors", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    const b = store.getBinding("10001");
    expect(b?.issue_key).toBe("ENG-1");
    expect(b?.chat_id).toBe("oc_c");
    expect(b?.root_id).toBe("om_r");
    expect(b?.thread_id).toBeNull();
    expect(b?.status).toBe("active");
    expect(b?.last_jira_comment_id).toBeNull();
    expect(b?.last_feishu_msg_id).toBeNull();
  });

  it("stores and clears the state-card message id per binding", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    expect(store.getBinding("10001")?.card_message_id).toBeNull();
    store.setBindingCardId("10001", "om_state_card");
    expect(store.getBinding("10001")?.card_message_id).toBe("om_state_card");
    store.setBindingCardId("10001", null);
    expect(store.getBinding("10001")?.card_message_id).toBeNull();
  });

  it("upsert persists thread_id at row creation", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
      thread_id: "om_t1",
    });
    expect(store.getBinding("10001")?.thread_id).toBe("om_t1");
  });

  it("upsert heals thread_id on an existing row without touching other fields", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    store.advanceJiraCursor("10001", "10009");
    store.advanceFeishuCursor("10001", "1700000005");
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
      thread_id: "om_t1",
    });
    const b = store.getBinding("10001");
    expect(b?.thread_id).toBe("om_t1");
    expect(b?.last_jira_comment_id).toBe("10009");
    expect(b?.last_feishu_msg_id).toBe("1700000005");
    expect(b?.root_id).toBe("om_r");
    expect(b?.chat_id).toBe("oc_c");
    expect(b?.status).toBe("active");
  });

  it("upsert with null thread_id does not wipe an existing value", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
      thread_id: "om_t1",
    });
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    expect(store.getBinding("10001")?.thread_id).toBe("om_t1");
  });

  it("upsert with same thread_id leaves cursors and terminal status intact", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
      thread_id: "om_t1",
    });
    store.advanceJiraCursor("10001", "10009");
    store.markTerminal("10001");
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
      thread_id: "om_t1",
    });
    const b = store.getBinding("10001");
    expect(b?.thread_id).toBe("om_t1");
    expect(b?.last_jira_comment_id).toBe("10009");
    expect(b?.status).toBe("terminal");
  });

  it("upsert heals thread_id on a terminal row without reviving it", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    store.markTerminal("10001");
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
      thread_id: "om_t2",
    });
    const b = store.getBinding("10001");
    expect(b?.thread_id).toBe("om_t2");
    expect(b?.status).toBe("terminal");
  });

  it("upsert is idempotent and preserves cursors/status", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    store.advanceJiraCursor("10001", "10005");
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    expect(store.getBinding("10001")?.last_jira_comment_id).toBe("10005");
  });

  it("advanceJiraCursor and advanceFeishuCursor update cursors", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    store.advanceJiraCursor("10001", "10009");
    store.advanceFeishuCursor("10001", "1700000005");
    const b = store.getBinding("10001");
    expect(b?.last_jira_comment_id).toBe("10009");
    expect(b?.last_feishu_msg_id).toBe("1700000005");
  });

  it("advanceJiraCursor throws when binding missing", () => {
    expect(() => store.advanceJiraCursor("NOPE", "1")).toThrow(TaskingError);
  });

  it("markTerminal excludes from listActive; markActive re-includes", () => {
    store.upsertBinding({
      issue_id: "10001",
      issue_key: "ENG-1",
      chat_id: "oc_c",
      root_id: "om_r",
    });
    store.upsertBinding({
      issue_id: "10002",
      issue_key: "ENG-2",
      chat_id: "oc_c",
      root_id: "om_r2",
    });
    store.markTerminal("10001");
    expect(store.listActive().map((b) => b.issue_key)).toEqual(["ENG-2"]);
    store.markActive("10001");
    expect(
      store
        .listActive()
        .map((b) => b.issue_key)
        .sort(),
    ).toEqual(["ENG-1", "ENG-2"]);
  });

  it("getBinding returns null when missing", () => {
    expect(store.getBinding("NOPE")).toBeNull();
  });

  it("getMeta/setMeta persist key/value", () => {
    expect(store.getMeta("intake_cursor")).toBeNull();
    store.setMeta("intake_cursor", "1700000005");
    expect(store.getMeta("intake_cursor")).toBe("1700000005");
    store.setMeta("intake_cursor", "1700000010");
    expect(store.getMeta("intake_cursor")).toBe("1700000010");
  });

  it("deleteMeta removes a key, tolerates missing keys, keeps others", () => {
    store.setMeta("intake_cursor", "1700000005");
    store.setMeta("other", "keep");
    store.deleteMeta("intake_cursor");
    expect(store.getMeta("intake_cursor")).toBeNull();
    expect(store.getMeta("other")).toBe("keep");
    expect(() => store.deleteMeta("intake_cursor")).not.toThrow();
  });

  it("markIntakeSeen appends an id and isIntakeSeen reports it back", () => {
    expect(store.isIntakeSeen("om_a")).toBe(false);
    store.markIntakeSeen("om_a");
    expect(store.isIntakeSeen("om_a")).toBe(true);
    expect(store.isIntakeSeen("om_b")).toBe(false);
    store.markIntakeSeen("om_a");
    expect(store.isIntakeSeen("om_a")).toBe(true);
    expect(store.getMeta("intake_seen_ids")).toBe(JSON.stringify(["om_a"]));
  });

  it("intake seen ids are capped at the 50 most recent", () => {
    for (let i = 0; i < 51; i++) {
      store.markIntakeSeen(`om_${i}`);
    }
    expect(store.isIntakeSeen("om_0")).toBe(false);
    for (let i = 1; i <= 50; i++) {
      expect(store.isIntakeSeen(`om_${i}`)).toBe(true);
    }
  });
});

describe("DirectSessionStore (direct_sessions table)", () => {
  it("persists a direct session mapping and reads it back by root_id", () => {
    store.upsertDirectSession({
      root_id: "om_root1",
      chat_id: "oc_c",
      project: "tasking",
      path: "/repos/tasking",
      session_id: null,
      status: "running",
    });
    const s = store.getDirectSession("om_root1");
    expect(s?.project).toBe("tasking");
    expect(s?.path).toBe("/repos/tasking");
    expect(s?.session_id).toBeNull();
    expect(s?.status).toBe("running");
    expect(s?.last_msg_id).toBeNull();
  });

  it("updates session_id and status without duplicating rows", () => {
    store.upsertDirectSession({
      root_id: "om_r",
      chat_id: "oc_c",
      project: null,
      path: "/repos/x",
      session_id: null,
      status: "running",
    });
    store.updateDirectSession("om_r", { session_id: "ses_1", status: "idle" });
    const s = store.getDirectSession("om_r");
    expect(s?.session_id).toBe("ses_1");
    expect(s?.status).toBe("idle");
    expect(store.listDirectSessionsByStatus("idle")).toHaveLength(1);
    expect(store.listDirectSessionsByStatus("running")).toHaveLength(0);
  });

  it("advances the per-session message cursor monotonically and tracks seen ids per second", () => {
    store.upsertDirectSession({
      root_id: "om_r",
      chat_id: "oc_c",
      project: null,
      path: "/repos/x",
      session_id: null,
      status: "idle",
    });
    store.advanceDirectCursor("om_r", "om_a", "100");
    store.advanceDirectCursor("om_r", "om_old", "50");
    expect(store.getDirectSession("om_r")?.last_msg_id).toBe("100");
    store.advanceDirectCursor("om_r", "om_b", "100");
    expect(store.getDirectSession("om_r")?.seen_ids).toEqual(["om_a", "om_b"]);
    store.advanceDirectCursor("om_r", "om_c", "200");
    expect(store.getDirectSession("om_r")?.last_msg_id).toBe("200");
    expect(store.getDirectSession("om_r")?.seen_ids).toEqual(["om_c"]);
  });

  it("marks status transitions for lifecycle and recovery", () => {
    store.upsertDirectSession({
      root_id: "om_a",
      chat_id: "oc_c",
      project: null,
      path: "/a",
      session_id: "ses_a",
      status: "running",
    });
    store.upsertDirectSession({
      root_id: "om_b",
      chat_id: "oc_c",
      project: null,
      path: "/b",
      session_id: "ses_b",
      status: "idle",
    });
    store.markDirectSessionStatus("om_a", "idle");
    store.markDirectSessionStatus("om_b", "done");
    expect(store.getDirectSession("om_a")?.status).toBe("idle");
    expect(store.getDirectSession("om_b")?.status).toBe("done");
    expect(store.listDirectSessionsByStatus("done")).toHaveLength(1);
  });

  it("persists the turn card id and last prompt for sealing and retry", () => {
    store.upsertDirectSession({
      root_id: "om_c",
      chat_id: "oc_c",
      project: null,
      path: "/x",
      session_id: null,
      status: "running",
    });
    expect(store.getDirectSession("om_c")?.card_message_id).toBeNull();
    expect(store.getDirectSession("om_c")?.last_prompt).toBeNull();
    store.updateDirectSession("om_c", {
      card_message_id: "om_card1",
      last_prompt: "帮我跑测试",
    });
    const s = store.getDirectSession("om_c");
    expect(s?.card_message_id).toBe("om_card1");
    expect(s?.last_prompt).toBe("帮我跑测试");
  });

  it("persists per-session agent/model/auto overrides", () => {
    store.upsertDirectSession({
      root_id: "om_ov",
      chat_id: "oc_c",
      project: null,
      path: "/x",
      session_id: null,
      status: "idle",
    });
    expect(store.getDirectSession("om_ov")?.agent_override).toBeNull();
    expect(store.getDirectSession("om_ov")?.model_override).toBeNull();
    expect(store.getDirectSession("om_ov")?.auto_approve_override).toBeNull();
    store.updateDirectSession("om_ov", {
      agent_override: "review",
      model_override: "deepseek/x",
      auto_approve_override: "on",
    });
    const s = store.getDirectSession("om_ov");
    expect(s?.agent_override).toBe("review");
    expect(s?.model_override).toBe("deepseek/x");
    expect(s?.auto_approve_override).toBe("on");
    store.updateDirectSession("om_ov", {
      agent_override: null,
      model_override: null,
      auto_approve_override: null,
    });
    expect(store.getDirectSession("om_ov")?.agent_override).toBeNull();
  });

  it("survives a store reopen (durable)", () => {
    store.upsertDirectSession({
      root_id: "om_r",
      chat_id: "oc_c",
      project: "p",
      path: "/p",
      session_id: "ses_x",
      status: "idle",
    });
    store.advanceDirectCursor("om_r", "om_p", "300");
    store.close();
    store = new BindingStore(dbPath);
    const s = store.getDirectSession("om_r");
    expect(s?.session_id).toBe("ses_x");
    expect(s?.last_msg_id).toBe("300");
    expect(s?.seen_ids).toEqual(["om_p"]);
  });
});

describe("BindingStore direct_sessions migration", () => {
  it("adds the name/turns/token columns to a pre-existing DB and preserves the row", async () => {
    const Database = (await import("better-sqlite3")).default;
    const dir = mkdtempSync(join(tmpdir(), "tasking-bind-migrate-"));
    const p = join(dir, "old.db");
    const raw = new Database(p);
    raw.exec(`CREATE TABLE direct_sessions (
      root_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      project TEXT,
      path TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      last_msg_id TEXT,
      updated_at INTEGER NOT NULL
    );`);
    raw
      .prepare(
        "INSERT INTO direct_sessions (root_id, chat_id, project, path, status, updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run("om_old", "oc", null, "/x", "idle", 1);
    raw.close();

    const migrated = new BindingStore(p);
    try {
      const row = migrated.getDirectSession("om_old");
      expect(row?.name).toBeNull();
      expect(row?.turns).toBe(0);
      expect(row?.total_tokens).toBe(0);
      migrated.addDirectSessionUsage("om_old", {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
      });
      const updated = migrated.getDirectSession("om_old");
      expect(updated?.turns).toBe(1);
      expect(updated?.input_tokens).toBe(1);
      expect(updated?.output_tokens).toBe(2);
      expect(updated?.total_tokens).toBe(3);
      expect(updated?.card_message_id).toBeNull();
      expect(updated?.last_prompt).toBeNull();
      expect(updated?.agent_override).toBeNull();
      expect(updated?.auto_approve_override).toBeNull();
    } finally {
      migrated.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

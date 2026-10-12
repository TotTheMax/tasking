import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { toSecondsStr } from "../adapters/feishu/source.js";
import { TaskingError, toTaskingError } from "../shared/errors.js";

export interface Binding {
  issue_id: string;
  issue_key: string;
  chat_id: string;
  root_id: string;
  last_jira_comment_id: string | null;
  last_feishu_msg_id: string | null;
  thread_id: string | null;
  card_message_id: string | null;
  status: "active" | "terminal";
}

export type DirectSessionStatus = "running" | "idle" | "done" | "expired";

export interface DirectSession {
  root_id: string;
  chat_id: string;
  project: string | null;
  name: string | null;
  path: string;
  session_id: string | null;
  thread_id: string | null;
  status: DirectSessionStatus;
  last_msg_id: string | null;
  seen_ids: string[];
  card_message_id: string | null;
  last_prompt: string | null;
  agent_override: string | null;
  model_override: string | null;
  auto_approve_override: string | null;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bindings (
  issue_id TEXT PRIMARY KEY,
  issue_key TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  last_jira_comment_id TEXT,
  last_feishu_msg_id TEXT,
  thread_id TEXT,
  card_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_bindings_status ON bindings(status);
CREATE TABLE IF NOT EXISTS bridge_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS direct_sessions (
  root_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  project TEXT,
  name TEXT,
  path TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  last_msg_id TEXT,
  card_message_id TEXT,
  last_prompt TEXT,
  agent_override TEXT,
  model_override TEXT,
  auto_approve_override TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_direct_sessions_status ON direct_sessions(status);
`;
export class BindingStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.exec(SCHEMA);
      try {
        this.db.exec("ALTER TABLE bindings ADD COLUMN thread_id TEXT");
      } catch {
        // column already exists
      }
      try {
        this.db.exec("ALTER TABLE bindings ADD COLUMN card_message_id TEXT");
      } catch {
        // column already exists
      }
      try {
        this.db.exec("ALTER TABLE direct_sessions ADD COLUMN thread_id TEXT");
      } catch {
        // column already exists
      }
      try {
        this.db.exec("ALTER TABLE direct_sessions ADD COLUMN seen_ids TEXT");
      } catch {
        // column already exists
      }
      try {
        this.db.exec("ALTER TABLE direct_sessions ADD COLUMN name TEXT");
      } catch {
        // column already exists
      }
      for (const col of [
        "card_message_id TEXT",
        "last_prompt TEXT",
        "agent_override TEXT",
        "model_override TEXT",
        "auto_approve_override TEXT",
      ]) {
        try {
          this.db.exec(`ALTER TABLE direct_sessions ADD COLUMN ${col}`);
        } catch {}
      }
      for (const col of [
        "turns INTEGER NOT NULL DEFAULT 0",
        "input_tokens INTEGER NOT NULL DEFAULT 0",
        "output_tokens INTEGER NOT NULL DEFAULT 0",
        "total_tokens INTEGER NOT NULL DEFAULT 0",
      ]) {
        try {
          this.db.exec(`ALTER TABLE direct_sessions ADD COLUMN ${col}`);
        } catch {
          // column already exists
        }
      }
    } catch (e) {
      throw toTaskingError(e);
    }
  }

  getBinding(issueId: string): Binding | null {
    const row = this.db.prepare("SELECT * FROM bindings WHERE issue_id = ?").get(issueId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToBinding(row) : null;
  }

  hasRootId(rootId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM bindings WHERE root_id = ? LIMIT 1").get(rootId);
    return row !== undefined;
  }

  getActiveByRootId(rootId: string): Binding | null {
    const row = this.db
      .prepare("SELECT * FROM bindings WHERE root_id = ? AND status = 'active' LIMIT 1")
      .get(rootId) as Record<string, unknown> | undefined;
    return row ? rowToBinding(row) : null;
  }

  getByRootId(rootId: string): Binding | null {
    const row = this.db.prepare("SELECT * FROM bindings WHERE root_id = ? LIMIT 1").get(rootId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToBinding(row) : null;
  }

  upsertBinding(b: {
    issue_id: string;
    issue_key: string;
    chat_id: string;
    root_id: string;
    thread_id?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO bindings (issue_id, issue_key, chat_id, root_id, thread_id, status)
         VALUES (?, ?, ?, ?, ?, 'active')
         ON CONFLICT(issue_id) DO UPDATE SET thread_id = excluded.thread_id
         WHERE excluded.thread_id IS NOT NULL
           AND bindings.thread_id IS NOT excluded.thread_id`,
      )
      .run(b.issue_id, b.issue_key, b.chat_id, b.root_id, b.thread_id ?? null);
  }

  advanceJiraCursor(issueId: string, commentId: string): void {
    const info = this.db
      .prepare("UPDATE bindings SET last_jira_comment_id = ? WHERE issue_id = ?")
      .run(commentId, issueId);
    if (info.changes === 0) {
      throw new TaskingError("inbox_error", `binding not found: ${issueId}`);
    }
  }

  setBindingCardId(issueId: string, messageId: string | null): void {
    this.db
      .prepare("UPDATE bindings SET card_message_id = ? WHERE issue_id = ?")
      .run(messageId, issueId);
  }

  advanceFeishuCursor(issueId: string, msgCursor: string): void {
    const info = this.db
      .prepare("UPDATE bindings SET last_feishu_msg_id = ? WHERE issue_id = ?")
      .run(msgCursor, issueId);
    if (info.changes === 0) {
      throw new TaskingError("inbox_error", `binding not found: ${issueId}`);
    }
  }

  markTerminal(issueId: string): void {
    this.db.prepare("UPDATE bindings SET status = 'terminal' WHERE issue_id = ?").run(issueId);
  }

  markActive(issueId: string): void {
    this.db.prepare("UPDATE bindings SET status = 'active' WHERE issue_id = ?").run(issueId);
  }

  listActive(): Binding[] {
    const rows = this.db.prepare("SELECT * FROM bindings WHERE status = 'active'").all() as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToBinding);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM bridge_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  upsertDirectSession(s: {
    root_id: string;
    chat_id: string;
    project: string | null;
    name?: string | null;
    path: string;
    session_id: string | null;
    status: DirectSessionStatus;
  }): void {
    this.db
      .prepare(
        `INSERT INTO direct_sessions (root_id, chat_id, project, name, path, session_id, status, last_msg_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(root_id) DO UPDATE SET
           chat_id = excluded.chat_id,
           project = excluded.project,
           name = COALESCE(excluded.name, direct_sessions.name),
           path = excluded.path,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run(
        s.root_id,
        s.chat_id,
        s.project,
        s.name ?? null,
        s.path,
        s.session_id,
        s.status,
        Date.now(),
      );
  }

  getDirectSession(rootId: string): DirectSession | null {
    const row = this.db.prepare("SELECT * FROM direct_sessions WHERE root_id = ?").get(rootId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToDirectSession(row) : null;
  }

  addDirectSessionUsage(
    rootId: string,
    usage: { input_tokens: number; output_tokens: number; total_tokens: number },
    turnsDelta = 1,
  ): void {
    this.db
      .prepare(
        `UPDATE direct_sessions
         SET turns = turns + ?,
             input_tokens = input_tokens + ?,
             output_tokens = output_tokens + ?,
             total_tokens = total_tokens + ?,
             updated_at = ?
         WHERE root_id = ?`,
      )
      .run(
        turnsDelta,
        usage.input_tokens,
        usage.output_tokens,
        usage.total_tokens,
        Date.now(),
        rootId,
      );
  }

  updateDirectSession(
    rootId: string,
    patch: {
      session_id?: string | null;
      status?: DirectSessionStatus;
      thread_id?: string | null;
      card_message_id?: string | null;
      last_prompt?: string | null;
      name?: string | null;
      agent_override?: string | null;
      model_override?: string | null;
      auto_approve_override?: string | null;
    },
  ): void {
    if (patch.session_id !== undefined) {
      this.db
        .prepare("UPDATE direct_sessions SET session_id = ?, updated_at = ? WHERE root_id = ?")
        .run(patch.session_id, Date.now(), rootId);
    }
    if (patch.status !== undefined) {
      this.db
        .prepare("UPDATE direct_sessions SET status = ?, updated_at = ? WHERE root_id = ?")
        .run(patch.status, Date.now(), rootId);
    }
    if (patch.thread_id !== undefined) {
      this.db
        .prepare(
          "UPDATE direct_sessions SET thread_id = ? WHERE root_id = ? AND (thread_id IS NULL OR thread_id != ?)",
        )
        .run(patch.thread_id, rootId, patch.thread_id);
    }
    if (patch.card_message_id !== undefined) {
      this.db
        .prepare("UPDATE direct_sessions SET card_message_id = ? WHERE root_id = ?")
        .run(patch.card_message_id, rootId);
    }
    if (patch.name !== undefined) {
      this.db
        .prepare("UPDATE direct_sessions SET name = ?, updated_at = ? WHERE root_id = ?")
        .run(patch.name, Date.now(), rootId);
    }
    if (patch.last_prompt !== undefined) {
      this.db
        .prepare("UPDATE direct_sessions SET last_prompt = ?, updated_at = ? WHERE root_id = ?")
        .run(patch.last_prompt, Date.now(), rootId);
    }
    for (const [column, value] of [
      ["agent_override", patch.agent_override],
      ["model_override", patch.model_override],
      ["auto_approve_override", patch.auto_approve_override],
    ] as const) {
      if (value === undefined) continue;
      this.db
        .prepare(`UPDATE direct_sessions SET ${column} = ?, updated_at = ? WHERE root_id = ?`)
        .run(value, Date.now(), rootId);
    }
  }

  listActiveDirectSessions(): DirectSession[] {
    const rows = this.db
      .prepare("SELECT * FROM direct_sessions WHERE status IN ('running', 'idle')")
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToDirectSession);
  }

  markDirectSessionStatus(rootId: string, status: DirectSessionStatus): void {
    this.db
      .prepare("UPDATE direct_sessions SET status = ?, updated_at = ? WHERE root_id = ?")
      .run(status, Date.now(), rootId);
  }

  listDirectSessionsByStatus(status: DirectSessionStatus): DirectSession[] {
    const rows = this.db
      .prepare("SELECT * FROM direct_sessions WHERE status = ?")
      .all(status) as Array<Record<string, unknown>>;
    return rows.map(rowToDirectSession);
  }

  listExpiredDirectSessions(cutoffMs: number): DirectSession[] {
    const rows = this.db
      .prepare("SELECT * FROM direct_sessions WHERE status = 'idle' AND updated_at <= ?")
      .all(cutoffMs) as Array<Record<string, unknown>>;
    return rows.map(rowToDirectSession);
  }

  advanceDirectCursor(rootId: string, msgId: string, createTime: string): void {
    const cur = this.getDirectSession(rootId);
    if (!cur) return;
    const curSec = toSecondsStr(cur.last_msg_id ?? "");
    const nextSec = toSecondsStr(createTime);
    if (curSec !== "" && Number(nextSec) < Number(curSec)) return;
    let seen = cur.seen_ids;
    if (curSec === "" || Number(nextSec) > Number(curSec)) {
      seen = [msgId];
    } else if (!seen.includes(msgId)) {
      seen = appendCapped(seen, msgId, DIRECT_SEEN_IDS_CAP);
    }
    this.db
      .prepare("UPDATE direct_sessions SET last_msg_id = ?, seen_ids = ? WHERE root_id = ?")
      .run(nextSec, JSON.stringify(seen), rootId);
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO bridge_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  deleteMeta(key: string): void {
    this.db.prepare("DELETE FROM bridge_meta WHERE key = ?").run(key);
  }

  isIntakeSeen(msgId: string): boolean {
    return parseSeenIds(this.getMeta(INTAKE_SEEN_IDS_META_KEY)).includes(msgId);
  }

  markIntakeSeen(msgId: string): void {
    const seen = parseSeenIds(this.getMeta(INTAKE_SEEN_IDS_META_KEY));
    if (seen.includes(msgId)) return;
    this.setMeta(
      INTAKE_SEEN_IDS_META_KEY,
      JSON.stringify(appendCapped(seen, msgId, INTAKE_SEEN_IDS_CAP)),
    );
  }

  close(): void {
    this.db.close();
  }
}

function rowToBinding(row: Record<string, unknown>): Binding {
  return {
    issue_id: String(row.issue_id),
    issue_key: String(row.issue_key),
    chat_id: String(row.chat_id),
    root_id: String(row.root_id),
    last_jira_comment_id:
      typeof row.last_jira_comment_id === "string" ? row.last_jira_comment_id : null,
    last_feishu_msg_id: typeof row.last_feishu_msg_id === "string" ? row.last_feishu_msg_id : null,
    thread_id: typeof row.thread_id === "string" ? row.thread_id : null,
    card_message_id: typeof row.card_message_id === "string" ? row.card_message_id : null,
    status: row.status === "terminal" ? "terminal" : "active",
  };
}

const DIRECT_STATUSES: DirectSessionStatus[] = ["running", "idle", "done", "expired"];

function rowToDirectSession(row: Record<string, unknown>): DirectSession {
  const status =
    typeof row.status === "string" && (DIRECT_STATUSES as string[]).includes(row.status)
      ? (row.status as DirectSessionStatus)
      : "idle";
  return {
    root_id: String(row.root_id),
    chat_id: String(row.chat_id),
    project: typeof row.project === "string" ? row.project : null,
    name: typeof row.name === "string" && row.name !== "" ? row.name : null,
    path: String(row.path),
    session_id: typeof row.session_id === "string" ? row.session_id : null,
    thread_id: typeof row.thread_id === "string" ? row.thread_id : null,
    status,
    last_msg_id: typeof row.last_msg_id === "string" ? row.last_msg_id : null,
    seen_ids: parseSeenIds(row.seen_ids),
    card_message_id: typeof row.card_message_id === "string" ? row.card_message_id : null,
    last_prompt: typeof row.last_prompt === "string" ? row.last_prompt : null,
    agent_override: typeof row.agent_override === "string" ? row.agent_override : null,
    model_override: typeof row.model_override === "string" ? row.model_override : null,
    auto_approve_override:
      typeof row.auto_approve_override === "string" ? row.auto_approve_override : null,
    turns: typeof row.turns === "number" ? row.turns : 0,
    input_tokens: typeof row.input_tokens === "number" ? row.input_tokens : 0,
    output_tokens: typeof row.output_tokens === "number" ? row.output_tokens : 0,
    total_tokens: typeof row.total_tokens === "number" ? row.total_tokens : 0,
    updated_at: typeof row.updated_at === "number" ? row.updated_at : 0,
  };
}

function parseSeenIds(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const INTAKE_SEEN_IDS_META_KEY = "intake_seen_ids";
const INTAKE_SEEN_IDS_CAP = 50;
const DIRECT_SEEN_IDS_CAP = 50;

function appendCapped(ids: string[], id: string, cap: number): string[] {
  const next = [...ids, id];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Fixture-derived builders for opencode v2 REST payloads.
 *
 * The JSON files under tests/fixtures/opencode-v2/rest/ were captured
 * from a real v2 session (see provenance.md). Builders here clone those
 * real payloads and patch only the values a test needs, so the FIELD
 * NAMES always come from the real contract. A test that feeds hand-made
 * v1-shaped data can pass while the code reads the wrong field (that is
 * how the tool-name/output and session.active bugs slipped through);
 * deriving from captured payloads makes such mismatches fail in tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REST_DIR = join(import.meta.dirname, "..", "fixtures", "opencode-v2", "rest");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(REST_DIR, `${name}.json`), "utf8")) as T;
}

const TEMPLATES = {
  sessionCreate: load<Record<string, unknown>>("session-create"),
  sessionGet: load<Record<string, unknown>>("session-get-terminal"),
  messageList: load<Record<string, unknown>>("message-list-settled"),
  permissionList: load<Record<string, unknown>>("permission-list-pending"),
  sessionActive: load<Record<string, unknown>>("session-active"),
  interrupt: load<Record<string, unknown>>("interrupt"),
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function dataOf(template: Record<string, unknown>): Record<string, unknown> {
  return clone(template.data as Record<string, unknown>);
}

export function sessionCreateResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ data: { ...dataOf(TEMPLATES.sessionCreate), ...overrides } });
}

export function sessionGetResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ data: { ...dataOf(TEMPLATES.sessionGet), ...overrides } });
}

/** A real assistant message envelope; pass content entries built by the helpers below. */
export function assistantMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const messages = clone(TEMPLATES.messageList).data as Array<Record<string, unknown>>;
  const assistant = messages.find((m) => m.type === "assistant");
  const envelope = assistant ?? {
    id: "msg_fixture",
    time: { created: 1, streamed: 1, completed: 1 },
    type: "assistant",
    agent: "build",
    model: { id: "fixture", providerID: "fixture", variant: "default" },
    finish: "stop",
    rawFinish: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  return { ...clone(envelope), ...overrides };
}

/**
 * A tool content entry in the REAL v2 shape: name + state.content text
 * entries (not v1's tool/state.output).
 */
export function toolEntry(overrides: {
  id?: string;
  name?: string;
  command?: string;
  output?: string;
  exit?: number;
  status?: string;
  truncated?: boolean;
  created?: number;
  completed?: number;
}): Record<string, unknown> {
  const created = overrides.created ?? 1000;
  const completed = overrides.completed ?? created + 500;
  const entry: Record<string, unknown> = {
    type: "tool",
    id: overrides.id ?? "call_fixture",
    name: overrides.name ?? "shell",
    executed: false,
    state: {
      status: overrides.status ?? "completed",
      input: { command: overrides.command ?? "echo fixture" },
      content: [{ type: "text", text: overrides.output ?? "fixture\n" }],
      metadata: {
        status: overrides.status ?? "completed",
        truncated: overrides.truncated ?? false,
        exit: overrides.exit ?? 0,
      },
    },
    time: { created, ran: created + 100, completed },
  };
  return entry;
}

/** A real user message envelope (from the captured list). */
export function userMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const messages = clone(TEMPLATES.messageList).data as Array<Record<string, unknown>>;
  const user = messages.find((m) => m.type === "user") ?? {
    id: "msg_user",
    time: { created: 1 },
    type: "user",
  };
  return { ...clone(user), ...overrides };
}

export function messageListResponse(messages: Array<Record<string, unknown>>): string {
  return JSON.stringify({ data: messages });
}

export function permission(overrides: {
  id?: string;
  sessionID?: string;
  action?: string;
  resources?: string[];
  save?: string[];
}): Record<string, unknown> {
  const template =
    (clone(TEMPLATES.permissionList).data as Array<Record<string, unknown>>)[0] ?? {};
  return {
    ...template,
    id: overrides.id ?? "per_fixture",
    sessionID: overrides.sessionID ?? "ses_fixture",
    action: overrides.action ?? "shell",
    resources: overrides.resources ?? ["echo fixture"],
    ...(overrides.save ? { save: overrides.save } : {}),
  };
}

export function permissionListResponse(items: Array<Record<string, unknown>>): string {
  return JSON.stringify({ data: items });
}

export function sessionActiveResponse(sessionIds: string[]): string {
  const template = clone(TEMPLATES.sessionActive).data as Record<string, unknown>;
  const entry = Object.values(template)[0] ?? { type: "running" };
  const data: Record<string, unknown> = {};
  for (const id of sessionIds) data[id] = clone(entry);
  return JSON.stringify({ data });
}

export function interruptResponse(): string {
  return JSON.stringify(clone(TEMPLATES.interrupt));
}

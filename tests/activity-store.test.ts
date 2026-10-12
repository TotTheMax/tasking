import { describe, expect, it } from "vitest";
import { ActivityStore } from "../src/observability/activity-store.js";
import type { ActivityEvent } from "../src/observability/activity-store.js";

function evt(n: number): ActivityEvent {
  return { ts: 1000 + n, turn: 1, type: "text", text: `msg-${n}` };
}

describe("ActivityStore", () => {
  it("records and returns events in order", () => {
    const store = new ActivityStore(50);
    store.record("T1", evt(1));
    store.record("T1", evt(2));
    store.record("T1", evt(3));
    const recent = store.recent("T1");
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => e.text)).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  it("drops oldest when over cap", () => {
    const store = new ActivityStore(3);
    for (let i = 0; i < 4; i++) store.record("T1", evt(i));
    const recent = store.recent("T1");
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => e.text)).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  it("isolates by task id", () => {
    const store = new ActivityStore(50);
    store.record("T1", evt(1));
    store.record("T2", evt(2));
    expect(store.recent("T1").map((e) => e.text)).toEqual(["msg-1"]);
    expect(store.recent("T2").map((e) => e.text)).toEqual(["msg-2"]);
  });

  it("clears a task", () => {
    const store = new ActivityStore(50);
    store.record("T1", evt(1));
    store.clear("T1");
    expect(store.recent("T1")).toEqual([]);
  });

  it("returns empty for unknown task", () => {
    const store = new ActivityStore(50);
    expect(store.recent("NOPE")).toEqual([]);
  });

  it("respects limit on recent", () => {
    const store = new ActivityStore(50);
    for (let i = 0; i < 10; i++) store.record("T1", evt(i));
    const recent = store.recent("T1", 3);
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => e.text)).toEqual(["msg-7", "msg-8", "msg-9"]);
  });

  it("caps at default cap of 500", () => {
    const store = new ActivityStore();
    for (let i = 0; i < 600; i++) store.record("T1", evt(i));
    expect(store.recent("T1")).toHaveLength(500);
  });

  it("preserves tool execution detail fields on record/recent", () => {
    const store = new ActivityStore();
    const detail: ActivityEvent = {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      title: "echo hi",
      input: { command: "echo hi" },
      output: "hi\n",
      exit: 0,
      status: "completed",
      durationMs: 500,
    };
    store.record("T1", detail);
    const [got] = store.recent("T1");
    expect(got).toEqual(detail);
  });
});

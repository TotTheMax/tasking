import { describe, expect, it } from "vitest";
import { LogRingBuffer } from "../src/observability/log-buffer.js";

describe("LogRingBuffer", () => {
  it("stores valid JSON log lines as structured entries", () => {
    const buf = new LogRingBuffer(10);
    buf.push(JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", level: "warn", msg: "poll failed" }));
    const entries = buf.recent(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.msg).toBe("poll failed");
    expect(entries[0]?.ts).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stores non-JSON lines with level info", () => {
    const buf = new LogRingBuffer(10);
    buf.push("some raw text");
    const entries = buf.recent(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.msg).toBe("some raw text");
  });

  it("pushEntry stores a pre-parsed entry and respects min level", () => {
    const buf = new LogRingBuffer(10);
    buf.pushEntry({ ts: "t1", level: "info", msg: "kept", fields: { task_id: "T-1" } });
    buf.setMinLevel("warn");
    buf.pushEntry({ ts: "t2", level: "debug", msg: "dropped", fields: {} });
    const entries = buf.recent(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe("kept");
    expect(entries[0]?.fields).toEqual({ task_id: "T-1" });
  });

  it("overwrites oldest entry when full", () => {
    const buf = new LogRingBuffer(3);
    buf.push(JSON.stringify({ level: "info", msg: "a" }));
    buf.push(JSON.stringify({ level: "info", msg: "b" }));
    buf.push(JSON.stringify({ level: "info", msg: "c" }));
    buf.push(JSON.stringify({ level: "info", msg: "d" }));
    const entries = buf.recent(10);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.msg)).toEqual(["b", "c", "d"]);
  });

  it("returns recent n entries in ascending order", () => {
    const buf = new LogRingBuffer(50);
    for (let i = 0; i < 10; i++) {
      buf.push(JSON.stringify({ level: "info", msg: `msg-${i}` }));
    }
    const entries = buf.recent(3);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.msg)).toEqual(["msg-7", "msg-8", "msg-9"]);
  });

  it("returns empty array when buffer is empty", () => {
    const buf = new LogRingBuffer(10);
    expect(buf.recent(5)).toEqual([]);
  });

  it("preserves extra fields", () => {
    const buf = new LogRingBuffer(10);
    buf.push(JSON.stringify({ level: "error", msg: "fail", task_id: "T-1" }));
    const entries = buf.recent(1);
    expect(entries[0]?.fields).toEqual({ task_id: "T-1" });
  });

  it("handles JSON with invalid level gracefully", () => {
    const buf = new LogRingBuffer(10);
    buf.push(JSON.stringify({ level: "trace", msg: "weird" }));
    const entries = buf.recent(1);
    expect(entries[0]?.level).toBe("info");
  });
});

import type { LogLevel } from "./logger.js";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  fields: Record<string, unknown>;
}

const DEFAULT_CAPACITY = 500;
const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class LogRingBuffer {
  private readonly capacity: number;
  private readonly buffer: LogEntry[] = [];
  private head = 0;
  private count = 0;
  private minLevel: LogLevel = "info";

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  push(line: string): void {
    this.pushEntry(parseLine(line));
  }

  pushEntry(entry: LogEntry): void {
    if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[this.minLevel]) return;
    if (this.count < this.capacity) {
      this.buffer.push(entry);
      this.count++;
    } else {
      this.buffer[this.head] = entry;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  recent(n: number): LogEntry[] {
    const take = Math.min(n, this.count);
    const result: LogEntry[] = [];
    for (let i = 0; i < take; i++) {
      const idx = (this.head + this.count - take + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) result.push(entry);
    }
    return result;
  }
}

function parseLine(line: string): LogEntry {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const level = isValidLevel(parsed.level) ? parsed.level : "info";
    const { level: _l, msg, ts, ...rest } = parsed;
    return {
      ts: typeof ts === "string" ? ts : new Date().toISOString(),
      level,
      msg: typeof msg === "string" ? msg : line,
      fields: rest,
    };
  } catch {
    return {
      ts: new Date().toISOString(),
      level: "info",
      msg: line,
      fields: {},
    };
  }
}

function isValidLevel(v: unknown): v is LogLevel {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

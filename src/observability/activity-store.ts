export interface ActivityEvent {
  ts: number;
  turn: number;
  type: string;
  text?: string;
  tool?: string;
  tokens?: { input: number; output: number; total: number };
  title?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  exit?: number;
  status?: string;
  durationMs?: number;
  truncated?: boolean;
}

const DEFAULT_CAP = 500;

export class ActivityStore {
  private buffers = new Map<string, ActivityEvent[]>();
  private readonly cap: number;

  constructor(maxPerTask: number = DEFAULT_CAP) {
    this.cap = maxPerTask;
  }

  record(taskId: string, evt: ActivityEvent): void {
    let buf = this.buffers.get(taskId);
    if (!buf) {
      buf = [];
      this.buffers.set(taskId, buf);
    }
    buf.push(evt);
    if (buf.length > this.cap) {
      buf.splice(0, buf.length - this.cap);
    }
  }

  recent(taskId: string, limit?: number): ActivityEvent[] {
    const buf = this.buffers.get(taskId);
    if (!buf) return [];
    if (limit !== undefined && limit >= 0) {
      return buf.slice(Math.max(0, buf.length - limit));
    }
    return buf.slice();
  }

  clear(taskId: string): void {
    this.buffers.delete(taskId);
  }
}

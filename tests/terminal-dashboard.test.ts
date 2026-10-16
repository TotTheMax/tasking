import { describe, expect, it, vi } from "vitest";
import { ActivityStore } from "../src/observability/activity-store.js";
import type { ConfigView } from "../src/observability/config-view.js";
import { LogRingBuffer } from "../src/observability/log-buffer.js";
import { ConsoleLogger } from "../src/observability/logger.js";
import { buildSnapshot } from "../src/observability/snapshot.js";
import { TerminalDashboard } from "../src/observability/terminal-dashboard.js";
import { createInitialState } from "../src/shared/types.js";
import type { RunningEntry, RuntimeDirectSession } from "../src/shared/types.js";
import { setLocale } from "../src/translate/locale.js";

const logger = new ConsoleLogger({}, () => {});

function makeRunningEntry(id: string, overrides: Partial<RunningEntry> = {}): RunningEntry {
  return {
    task: {
      id,
      identifier: `ENG-${id}`,
      title: "test",
      description: null,
      priority: 1,
      state: "In Progress",
      branch_name: null,
      url: null,
      labels: [],
      blocked_by: [],
      assignee: null,
      created_at: null,
      updated_at: null,
      source: "jira",
    },
    task_identifier: `ENG-${id}`,
    workspace_path: `/tmp/ENG-${id}`,
    session_id: "ses_abc123def456",
    last_event: "turn_completed",
    last_message: "working",
    last_event_at: Date.now(),
    started_at: Date.now() - 60000,
    turn_count: 3,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    last_reported_input_tokens: 100,
    last_reported_output_tokens: 50,
    last_reported_total_tokens: 150,
    retry_attempt: null,
    abort: null,
    agent: "build",
    model: "anthropic/claude-sonnet-4-5",
    variant: "high",
    ...overrides,
  };
}

function makeTui(
  state = createInitialState(30000, 10),
  activityStore?: ActivityStore,
  terminalWidth?: () => number,
  directSessions?: () => RuntimeDirectSession[],
  directTotals?: () => { input_tokens: number; output_tokens: number; total_tokens: number },
) {
  let output = "";
  const tui = new TerminalDashboard({
    state: () => state,
    logger,
    renderFn: (c) => {
      output = c;
    },
    ...(activityStore ? { activityStore } : {}),
    ...(terminalWidth ? { terminalWidth } : {}),
    ...(directSessions ? { directSessions } : {}),
    ...(directTotals ? { directTotals } : {}),
  });
  return { tui, output: () => output, state };
}

function makeLogsTui(messages: string[]): {
  tui: TerminalDashboard;
  output: () => string;
  logBuffer: LogRingBuffer;
} {
  const logBuffer = new LogRingBuffer(500);
  for (const msg of messages) {
    logBuffer.push(JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg }));
  }
  let output = "";
  const tui = new TerminalDashboard({
    state: () => createInitialState(30000, 10),
    logger,
    renderFn: (c) => {
      output = c;
    },
    logBuffer,
  });
  return { tui, output: () => output, logBuffer };
}

function lines(from: number, to: number, prefix: string): string[] {
  const out: string[] = [];
  for (let i = from; i < to; i++) out.push(`${prefix} ${i}`);
  return out;
}

function makeDescribedEntry(id: string, description: string): RunningEntry {
  return makeRunningEntry(id, {
    task: {
      id,
      identifier: `ENG-${id}`,
      title: "Fix the login bug",
      description,
      priority: 1,
      state: "In Progress",
      branch_name: null,
      url: null,
      labels: [],
      blocked_by: [],
      assignee: "alice",
      created_at: null,
      updated_at: null,
      source: "jira",
    },
  });
}

describe("TerminalDashboard", () => {
  it("renders idle state", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    expect(output()).toContain("tasking");
    expect(output()).toContain("Agents:");
    expect(output()).toContain("0/10");
    expect(output()).toContain("No active agents");
    expect(output()).toContain("No queued retries");
  });

  it("overview footer does not advertise a Space pause action", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    expect(output()).not.toContain("Space pause");
    expect(output()).not.toContain("Space/pause");
  });

  it("renders running entries", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    expect(output()).toContain("ENG-1");
    expect(output()).toContain("In Progress");
    expect(output()).toContain("3");
  });

  it("detail view shows Agent/Model/Variant and a hint for activity", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r"); // enter detail-running
    tui.forceRender();
    expect(output()).toContain("Agent:");
    expect(output()).toContain("Model:");
    expect(output()).toContain("Variant:");
    expect(output()).toContain("anthropic/claude-sonnet-4-5");
    expect(output()).toContain("a activity");
  });

  it("a key enters activity view, Esc returns to detail", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", { ts: 1, turn: 1, type: "text", text: "hello world" });
    store.record("1", { ts: 2, turn: 1, type: "tool_use", tool: "read" });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r"); // detail-running
    tui.handleKey("a"); // -> activity
    tui.forceRender();
    expect(output()).toContain("Activity");
    expect(output()).toContain("hello world");
    expect(output()).toContain("read");
    expect(output()).toContain("anthropic/claude-sonnet-4-5"); // header model
    tui.handleKey("q"); // back to detail (Esc is buffered; q is immediate)
    tui.forceRender();
    expect(output()).toContain("Agent:");
    expect(output()).toContain("Workspace:");
  });

  it("renders v2 step_usage token lines and reasoning text in the activity view", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "step_usage",
      tokens: { input: 10, output: 5, total: 15 },
    });
    store.record("1", { ts: 2, turn: 1, type: "reasoning", text: "thinking hard" });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("tokens +");
    expect(output()).toContain("thinking hard");
  });

  it("j/k scroll in activity view without crashing", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    for (let i = 0; i < 60; i++)
      store.record("1", { ts: i, turn: 1, type: "text", text: `e-${i}` });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("Activity");
    tui.handleKey("k"); // scroll up (pause follow)
    tui.forceRender();
    expect(output()).toContain("paused");
    tui.handleKey("j"); // scroll down
    tui.forceRender();
    expect(output()).toContain("Activity");
  });

  it("pressing f pauses the activity view and new events do not scroll it", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    for (let i = 0; i < 40; i++)
      store.record("1", { ts: Date.now() + i, turn: 1, type: "text", text: `act ${i}` });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    expect(output()).toContain("act 39");
    tui.handleKey("f");
    expect(output()).toContain("[paused]");
    store.record("1", { ts: Date.now() + 500, turn: 1, type: "text", text: "act NEW" });
    tui.forceRender();
    expect(output()).not.toContain("act NEW");
    expect(output()).toContain("act 39");
    tui.handleKey("f"); // resume
    tui.forceRender();
    expect(output()).not.toContain("[paused]");
    expect(output()).toContain("act NEW");
  });

  it("pressing Space pauses the activity view and new events do not scroll it", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    for (let i = 0; i < 40; i++)
      store.record("1", { ts: Date.now() + i, turn: 1, type: "text", text: `sp ${i}` });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    expect(output()).toContain("sp 39");
    tui.handleKey(" ");
    expect(output()).toContain("[paused]");
    store.record("1", { ts: Date.now() + 700, turn: 1, type: "text", text: "sp NEW" });
    tui.forceRender();
    expect(output()).not.toContain("sp NEW");
    expect(output()).toContain("sp 39");
  });

  it("activity view shows placeholder when no events", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("No activity");
  });

  it("activity view wraps long CJK text, caps at 3 lines, marks selection and hints Enter", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", { ts: 1, turn: 1, type: "text", text: "你".repeat(100) });
    const { tui, output } = makeTui(state, store, () => 30);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    const out = output();
    expect(out).toContain("…");
    expect(out).toContain("Enter expand");
    expect(out).toContain("❯");
    expect(out).toContain("你你你");
  });

  it("Enter opens full-text overlay showing the complete text, Esc returns to activity", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", { ts: 1, turn: 1, type: "text", text: "你".repeat(100) });
    const { tui, output } = makeTui(state, store, () => 30);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("…");
    tui.handleKey("\r");
    tui.forceRender();
    const out = output();
    expect(out).toContain("full text");
    expect(out).not.toContain("…");
    tui.handleKey("q");
    tui.forceRender();
    expect(output()).toContain("Activity");
  });

  it("Enter shows structured tool detail (status/exit, args, output, duration)", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      title: "false",
      input: { command: "false" },
      output: "cmd not found\n",
      exit: 127,
      status: "completed",
      durationMs: 300,
    });
    const { tui, output } = makeTui(state, store, () => 80);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.handleKey("\r");
    tui.forceRender();
    const out = output();
    expect(out).toContain("full text");
    expect(out).toContain("exit 127");
    expect(out).toContain("\x1b[33mStatus: ✗ completed (exit 127)\x1b[0m");
    expect(out).toContain("Command:");
    expect(out).toContain("false");
    expect(out).toContain("Output:");
    expect(out).toContain("cmd not found");
    expect(out).toContain("300ms");
  });

  it("shows an explicit no-output row and keeps the truncation marker for empty output", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      input: { command: "false" },
      output: "",
      exit: 1,
      durationMs: 300,
      truncated: true,
    });
    const { tui, output } = makeTui(state, store, () => 80);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.handleKey("\r");
    tui.forceRender();
    const out = output();
    expect(out).toContain("Output:");
    expect(out).toContain("(no output)");
    expect(out).toContain("… (opencode truncated)");
  });

  it("hides missing tool detail rows instead of showing empty placeholders", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", { ts: 1, turn: 1, type: "tool_use", tool: "read" });
    const { tui, output } = makeTui(state, store, () => 80);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.handleKey("\r");
    tui.forceRender();
    const out = output();
    expect(out).toContain("read");
    expect(out).not.toContain("Output:");
    expect(out).not.toContain("Command:");
  });

  it("truncates very long tool output to the tail with a marker", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    const bigOutput = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      input: { command: "long" },
      output: bigOutput,
      exit: 0,
    });
    const { tui, output } = makeTui(state, store, () => 80);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.handleKey("\r");
    tui.forceRender();
    const out = output();
    expect(out).toContain("… (50 more lines)");
    expect(out).toContain("line 50");
    expect(out).not.toContain("line 0");
    tui.handleKey("j");
    for (let i = 0; i < 90; i++) tui.handleKey("j");
    tui.forceRender();
    const scrolled = output();
    expect(scrolled).toContain("line 149");
  });

  it("marks output opencode already truncated", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      input: { command: "x" },
      output: "abc",
      exit: 0,
      truncated: true,
    });
    const { tui, output } = makeTui(state, store, () => 80);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.handleKey("\r");
    tui.forceRender();
    expect(output()).toContain("… (opencode truncated)");
  });

  it("activity-detail overlay scrolls long text with j/k", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    const text = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    store.record("1", { ts: 1, turn: 1, type: "text", text });
    const { tui, output } = makeTui(state, store, () => 40);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.handleKey("\r");
    tui.forceRender();
    expect(output()).toContain("[0/30]");
    tui.handleKey("j");
    tui.forceRender();
    expect(output()).toContain("[1/30]");
    tui.handleKey("k");
    tui.forceRender();
    expect(output()).toContain("[0/30]");
  });

  it("renders retry queue", () => {
    const state = createInitialState(30000, 10);
    state.retry_attempts.set("2", {
      task_id: "2",
      identifier: "ENG-2",
      attempt: 3,
      due_at_ms: Date.now() + 5000,
      timer: null,
      error: "no slots",
      continuation: false,
      session_id: null,
    });
    const { tui, output } = makeTui(state);
    tui.forceRender();
    expect(output()).toContain("ENG-2");
    expect(output()).toContain("attempt=3");
  });

  it("renders sparkline line", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    expect(output()).toContain("Throughput (10min)");
  });

  it("shows collecting message when no throughput data", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    expect(output()).toContain("collecting");
  });

  it("displays dashboard url when provided", () => {
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      dashboardUrl: "http://127.0.0.1:8080",
    });
    tui.forceRender();
    expect(output).toContain("http://127.0.0.1:8080");
    expect(output).toContain("Dashboard:");
  });

  it("omits dashboard line when url is null", () => {
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      dashboardUrl: null,
    });
    tui.forceRender();
    expect(output).not.toContain("Dashboard:");
  });

  it("enters alternate screen on start and exits on stop", () => {
    const outputs: string[] = [];
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        outputs.push(c);
      },
      intervalMs: 100,
    });
    tui.start(100);
    tui.stop();
    const allOutput = outputs.join("");
    expect(allOutput).toContain("\x1b[?1049h");
    expect(allOutput).toContain("\x1b[?1049l");
    expect(allOutput).toContain("\x1b[?25l");
    expect(allOutput).toContain("\x1b[?25h");
  });

  it("does not emit alt-screen codes on forceRender without start", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    expect(output()).not.toContain("\x1b[?1049h");
    expect(output()).not.toContain("\x1b[?1049l");
  });

  it("shows selection cursor on focused running item", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    state.running.set("2", makeRunningEntry("2"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    expect(output()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    expect(output()).toContain("◄");
  });

  it("moves selection with j/k keys", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    state.running.set("2", makeRunningEntry("2"));
    state.running.set("3", makeRunningEntry("3"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    const firstOutput = output();
    tui.handleKey("j");
    const secondOutput = output();
    expect(secondOutput).not.toEqual(firstOutput);
  });

  it("switches focus with Tab", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    state.retry_attempts.set("2", {
      task_id: "2",
      identifier: "ENG-2",
      attempt: 1,
      due_at_ms: Date.now() + 5000,
      timer: null,
      error: "fail",
      continuation: false,
      session_id: null,
    });
    const { tui, output } = makeTui(state);
    tui.forceRender();
    expect(output()).toContain("◄");
    tui.handleKey("\t");
    expect(output()).toContain("◄");
  });

  it("enters running detail with Enter", () => {
    const state = createInitialState(30000, 10);
    state.running.set(
      "1",
      makeRunningEntry("1", {
        task: {
          id: "1",
          identifier: "ENG-1",
          title: "Fix the login bug",
          description: "Users can't log in",
          priority: 1,
          state: "In Progress",
          branch_name: null,
          url: "https://jira/ENG-1",
          labels: ["bug", "urgent"],
          blocked_by: [],
          assignee: "alice",
          created_at: null,
          updated_at: null,
          source: "jira",
        },
      }),
    );
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("Fix the login bug");
    expect(output()).toContain("alice");
    expect(output()).toContain("https://jira/ENG-1");
    expect(output()).toContain("bug");
  });

  it("wraps long description lines keeping the box border", () => {
    const state = createInitialState(30000, 10);
    const longLine = `${"x".repeat(100)}end-of-line`;
    state.running.set("1", makeDescribedEntry("1", `first\n${longLine}\nlast`));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("end-of-line");
    expect(output()).not.toContain("…");
  });

  it("folds long running-detail descriptions to 6 wrapped lines with a marker", () => {
    const state = createInitialState(30000, 10);
    const description = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
    state.running.set("1", makeDescribedEntry("1", description));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("Description:");
    expect(output()).toContain("line 1");
    expect(output()).toContain("line 6");
    expect(output()).toContain("… (2 more lines)");
    expect(output()).not.toContain("line 7");
    expect(output()).not.toContain("line 8");
  });

  it("does not fold short running-detail descriptions", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeDescribedEntry("1", "one\ntwo\nthree"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("Description:");
    expect(output()).toContain("one");
    expect(output()).toContain("three");
    expect(output()).not.toContain("more lines");
  });

  it("wraps long running-detail field values keeping the box border", () => {
    const state = createInitialState(30000, 10);
    state.running.set(
      "1",
      makeRunningEntry("1", {
        workspace_path: "W".repeat(70),
        model: `anthropic/claude-${"M".repeat(50)}`,
      }),
    );
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain(`│${" ".repeat(16)}${"W".repeat(34)}`);
    expect(output()).toContain(`│${" ".repeat(16)}${"M".repeat(33)}`);
    expect(output()).toContain(`anthropic/claude-${"M".repeat(17)}`);
  });

  it("truncates long tool summaries to a single line keeping the box border", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", { ts: 1, turn: 1, type: "tool_use", tool: "T".repeat(60) });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    const out = output();
    expect(out).toContain(`🔧 ${"T".repeat(34)}…`);
    expect(out).not.toContain(`🔧 ${"T".repeat(35)}`);
  });

  it("shows a one-line summary for tool calls with a title", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      title: "echo hello",
      input: { command: "echo hello" },
      exit: 0,
    });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("🔧 bash · echo hello");
  });

  it("derives the summary from input when title is missing", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "write",
      input: { filePath: "src/a.ts" },
    });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("🔧 write · src/a.ts");
  });

  it("falls back to the bare tool name when no summary is derivable", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", { ts: 1, turn: 1, type: "tool_use", tool: "read" });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("🔧 read");
    expect(output()).not.toContain("🔧 read ·");
  });

  it("marks failed tool calls with a warning icon", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const store = new ActivityStore();
    store.record("1", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      title: "false",
      input: { command: "false" },
      exit: 127,
    });
    const { tui, output } = makeTui(state, store);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.forceRender();
    expect(output()).toContain("✗ bash · false");
    expect(output()).not.toContain("🔧 bash · false");
  });

  it("omits Description block when description is empty or null", () => {
    for (const description of [null, ""]) {
      const state = createInitialState(30000, 10);
      state.running.set(
        "1",
        makeRunningEntry("1", {
          task: {
            id: "1",
            identifier: "ENG-1",
            title: "Fix the login bug",
            description,
            priority: 1,
            state: "In Progress",
            branch_name: null,
            url: null,
            labels: [],
            blocked_by: [],
            assignee: "alice",
            created_at: null,
            updated_at: null,
            source: "jira",
          },
        }),
      );
      const { tui, output } = makeTui(state);
      tui.forceRender();
      tui.handleKey("\r");
      expect(output()).toContain("Fix the login bug");
      expect(output()).not.toContain("Description:");
    }
  });

  it("renders description without trailing blank line for trailing newline", () => {
    const state = createInitialState(30000, 10);
    state.running.set(
      "1",
      makeRunningEntry("1", {
        task: {
          id: "1",
          identifier: "ENG-1",
          title: "Fix the login bug",
          description: "first line\nsecond line\n",
          priority: 1,
          state: "In Progress",
          branch_name: null,
          url: null,
          labels: [],
          blocked_by: [],
          assignee: "alice",
          created_at: null,
          updated_at: null,
          source: "jira",
        },
      }),
    );
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    const esc = String.fromCharCode(27);
    const clean = output().replace(new RegExp(`${esc}\\[[0-9;]*[mKJH]`, "g"), "");
    expect(clean).toContain("second line");
    expect(clean).not.toContain("second line\n│  \n│");
  });

  it("e key expands and collapses the running-detail description", () => {
    const state = createInitialState(30000, 10);
    const description = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
    state.running.set("1", makeDescribedEntry("1", description));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("… (2 more lines)");
    expect(output()).toContain("e expand");
    tui.handleKey("e");
    expect(output()).toContain("line 8");
    expect(output()).not.toContain("more lines");
    expect(output()).toContain("e collapse");
    tui.handleKey("e");
    expect(output()).toContain("… (2 more lines)");
    expect(output()).not.toContain("line 8");
    expect(output()).toContain("e expand");
  });

  it("resets description fold state when re-entering detail", () => {
    const state = createInitialState(30000, 10);
    const description = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
    state.running.set("1", makeDescribedEntry("1", description));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("e");
    expect(output()).toContain("line 8");
    tui.handleKey("q");
    tui.handleKey("\r");
    expect(output()).toContain("… (2 more lines)");
    expect(output()).not.toContain("line 8");
  });

  it("e key has no effect when there is no description", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).not.toContain("Description:");
    tui.handleKey("e");
    expect(output()).not.toContain("Description:");
    expect(output()).toContain("ENG-1");
  });

  it("enters retry detail with Tab then Enter", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    state.retry_attempts.set("2", {
      task_id: "2",
      identifier: "ENG-2",
      attempt: 3,
      due_at_ms: Date.now() + 5000,
      timer: null,
      error: "turn 2 exited with code 1",
      continuation: false,
      session_id: null,
    });
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\t");
    tui.handleKey("\r");
    expect(output()).toContain("ENG-2");
    expect(output()).toContain("Attempt:");
    expect(output()).toContain("3");
    expect(output()).toContain("turn 2 exited with code 1");
  });

  it("returns to overview with Esc from running detail", () => {
    vi.useFakeTimers();
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    tui.handleKey("\x1b");
    vi.advanceTimersByTime(60);
    expect(output()).toContain("tasking");
    expect(output()).toContain("Running");
    vi.useRealTimers();
  });

  it("returns to overview with q from retry detail", () => {
    const state = createInitialState(30000, 10);
    state.retry_attempts.set("2", {
      task_id: "2",
      identifier: "ENG-2",
      attempt: 1,
      due_at_ms: Date.now() + 5000,
      timer: null,
      error: "fail",
      continuation: false,
      session_id: null,
    });
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\t");
    tui.handleKey("\r");
    tui.handleKey("q");
    expect(output()).toContain("Running");
  });

  it("keeps selection pinned to task when running list reorders", () => {
    const state = createInitialState(30000, 10);
    state.running.set("19", makeRunningEntry("19"));
    state.running.set("20", makeRunningEntry("20"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("j");
    tui.forceRender();
    expect(output()).toContain("ENG-20");
    // TAS-19's continuation re-dispatch removes then re-adds it at the end,
    // reordering the list to [ENG-20, ENG-19] between render ticks.
    state.running.delete("19");
    state.running.set("19", makeRunningEntry("19"));
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("ENG-20");
    expect(output()).not.toContain("ENG-19");
    expect(output()).toContain("Workspace:");
  });

  it("keeps selection pinned to task when a task is removed from the list", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    state.running.set("2", makeRunningEntry("2"));
    state.running.set("3", makeRunningEntry("3"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("j");
    tui.handleKey("j");
    tui.forceRender();
    expect(output()).toContain("ENG-3");
    state.running.delete("3");
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("ENG-2");
  });

  it("activity view does not show stale events from a previously viewed task", async () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    state.running.set("2", makeRunningEntry("2"));
    let output = "";
    const fetchActivity = vi.fn(async (taskId: string) =>
      taskId === "1"
        ? [{ ts: 1, turn: 1, type: "text", text: "ENG-1 event" }]
        : [{ ts: 1, turn: 1, type: "text", text: "ENG-2 event" }],
    );
    const tui = new TerminalDashboard({
      fetchSnapshot: async () => buildSnapshot(state),
      fetchActivity,
      logger,
      renderFn: (c) => {
        output = c;
      },
    });
    tui.forceRender();
    await vi.waitFor(() => expect(output).toContain("ENG-1"));
    tui.handleKey("\r"); // ENG-1 detail
    tui.handleKey("a"); // ENG-1 activity
    await vi.waitFor(() => expect(output).toContain("ENG-1 event"));
    tui.handleKey("q"); // back to ENG-1 detail
    tui.handleKey("q"); // back to overview
    tui.handleKey("j"); // move to ENG-2
    tui.handleKey("\r"); // ENG-2 detail
    tui.handleKey("a"); // ENG-2 activity
    await vi.waitFor(() => expect(output).toContain("ENG-2 event"));
    expect(output).not.toContain("ENG-1 event");
  });

  it("shows keybinding help line in overview", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    expect(output()).toContain("navigate");
    expect(output()).toContain("Enter");
    expect(output()).toContain("Tab");
  });

  it("shows back hint in detail mode", () => {
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const { tui, output } = makeTui(state);
    tui.forceRender();
    tui.handleKey("\r");
    expect(output()).toContain("Esc");
    expect(output()).toContain("back");
  });

  it("renders Logs section when logBuffer has entries", () => {
    const logBuffer = new LogRingBuffer(50);
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:30:45.000Z", level: "info", msg: "daemon started" }),
    );
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:31:00.000Z", level: "warn", msg: "poll failed" }),
    );
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:31:05.000Z", level: "error", msg: "worker crashed" }),
    );
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
    });
    tui.forceRender();
    expect(output).toContain("├─ Logs");
    expect(output).toContain("daemon started");
    expect(output).toContain("poll failed");
    expect(output).toContain("worker crashed");
    expect(output).toContain("WARN");
    expect(output).toContain("ERROR");
  });

  it("omits Logs section when logBuffer is not provided", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    expect(output()).not.toContain("├─ Logs");
  });

  it("shows placeholder when logBuffer is empty", () => {
    const logBuffer = new LogRingBuffer(50);
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
    });
    tui.forceRender();
    expect(output).toContain("├─ Logs");
    expect(output).toContain("No recent logs");
  });

  it("enters logs mode with L key", () => {
    const logBuffer = new LogRingBuffer(50);
    for (let i = 0; i < 20; i++) {
      logBuffer.push(
        JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: `line ${i}` }),
      );
    }
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
    });
    tui.forceRender();
    tui.handleKey("L");
    expect(output).toContain("Logs");
    expect(output).toContain("[follow]");
    expect(output).toContain("line 19");
  });

  it("scrolls in logs mode and disables follow", () => {
    const logBuffer = new LogRingBuffer(50);
    for (let i = 0; i < 40; i++) {
      logBuffer.push(
        JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: `entry ${i}` }),
      );
    }
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
    });
    tui.forceRender();
    tui.handleKey("L");
    expect(output).toContain("[follow]");
    tui.handleKey("k");
    expect(output).not.toContain("[follow]");
  });

  it("scrolls down toward newer entries and up toward older in logs view", () => {
    const { tui, output } = makeLogsTui(lines(0, 60, "scr"));
    tui.forceRender();
    tui.handleKey("L");
    expect(output()).toContain("scr 59");
    tui.handleKey("\x1b[A");
    expect(output()).toContain("[paused]");
    expect(output()).toContain("scr 29");
    expect(output()).not.toContain("scr 59");
    tui.handleKey("\x1b[B");
    expect(output()).toContain("scr 59");
    expect(output()).not.toContain("scr 29");
    tui.handleKey("\x1b[A");
    expect(output()).toContain("scr 29");
    expect(output()).not.toContain("scr 59");
  });

  it("renders structured log fields so a turn's command is visible", () => {
    const logBuffer = new LogRingBuffer(500);
    logBuffer.push(
      JSON.stringify({
        ts: "2026-01-01T10:00:00.000Z",
        level: "info",
        msg: "direct turn starting",
        root_id: "om_1",
        agent: "build",
        auto_approve: false,
        continuation: true,
        cmd: "opencode run --format json -s ses_x --dir /repo --agent build 谢谢",
      }),
    );
    let output = "";
    const tui = new TerminalDashboard({
      state: () => createInitialState(30000, 10),
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
      terminalWidth: () => 200,
    });
    tui.forceRender();
    tui.handleKey("L");
    const out = output;
    expect(out).toContain("direct turn starting");
    expect(out).toContain("auto_approve=false");
    expect(out).toContain("cmd=opencode run --format json");
    expect(out.indexOf("auto_approve=")).toBeLessThan(out.indexOf("cmd="));
  });

  it("scroll clamps at both edges of the logs view", () => {
    const { tui, output } = makeLogsTui(lines(0, 60, "scr"));
    tui.forceRender();
    tui.handleKey("L");
    tui.handleKey("\x1b[B");
    expect(output()).toContain("[paused]");
    expect(output()).toContain("scr 59");
    for (let i = 0; i < 35; i++) {
      tui.handleKey("\x1b[A");
    }
    expect(output()).toContain("scr 0");
    expect(output()).not.toContain("scr 59");
  });

  it("pressing f pauses the logs view and new arrivals do not scroll it", () => {
    const { tui, output, logBuffer } = makeLogsTui(lines(0, 40, "line"));
    tui.forceRender();
    tui.handleKey("L");
    expect(output()).toContain("[follow]");
    expect(output()).toContain("line 39");
    tui.handleKey("f");
    expect(output()).toContain("[paused]");
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: "line 40" }),
    );
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: "line 41" }),
    );
    tui.forceRender();
    expect(output()).not.toContain("line 40");
    expect(output()).not.toContain("line 41");
    expect(output()).toContain("line 39");
  });

  it("pressing Space pauses the logs view and new arrivals do not scroll it", () => {
    const { tui, output, logBuffer } = makeLogsTui(lines(0, 40, "space"));
    tui.forceRender();
    tui.handleKey("L");
    expect(output()).toContain("space 39");
    tui.handleKey(" ");
    expect(output()).toContain("[paused]");
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: "space 40" }),
    );
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: "space 41" }),
    );
    tui.forceRender();
    expect(output()).not.toContain("space 40");
    expect(output()).not.toContain("space 41");
    expect(output()).toContain("space 39");
  });

  it("paused logs view stays stable once the recent(200) window rolls", () => {
    const { tui, output, logBuffer } = makeLogsTui(lines(0, 260, "roll"));
    tui.forceRender();
    tui.handleKey("L");
    expect(output()).toContain("[follow]");
    expect(output()).toContain("roll 259");
    tui.handleKey("f");
    expect(output()).toContain("[paused]");
    for (const msg of lines(260, 265, "roll")) {
      logBuffer.push(JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg }));
    }
    tui.forceRender();
    expect(output()).not.toContain("roll 260");
    expect(output()).toContain("roll 259");
  });

  it("paused logs view re-pins to the oldest entry when the pinned one rolls out", () => {
    const { tui, output, logBuffer } = makeLogsTui(lines(0, 260, "roll"));
    tui.forceRender();
    tui.handleKey("L");
    expect(output()).toContain("roll 259");
    tui.handleKey("f"); // pinned top = roll 230
    expect(output()).toContain("[paused]");
    for (const msg of lines(260, 435, "roll")) {
      logBuffer.push(JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg }));
    }
    tui.forceRender();
    expect(output()).toContain("roll 235"); // oldest still in the window
    expect(output()).not.toContain("roll 434"); // does NOT jump to the newest tail
  });

  it("pausing an empty logs view keeps it following", () => {
    const { tui, output } = makeLogsTui([]);
    tui.forceRender();
    tui.handleKey("L");
    expect(output()).toContain("[follow]");
    tui.handleKey("f");
    expect(output()).not.toContain("[paused]");
  });

  it("resuming follow after pause shows the newest logs", () => {
    const { tui, output, logBuffer } = makeLogsTui(lines(0, 40, "resume"));
    tui.forceRender();
    tui.handleKey("L");
    tui.handleKey("f");
    expect(output()).toContain("[paused]");
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: "resume 40" }),
    );
    tui.forceRender();
    expect(output()).not.toContain("resume 40");
    tui.handleKey("f");
    expect(output()).toContain("[follow]");
    expect(output()).toContain("resume 40");
  });

  it("returns to overview from logs with Esc", () => {
    const logBuffer = new LogRingBuffer(50);
    logBuffer.push(JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: "test" }));
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
    });
    tui.forceRender();
    tui.handleKey("L");
    expect(output).toContain("Logs");
    tui.handleKey("q");
    expect(output).toContain("Running");
    expect(output).not.toContain("[follow]");
  });

  it("level key 1 reveals debug logs without mutating the buffer", () => {
    const logBuffer = new LogRingBuffer(50);
    logBuffer.setMinLevel("debug");
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "debug", msg: "a debug line" }),
    );
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:01.000Z", level: "info", msg: "an info line" }),
    );
    const setMinLevel = vi.spyOn(logBuffer, "setMinLevel");
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
    });
    tui.forceRender();
    tui.handleKey("L");
    expect(output).toContain("an info line");
    expect(output).not.toContain("a debug line");
    tui.handleKey("1");
    expect(output).toContain("a debug line");
    expect(setMinLevel).not.toHaveBeenCalled();
  });

  it("search highlights matches in logs mode", () => {
    const logBuffer = new LogRingBuffer(50);
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:00.000Z", level: "info", msg: "hello world" }),
    );
    logBuffer.push(
      JSON.stringify({ ts: "2026-01-01T10:00:01.000Z", level: "warn", msg: "goodbye world" }),
    );
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      logBuffer,
    });
    tui.forceRender();
    tui.handleKey("L");
    tui.handleKey("/");
    tui.handleKey("g");
    tui.handleKey("o");
    tui.handleKey("o");
    tui.handleKey("d");
    expect(output).toContain("/good");
    tui.handleKey("\r");
    expect(output).toContain("/good");
    expect(output).toContain("goodbye");
  });

  it("does not enter logs mode without logBuffer", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    tui.handleKey("L");
    expect(output()).toContain("Running");
    expect(output()).not.toContain("[follow]");
  });
});

describe("TerminalDashboard config view", () => {
  const configView = (): ConfigView => ({
    config: {
      tracker: { api_key: "****", endpoint: "http://jira.example", active_states: ["待办"] },
      env: { GITLAB_TOKEN: "****" },
    },
    runtime: {
      pid: 42,
      started_at: Date.now() - 60000,
      workflow_path: "/repo/WORKFLOW.md",
      workspace_root: "/repo/tasking_workspaces",
      log_path: "/repo/tasking.log",
      host: "0.0.0.0",
      port: 8080,
    },
  });

  function makeConfigTui(state = createInitialState(30000, 10)) {
    let output = "";
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      configView,
    });
    return { tui, output: () => output };
  }

  it("enters config view on c and shows runtime + masked secrets", () => {
    const { tui, output } = makeConfigTui();
    tui.forceRender();
    tui.handleKey("c");
    expect(output()).toContain("Config");
    expect(output()).toContain("/repo/WORKFLOW.md");
    expect(output()).toContain("Daemon pid");
    expect(output()).toContain("42");
    expect(output()).toContain("/repo/tasking_workspaces");
    expect(output()).toContain("api_key");
    expect(output()).toContain("****");
    expect(output()).toContain("http://jira.example");
  });

  it("returns to overview on Esc/q", () => {
    const { tui, output } = makeConfigTui();
    tui.forceRender();
    tui.handleKey("c");
    expect(output()).toContain("Config");
    tui.handleKey("q");
    expect(output()).toContain("Agents:");
    expect(output()).not.toContain("Workflow root");
  });

  it("renders unset secret values as 未配置", () => {
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      configView: () => ({
        config: {
          tracker: { api_key: null, assignee: null, endpoint: "http://jira.example" },
        },
        runtime: {
          pid: 42,
          started_at: null,
          workflow_path: null,
          workspace_root: null,
          log_path: null,
          host: null,
          port: null,
        },
      }),
    });
    tui.forceRender();
    tui.handleKey("c");
    expect(output).toContain("api_key");
    expect(output).toContain("未配置");
    expect(output).toContain("http://jira.example");
  });

  it("renders unset values as 'not set' when interface_language is en", () => {
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      state: () => state,
      logger,
      renderFn: (c) => {
        output = c;
      },
      configView: () => ({
        config: {
          interface_language: "en",
          tracker: { api_key: null, assignee: null, endpoint: "http://jira.example" },
        },
        runtime: {
          pid: 42,
          started_at: null,
          workflow_path: null,
          workspace_root: null,
          log_path: null,
          host: null,
          port: null,
        },
      }),
    });
    try {
      tui.forceRender();
      tui.handleKey("c");
      expect(output).toContain("not set");
      expect(output).not.toContain("未配置");
      expect(output).toContain("http://jira.example");
    } finally {
      setLocale("zh");
    }
  });

  it("does not enter config mode without a config source", () => {
    const { tui, output } = makeTui();
    tui.forceRender();
    tui.handleKey("c");
    expect(output()).toContain("Running");
    expect(output()).not.toContain("Daemon pid");
  });

  it("hints C config in overview footer when config source exists", () => {
    const { tui, output } = makeConfigTui();
    tui.forceRender();
    expect(output()).toContain("C config");
  });

  it("renders config from fetchConfig source", async () => {
    let output = "";
    const state = createInitialState(30000, 10);
    const tui = new TerminalDashboard({
      fetchSnapshot: async () => ({
        generated_at: Date.now(),
        max_concurrent_agents: 10,
        counts: { running: 0, retrying: 0 },
        running: [],
        retrying: [],
        totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
      }),
      fetchConfig: async () => configView(),
      logger,
      renderFn: (c) => {
        output = c;
      },
    });
    tui.forceRender();
    await new Promise((r) => setTimeout(r, 20));
    tui.handleKey("c");
    await new Promise((r) => setTimeout(r, 20));
    expect(output).toContain("Config");
    expect(output).toContain("/repo/WORKFLOW.md");
    expect(output).toContain("****");
  });

  it("activity view uses fetchActivity in remote (async) mode", async () => {
    let output = "";
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    const events = [
      { ts: 1, turn: 1, type: "text", text: "remote hello" },
      { ts: 2, turn: 1, type: "tool_use", tool: "write" },
    ];
    const tui = new TerminalDashboard({
      fetchSnapshot: async () => buildSnapshot(state),
      fetchActivity: async () => events,
      logger,
      renderFn: (c) => {
        output = c;
      },
    });
    tui.forceRender();
    await new Promise((r) => setTimeout(r, 20));
    tui.handleKey("\r"); // enter detail-running (needs lastSnapshot, now set)
    await new Promise((r) => setTimeout(r, 20));
    tui.handleKey("a"); // -> activity
    tui.forceRender();
    await new Promise((r) => setTimeout(r, 20));
    expect(output).toContain("Activity");
    expect(output).toContain("remote hello");
    expect(output).toContain("write");
    expect(output).toContain("anthropic/claude-sonnet-4-5"); // header model from snapshot row
  });

  it("settles on the correct view after rapid async navigation (detail→activity→detail→overview→detail)", async () => {
    let output = "";
    const state = createInitialState(30000, 10);
    state.running.set("1", makeRunningEntry("1"));
    state.running.set("2", makeRunningEntry("2"));
    const tui = new TerminalDashboard({
      fetchSnapshot: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return buildSnapshot(state);
      },
      fetchActivity: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return [{ ts: 1, turn: 1, type: "text", text: "ACTIVITY EVENT" }];
      },
      logger,
      renderFn: (c) => {
        output = c;
      },
    });
    tui.forceRender();
    await new Promise((r) => setTimeout(r, 20));
    // press keys faster than the async renders complete
    tui.handleKey("\r"); // ENG-1 detail
    tui.handleKey("a"); // ENG-1 activity
    tui.handleKey("q"); // back to detail
    tui.handleKey("q"); // back to overview
    tui.handleKey("\r"); // reopen ENG-1 detail
    await new Promise((r) => setTimeout(r, 120));
    expect(output).toContain("Workspace:");
    expect(output).not.toContain("ACTIVITY EVENT");
  });
});

describe("TerminalDashboard direct sessions", () => {
  const esc = String.fromCharCode(27);
  const plain = (s: string): string => s.replace(new RegExp(`${esc}\\[[0-9;]*[A-Za-z]`, "g"), "");
  const direct = (): RuntimeDirectSession[] => [
    {
      id: "direct:om_x",
      root_id: "om_x",
      name: "介绍一下 zhipu",
      project: "tasking",
      path: "/repos/tasking",
      status: "running",
      session_id: "ses_direct",
      queued: 2,
      updated_at: Date.now() - 5000,
      agent: "build",
      model: "deepseek/deepseek-v4-flash",
      variant: null,
      turns: 3,
      input_tokens: 1000,
      output_tokens: 200,
      total_tokens: 1200,
    },
  ];

  it("renders a direct sessions block only when present", () => {
    const empty = makeTui();
    empty.tui.forceRender();
    expect(plain(empty.output())).not.toContain("Direct sessions");

    const withDirect = makeTui(createInitialState(30000, 10), undefined, undefined, direct);
    withDirect.tui.forceRender();
    expect(plain(withDirect.output())).toContain("Direct sessions");
    expect(plain(withDirect.output())).toContain("介绍一下 zhipu");
    expect(plain(withDirect.output())).toContain("running");
  });

  it("Tab cycles running -> backoff -> direct and highlights the focused block", () => {
    const { tui, output } = makeTui(createInitialState(30000, 10), undefined, undefined, direct);
    tui.forceRender();
    expect(plain(output())).toContain("Running ◄");
    tui.handleKey("\t");
    expect(plain(output())).toContain("Backoff queue ◄");
    tui.handleKey("\t");
    expect(plain(output())).toContain("Direct sessions (1 · 1 running) ◄");
    tui.handleKey("\t");
    expect(plain(output())).toContain("Running ◄");
  });

  it("opens direct detail and reuses the activity view", () => {
    const store = new ActivityStore();
    store.record("direct:om_x", { ts: 1, turn: 1, type: "text", text: "HELLO_DIRECT" });
    const { tui, output } = makeTui(createInitialState(30000, 10), store, undefined, direct);
    tui.forceRender();
    tui.handleKey("\t");
    tui.handleKey("\t");
    tui.handleKey("\r");
    expect(plain(output())).toContain("feishu direct");
    expect(plain(output())).toContain("/repos/tasking");
    expect(plain(output())).toContain("a activity");
    tui.handleKey("a");
    expect(plain(output())).toContain("HELLO_DIRECT");
    tui.handleKey("q");
    expect(plain(output())).toContain("feishu direct");
  });

  it("does not leave focus stranded when the direct block disappears", () => {
    let list = direct();
    const { tui, output } = makeTui(
      createInitialState(30000, 10),
      undefined,
      undefined,
      () => list,
    );
    tui.forceRender();
    tui.handleKey("\t");
    tui.handleKey("\t");
    expect(plain(output())).toContain("Direct sessions (1 · 1 running) ◄");
    list = [];
    tui.forceRender();
    expect(plain(output())).not.toContain("Direct sessions");
    expect(plain(output())).toContain("Running ◄");
  });
});

describe("TerminalDashboard direct session details", () => {
  const esc = String.fromCharCode(27);
  const plain = (s: string): string => s.replace(new RegExp(`${esc}\\[[0-9;]*[A-Za-z]`, "g"), "");
  const direct = (): RuntimeDirectSession[] => [
    {
      id: "direct:om_x",
      root_id: "om_x",
      name: "介绍一下 zhipu",
      project: null,
      path: "/home/xjiang3",
      status: "idle",
      session_id: "ses_direct",
      queued: 0,
      updated_at: Date.now() - 5000,
      agent: "build",
      model: "deepseek/deepseek-v4-flash",
      variant: null,
      turns: 3,
      input_tokens: 1000,
      output_tokens: 200,
      total_tokens: 1200,
    },
  ];
  const totals = () => ({ input_tokens: 4000, output_tokens: 1000, total_tokens: 5000 });

  it("shows the session name, per-session tokens, and the session count", () => {
    const { tui, output } = makeTui(createInitialState(30000, 10), undefined, undefined, direct);
    tui.forceRender();
    const p = plain(output());
    expect(p).toContain("Direct sessions (1)");
    expect(p).toContain("介绍一下 zhipu");
    expect(p).toContain("1,200");
  });

  it("folds direct tokens into the home totals line", () => {
    const { tui, output } = makeTui(
      createInitialState(30000, 10),
      undefined,
      undefined,
      direct,
      totals,
    );
    tui.forceRender();
    expect(plain(output())).toContain("5,000");
  });

  it("direct detail renders Name/Agent/Model/Turns/Tokens", () => {
    const { tui, output } = makeTui(createInitialState(30000, 10), undefined, undefined, direct);
    tui.forceRender();
    tui.handleKey("\t");
    tui.handleKey("\t");
    tui.handleKey("\r");
    const p = plain(output());
    expect(p).toContain("介绍一下 zhipu");
    expect(p).toContain("feishu direct");
    expect(p).toContain("Agent:");
    expect(p).toContain("build");
    expect(p).toContain("deepseek/deepseek-v4-flash");
    expect(p).toContain("Turns:");
    expect(p).toContain("1,200");
  });

  it("activity header renders agent/model/turn/tokens for a direct session", () => {
    const store = new ActivityStore();
    store.record("direct:om_x", { ts: 1, turn: 1, type: "text", text: "hello" });
    const { tui, output } = makeTui(createInitialState(30000, 10), store, undefined, direct);
    tui.forceRender();
    tui.handleKey("\t");
    tui.handleKey("\t");
    tui.handleKey("\r");
    tui.handleKey("a");
    const p = plain(output());
    expect(p).toContain("Activity");
    expect(p).toContain("Agent:");
    expect(p).toContain("deepseek/deepseek-v4-flash");
    expect(p).toContain("Turn:");
    expect(p).toContain("1,200");
  });
});

describe("TerminalDashboard direct activity detail", () => {
  const esc = String.fromCharCode(27);
  const plain = (s: string): string => s.replace(new RegExp(`${esc}\\[[0-9;]*[A-Za-z]`, "g"), "");
  const direct = (): RuntimeDirectSession[] => [
    {
      id: "direct:om_x",
      root_id: "om_x",
      name: "跑个命令",
      project: null,
      path: "/home/xjiang3",
      status: "idle",
      session_id: "ses_direct",
      queued: 0,
      updated_at: 0,
      agent: "build",
      model: null,
      variant: null,
      turns: 1,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  ];

  it("shows tool command and output in the activity detail body", () => {
    const store = new ActivityStore();
    store.record("direct:om_x", {
      ts: 1,
      turn: 1,
      type: "tool_use",
      tool: "bash",
      title: "ls -la",
      status: "completed",
      input: { command: "ls -la" },
      output: "file1\nfile2",
    });
    const { tui, output } = makeTui(createInitialState(30000, 10), store, undefined, direct);
    tui.forceRender();
    tui.handleKey("\t");
    tui.handleKey("\t");
    tui.handleKey("\r");
    tui.handleKey("a");
    tui.handleKey("\r");
    const p = plain(output());
    expect(p).toContain("Command:");
    expect(p).toContain("ls -la");
    expect(p).toContain("Output:");
    expect(p).toContain("file1");
  });
});

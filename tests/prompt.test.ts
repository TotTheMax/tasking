import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkflowContent } from "../src/config/loader.js";
import { TaskingError } from "../src/shared/errors.js";
import type { Task } from "../src/shared/types.js";
import {
  buildContinuationGuidance,
  capTaskDescription,
  renderPrompt,
} from "../src/worker/prompt.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1",
    identifier: "ABC-123",
    title: "Fix bug",
    description: "the bug",
    priority: 2,
    state: "In Progress",
    branch_name: null,
    url: null,
    labels: ["bug"],
    blocked_by: [],
    assignee: null,
    created_at: null,
    updated_at: null,
    source: "jira",
    ...overrides,
  };
}

const TERMINAL_STATES = "Done, Closed, Cancelled";
const ACTIVE_STATES = "待办, 处理中, 合并中, 重置处理";
const REVIEW_STATE = "代码评审中";

function ctx(
  overrides: Partial<{
    task: Task;
    attempt: number | null;
    terminal_states: string;
    active_states: string;
    review_state: string;
  }> = {},
) {
  return {
    task: makeTask(),
    attempt: null as number | null,
    terminal_states: TERMINAL_STATES,
    active_states: ACTIVE_STATES,
    review_state: REVIEW_STATE,
    ...overrides,
  };
}

function readExamplePromptBody(): string {
  const path = join(process.cwd(), "assets/workflows/WORKFLOW.minimal.md.example");
  const content = readFileSync(path, "utf8");
  const parts = content.split("---");
  return parts.slice(2).join("---").trim();
}

function readCodeMrPromptBody(): string {
  const path = join(process.cwd(), "assets/workflows/WORKFLOW.code-mr.md.example");
  const content = readFileSync(path, "utf8");
  const parts = content.split("---");
  return parts.slice(2).join("---").trim();
}

function readExampleFrontmatter(): string {
  const path = join(process.cwd(), "assets/workflows/WORKFLOW.minimal.md.example");
  const content = readFileSync(path, "utf8");
  const parts = content.split("---");
  return parts.length >= 2 ? (parts[1] ?? "") : "";
}

describe("capTaskDescription", () => {
  it("trims oversized descriptions with a marker", () => {
    const task = {
      id: "1",
      identifier: "ENG-1",
      title: "t",
      description: "y".repeat(50_000),
      priority: 1,
      state: "To Do",
      source: "jira",
      url: null,
      branch_name: null,
      assignee: null,
    } as never;
    const capped = capTaskDescription(task);
    expect((capped.description as string).length).toBeLessThan(41_200);
    expect(capped.description).toContain("truncated by tasking");
    expect(task.description.length).toBe(50_000);
  });

  it("keeps normal descriptions untouched", () => {
    const task = { description: "short" } as never;
    expect(capTaskDescription(task).description).toBe("short");
  });
});

describe("renderPrompt", () => {
  it("renders task and attempt on first attempt", () => {
    const out = renderPrompt(
      "{{ task.identifier }} - {{ task.title }} (attempt {{ attempt }})",
      ctx({ attempt: null }),
    );
    expect(out).toContain("ABC-123 - Fix bug");
    expect(out).toContain("attempt ");
  });

  it("renders attempt on retry", () => {
    const out = renderPrompt("attempt={{ attempt }}", ctx({ attempt: 3 }));
    expect(out).toBe("attempt=3");
  });

  it("renders issue alias for task", () => {
    const out = renderPrompt("{{ issue.identifier }}", ctx());
    expect(out).toBe("ABC-123");
  });

  it("renders terminal_states", () => {
    const out = renderPrompt(
      "Terminal: {{ terminal_states }}",
      ctx({ terminal_states: "Done, Closed, Cancelled" }),
    );
    expect(out).toBe("Terminal: Done, Closed, Cancelled");
  });

  it("renders active_states", () => {
    const out = renderPrompt(
      "Active: {{ active_states }}",
      ctx({ active_states: "待办, 处理中, 合并中, 重置处理" }),
    );
    expect(out).toBe("Active: 待办, 处理中, 合并中, 重置处理");
  });

  it("renders review_state", () => {
    const out = renderPrompt("Review: {{ review_state }}", ctx({ review_state: "代码评审中" }));
    expect(out).toBe("Review: 代码评审中");
  });

  it("fails on unknown variable", () => {
    expect(() => renderPrompt("{{ unknown }}", ctx())).toThrow(TaskingError);
  });

  it("fails on unknown filter", () => {
    expect(() => renderPrompt("{{ task.title | bogusfilter }}", ctx())).toThrow(TaskingError);
  });

  it("falls back to default prompt when body empty", () => {
    const out = renderPrompt("   ", ctx());
    expect(out).toContain("working on an issue");
  });

  it("renders if block true branch", () => {
    const tpl = "{% if task.description %}has desc: {{ task.description }}{% endif %}";
    const out = renderPrompt(tpl, ctx({ task: makeTask({ description: "details" }) }));
    expect(out).toBe("has desc: details");
  });

  it("renders if block false branch via else", () => {
    const tpl = "{% if task.description %}has{% else %}none{% endif %}";
    const out = renderPrompt(tpl, ctx({ task: makeTask({ description: null }) }));
    expect(out).toBe("none");
  });

  it("renders terminal_states in template", () => {
    const tpl = "Do NOT transition to ({{ terminal_states }})";
    const out = renderPrompt(tpl, ctx({ terminal_states: "Done, Closed" }));
    expect(out).toContain("Done, Closed");
  });

  it("renders active_states in template", () => {
    const tpl = "Active states: ({{ active_states }})";
    const out = renderPrompt(tpl, ctx({ active_states: "待办, 处理中" }));
    expect(out).toContain("待办, 处理中");
  });

  it("renders review_state in template", () => {
    const tpl = "Transition to {{ review_state }}";
    const out = renderPrompt(tpl, ctx({ review_state: "代码评审中" }));
    expect(out).toContain("代码评审中");
  });

  it("renders empty string when review_state is empty", () => {
    const out = renderPrompt("Review: [{{ review_state }}]", ctx({ review_state: "" }));
    expect(out).toBe("Review: []");
  });
});

describe("assets/workflows/WORKFLOW.code-mr.md.example prompt body", () => {
  const body = readCodeMrPromptBody();

  it("renders without error on first attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("ABC-123");
  });

  it("renders without error on retry attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: 2 }));
    expect(out).toContain("attempt 2");
  });

  it("renders terminal_states", () => {
    const out = renderPrompt(body, ctx({ terminal_states: "Done, Closed, Cancelled" }));
    expect(out).toContain("Done, Closed, Cancelled");
  });

  it("renders active_states", () => {
    const out = renderPrompt(body, ctx({ active_states: "待办, 处理中, 合并中, 重置处理" }));
    expect(out).toContain("待办, 处理中, 合并中, 重置处理");
  });

  it("renders review_state", () => {
    const out = renderPrompt(body, ctx({ review_state: "代码评审中" }));
    expect(out).toContain("代码评审中");
  });

  it("renders without error when review_state is empty", () => {
    const out = renderPrompt(body, ctx({ review_state: "" }));
    expect(out).toContain("ABC-123");
    expect(out).not.toContain("代码评审中");
  });

  it("contains State Flow section", () => {
    expect(body).toContain("State Flow");
  });

  it("State Flow explains three-layer model", () => {
    expect(body).toContain("Active");
    expect(body).toContain("Review");
    expect(body).toContain("Terminal");
  });

  it("State Flow contains dual-path review handling", () => {
    expect(body).toContain("Incremental fix");
    expect(body).toContain("Full reset");
  });

  it("contains explicit state transition guidance in steps", () => {
    expect(body.toLowerCase()).toContain("transition");
    expect(body).toContain("in-progress active state");
    expect(body).toContain(review_state_pattern());
  });

  it("contains re-dispatch routing guidance", () => {
    expect(body).toContain("incremental fix");
    expect(body).toContain("full reset");
    expect(body).toContain("`land` skill");
  });

  it("references jira_rest MCP tool on first attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("jira_rest");
  });

  it("references land skill on retry attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: 1 }));
    expect(out).toContain("`land`");
  });

  it("first attempt prompts to sync branch", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out.toLowerCase()).toContain("sync");
    expect(out.toLowerCase()).toContain("origin/main");
  });

  it("first attempt prompts to create MR", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("MR");
  });

  it("first attempt prompts to create commit", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out.toLowerCase()).toContain("commit");
  });

  it("retry attempt prompts to check Jira state", () => {
    const out = renderPrompt(body, ctx({ attempt: 1 }));
    expect(out).toContain("Jira state");
  });

  it("does not contain needs-review label", () => {
    expect(body).not.toContain("needs-review");
  });

  it("does not contain raw git add command", () => {
    expect(body).not.toContain("git add -A");
  });

  it("does not contain raw git commit command", () => {
    expect(body).not.toContain("git commit -m");
  });

  it("does not contain raw git push command", () => {
    expect(body).not.toContain("git push");
  });

  it("does not contain inline jira_rest API path examples", () => {
    expect(body).not.toContain('jira_rest({ method: "GET"');
    expect(body).not.toContain('jira_rest({ method: "POST"');
    expect(body).not.toContain('jira_rest({ method: "PUT"');
  });

  it("contains review_state template variable", () => {
    expect(body).toContain("{{ review_state }}");
  });

  it("does not contain jira_upload_attachment inline example", () => {
    expect(body).not.toContain("jira_upload_attachment({");
  });

  it("instructs MR discussion thread resolution in re-dispatch review", () => {
    expect(body).toContain("discussion threads");
    expect(body).toContain("resolve");
    expect(body).toContain("land");
  });

  it("contains the code-mr sentinel marker", () => {
    expect(body).toContain("<!-- tasking-workflow: code-mr -->");
  });
});

describe("assets/workflows/WORKFLOW.minimal.md.example prompt body (minimal default)", () => {
  const body = readExamplePromptBody();

  it("renders without error on first attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("ABC-123");
  });

  it("renders without error on retry attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: 2 }));
    expect(out).toContain("ABC-123");
  });

  it("renders active_states", () => {
    const out = renderPrompt(body, ctx({ active_states: "待办, 处理中" }));
    expect(out).toContain("待办, 处理中");
  });

  it("renders terminal_states", () => {
    const out = renderPrompt(body, ctx({ terminal_states: "完成, 关闭, 取消" }));
    expect(out).toContain("完成, 关闭, 取消");
  });

  it("renders without error when review_state is empty", () => {
    const out = renderPrompt(body, ctx({ review_state: "" }));
    expect(out).toContain("ABC-123");
    expect(out).not.toContain("代码评审中");
  });

  it("does not reference git branch / MR / glab / land", () => {
    expect(body).not.toContain("glab mr create");
    expect(body).not.toContain("feature branch");
    expect(body).not.toContain("`land`");
    expect(body).not.toContain("State Flow");
  });

  it("references jira_rest for uploading results", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("jira_rest");
  });

  it("references jira_upload_attachment for output files", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("jira_upload_attachment");
  });

  it("does not contain grill or code-mr sentinel markers", () => {
    expect(body).not.toContain("## 🔍 拷问 / Grill Questions");
    expect(body).not.toContain("<!-- tasking-workflow: code-mr -->");
  });

  it("instructs transition to in-progress and to terminal", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out.toLowerCase()).toContain("transition");
    expect(out).toContain("in progress");
    expect(out).toContain("terminal");
  });

  it("does not contain inline jira_rest API path examples", () => {
    expect(body).not.toContain('jira_rest({ method: "GET"');
    expect(body).not.toContain('jira_rest({ method: "POST"');
  });

  it("frontmatter sets review_state to null and trims state lists", () => {
    const fm = readExampleFrontmatter();
    expect(fm).toMatch(/review_state:\s*null/);
    expect(fm).not.toMatch(/review_state:\s*代码评审中/);
  });
});

function readGrillPromptBody(): string {
  const path = join(process.cwd(), "assets/workflows/WORKFLOW.grill-openspec.md.example");
  const content = readFileSync(path, "utf8");
  const parts = content.split("---");
  return parts.slice(2).join("---").trim();
}

describe("assets/workflows/WORKFLOW.grill-openspec.md.example prompt body", () => {
  const body = readGrillPromptBody();

  it("renders without error on first attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("ABC-123");
  });

  it("renders without error on retry attempt", () => {
    const out = renderPrompt(body, ctx({ attempt: 2 }));
    expect(out).toContain("ABC-123");
  });

  it("renders active_states", () => {
    const out = renderPrompt(body, ctx({ active_states: "待办, 处理中, 合并中, 重置处理" }));
    expect(out).toContain("待办, 处理中, 合并中, 重置处理");
  });

  it("renders review_state", () => {
    const out = renderPrompt(body, ctx({ review_state: "代码评审中" }));
    expect(out).toContain("代码评审中");
  });

  it("renders terminal_states", () => {
    const out = renderPrompt(body, ctx({ terminal_states: "完成, 关闭, 取消" }));
    expect(out).toContain("完成, 关闭, 取消");
  });

  it("renders without error when review_state is empty", () => {
    const out = renderPrompt(body, ctx({ review_state: "" }));
    expect(out).toContain("ABC-123");
  });

  it("contains the four phase keywords (grill/拷问/实施/合并/archive)", () => {
    const out = renderPrompt(body, ctx({ attempt: null }));
    expect(out).toContain("grill");
    expect(out).toContain("拷问");
    expect(out).toContain("实施");
    expect(out).toContain("合并");
    expect(out).toContain("archive");
  });

  it("source body does not hardcode literal state names", () => {
    expect(body).not.toContain("待办");
    expect(body).not.toContain("合并中");
    expect(body).not.toContain("重置处理");
    expect(body).not.toContain("代码评审中");
  });

  it("uses only template variables via {{ }} (no unknown variable at render)", () => {
    expect(() => renderPrompt(body, ctx({ attempt: null }))).not.toThrow();
  });

  it("contains the grill comment marker header", () => {
    expect(body).toContain("## 🔍 拷问 / Grill Questions");
  });

  it("references the four skills", () => {
    expect(body).toContain("opsx-grill-with-docs");
    expect(body).toContain("opsx-propose-with-tdd");
    expect(body).toContain("opsx-implement");
    expect(body).toContain("openspec-archive-change");
  });

  it("notes skills are committed by the target repo, not the daemon", () => {
    expect(body).toContain("does NOT copy");
    expect(body).toContain("target repo");
  });

  it("instructs rework paths do NOT re-grill", () => {
    expect(body).toContain("do NOT re-grill");
  });

  it("instructs unanswered grill questions default to recommended", () => {
    expect(body).toContain("未答采用推荐");
  });

  it("instructs work-start state hygiene without hardcoding state names", () => {
    expect(body).toContain("工作开始时的状态卫生");
    expect(body).toContain("in progress");
    expect(body).not.toContain("处理中");
  });

  it("instructs MR discussion thread resolution in incremental fix", () => {
    expect(body).toContain("discussion threads");
    expect(body).toContain("resolve the thread");
  });

  it("instructs MR discussion threads resolved before merge", () => {
    expect(body).toContain("ensure all MR discussion threads are resolved");
  });
});

function review_state_pattern(): string {
  return "{{ review_state }}";
}

describe("buildContinuationGuidance", () => {
  it("differs from original prompt and references attempt/turn", () => {
    const task = makeTask();
    const guidance = buildContinuationGuidance(task, 2, 3);
    expect(guidance).toContain("ABC-123");
    expect(guidance).toContain("attempt 2");
    expect(guidance).toContain("turn 3");
    expect(guidance).not.toContain(task.title);
  });

  it("references tasking.log for debugging", () => {
    const guidance = buildContinuationGuidance(makeTask(), 2, 3);
    expect(guidance).toContain("tasking.log");
  });

  it("references land skill", () => {
    const guidance = buildContinuationGuidance(makeTask(), 2, 3);
    expect(guidance).toContain("`land`");
  });

  it("prompts to check Jira state for incremental vs reset decision", () => {
    const guidance = buildContinuationGuidance(makeTask(), 2, 3);
    expect(guidance).toContain("Jira state");
    expect(guidance).toContain("incremental");
    expect(guidance).toContain("full reset");
  });
});

describe("WORKFLOW.feishu-direct.md.example prompt body (note-only)", () => {
  it("carries the variant sentinel and a user-facing note with no Liquid", () => {
    const path = join(process.cwd(), "assets/workflows/WORKFLOW.feishu-direct.md.example");
    const content = readFileSync(path, "utf8");
    const body = content.split("---").slice(2).join("---").trim();
    expect(body).toContain("<!-- tasking-workflow: feishu-direct -->");
    expect(body).not.toMatch(/\{\{|\{%/);
    expect(body).not.toContain("ADR");
    expect(body).toContain("tasking init");
  });

  it("renders through the strict Liquid pipeline as a trivial body", () => {
    const path = join(process.cwd(), "assets/workflows/WORKFLOW.feishu-direct.md.example");
    const content = readFileSync(path, "utf8");
    const body = content.split("---").slice(2).join("---").trim();
    const task = makeTask();
    const out = renderPrompt(body, ctx({ task, attempt: 2 }));
    expect(out).toContain("<!-- tasking-workflow: feishu-direct -->");
  });
});

describe("workflow starter templates expose agents catalog", () => {
  const TEMPLATES = [
    "assets/workflows/WORKFLOW.minimal.md.example",
    "assets/workflows/WORKFLOW.code-mr.md.example",
    "assets/workflows/WORKFLOW.grill-openspec.md.example",
    "assets/workflows/WORKFLOW.feishu-direct.md.example",
  ];

  it.each(TEMPLATES)("%s opencode block includes agents: [] with a comment", (file) => {
    const content = readFileSync(join(process.cwd(), file), "utf8");
    const { config } = parseWorkflowContent(content, file);
    const opencode = config.opencode as { agents?: string[] } | undefined;
    expect(opencode).toBeDefined();
    expect(opencode?.agents).toEqual([]);
    expect(content).toMatch(/agents:\s*\[\]/);
  });
});

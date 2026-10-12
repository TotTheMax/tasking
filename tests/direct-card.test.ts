import { describe, expect, it } from "vitest";
import {
  CARD_BUDGET_BYTES,
  type TurnCardState,
  type TurnCardToolEvent,
  buildCompletionCard,
  buildTurnCard,
} from "../src/direct/card.js";

interface CardElement {
  tag: string;
  content?: string;
  expanded?: boolean;
  header?: { title?: { content?: string } };
  border?: { color?: string };
  elements?: CardElement[];
  text?: { content?: string };
  behaviors?: Array<{ type: string; value?: Record<string, unknown> }>;
}

interface CardJson {
  schema: string;
  config: Record<string, unknown>;
  header: { template: string; title: { content: string } };
  body: { elements: CardElement[] };
}

function asCard(card: unknown): CardJson {
  return card as CardJson;
}

function toolEvent(over: Partial<TurnCardToolEvent> = {}): TurnCardToolEvent {
  return {
    tool: "bash",
    title: "find jobs scripts -type f | sort",
    status: "completed",
    exit: 0,
    durationMs: 214,
    input: { command: "find jobs scripts -type f | sort" },
    output: "jobs/a.md\nscripts/b.md",
    ...over,
  };
}

function state(over: Partial<TurnCardState> = {}): TurnCardState {
  return {
    rootId: "om_root1",
    sessionName: "jenkins-auto",
    sessionStatus: "running",
    turns: 5,
    totalTokens: 12400,
    queued: 0,
    turn: 5,
    phase: "running",
    toolCalls: 2,
    durationSec: 42,
    turnTokens: 8400,
    texts: [],
    tools: [],
    ...over,
  };
}

function panels(card: CardJson): CardElement[] {
  return card.body.elements.filter((e) => e.tag === "collapsible_panel");
}

describe("buildTurnCard structure", () => {
  it("renders a 2.0 shared card with a session header and a turn divider", () => {
    const card = asCard(buildTurnCard(state()));
    expect(card.schema).toBe("2.0");
    expect(card.config.update_multi).toBe(true);
    expect(card.header.title.content).toContain("jenkins-auto");
    expect(card.header.title.content).toContain("运行中");
    expect(card.header.title.content).toContain("5 turns");
    expect(card.header.title.content).toContain("12.4k");
    const first = card.body.elements[0];
    expect(first?.tag).toBe("markdown");
    expect(first?.content).toContain("Turn 5");
    expect(first?.content).toContain("▶");
  });

  it("shows queue depth in the header only when something is queued", () => {
    expect(asCard(buildTurnCard(state({ queued: 0 }))).header.title.content).not.toContain("队列");
    expect(asCard(buildTurnCard(state({ queued: 2 }))).header.title.content).toContain("队列 2");
  });
});

describe("buildTurnCard tool panels", () => {
  it("renders one panel per tool with tool name, command and output tail", () => {
    const card = asCard(
      buildTurnCard(state({ tools: [toolEvent(), toolEvent({ tool: "read" })] })),
    );
    const ps = panels(card);
    expect(ps).toHaveLength(2);
    expect(ps[0]?.header?.title?.content).toContain("bash");
    expect(ps[0]?.header?.title?.content).toContain("find jobs scripts");
    const body = ps[0]?.elements?.[0]?.content ?? "";
    expect(body).toContain("completed");
    expect(body).toContain("214ms");
    expect(body).toContain("**Tool:** `bash`");
    expect(body).toContain("find jobs scripts -type f | sort");
    expect(body).toContain("jobs/a.md");
  });

  it("shows only the last 15 output lines and marks the drop", () => {
    const output = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`).join("\n");
    const card = asCard(buildTurnCard(state({ tools: [toolEvent({ output })] })));
    const body = panels(card)[0]?.elements?.[0]?.content ?? "";
    expect(body).not.toContain("line-5");
    expect(body).toContain("line-6");
    expect(body).toContain("line-20");
    expect(body).toContain("(5 more lines)");
  });

  it("renders args as JSON when there is no command", () => {
    const card = asCard(
      buildTurnCard(
        state({
          tools: [
            toolEvent({ tool: "grep", input: { pattern: "ssh", path: "scripts" }, output: "" }),
          ],
        }),
      ),
    );
    const body = panels(card)[0]?.elements?.[0]?.content ?? "";
    expect(body).toContain("Args:");
    expect(body).toContain("pattern");
  });

  it("notes opencode-side truncation", () => {
    const card = asCard(buildTurnCard(state({ tools: [toolEvent({ truncated: true })] })));
    expect(panels(card)[0]?.elements?.[0]?.content).toContain("opencode truncated");
  });

  it("collapses successful panels and expands failed ones with a red border", () => {
    const card = asCard(
      buildTurnCard(
        state({
          tools: [
            toolEvent(),
            toolEvent({ tool: "bash", title: "systemctl status jenkins", exit: 1 }),
          ],
        }),
      ),
    );
    const ps = panels(card);
    expect(ps[0]?.expanded).toBe(false);
    expect(ps[0]?.border?.color).toBe("grey");
    expect(ps[1]?.expanded).toBe(true);
    expect(ps[1]?.border?.color).toBe("red");
    expect(ps[1]?.header?.title?.content).toContain("✗");
  });

  it("keeps every panel collapsed while the turn runs", () => {
    const card = asCard(
      buildTurnCard(state({ phase: "running", tools: [toolEvent(), toolEvent({ tool: "read" })] })),
    );
    expect(panels(card).every((p) => p.expanded === false)).toBe(true);
  });
});

function buttons(card: CardJson): CardElement[] {
  return card.body.elements.filter((e) => e.tag === "button");
}

function buttonActions(card: CardJson): string[] {
  return buttons(card).map((b) => String(b.behaviors?.[0]?.value?.action));
}

describe("buildTurnCard budget", () => {
  const bigOutput = Array.from({ length: 40 }, (_, i) => `L${i}-${"x".repeat(60)}`).join("\n");

  it("degrades oldest panels first while keeping the newest intact", () => {
    const tools = Array.from({ length: 24 }, () => toolEvent({ output: bigOutput }));
    const card = buildTurnCard(state({ tools }));
    expect(JSON.stringify(card).length).toBeLessThanOrEqual(CARD_BUDGET_BYTES);
    const ps = panels(asCard(card));
    expect(ps).toHaveLength(tools.length);
    const oldest = ps[0]?.elements?.[0]?.content ?? "";
    const newest = ps.at(-1)?.elements?.[0]?.content ?? "";
    expect(oldest.length).toBeLessThan(newest.length);
    expect(oldest).not.toContain("L30-");
    expect(newest).toContain("L30-");
  });

  it("drops the oldest panels and marks how many were not shown", () => {
    const tools = Array.from({ length: 120 }, () => toolEvent({ output: bigOutput }));
    const card = buildTurnCard(state({ tools }));
    expect(JSON.stringify(card).length).toBeLessThanOrEqual(CARD_BUDGET_BYTES);
    const ps = panels(asCard(card));
    expect(ps.length).toBeLessThan(tools.length);
    const marker = asCard(card).body.elements.find(
      (e) => e.tag === "markdown" && e.content?.includes("未展示"),
    );
    expect(marker?.content).toContain(String(tools.length - ps.length));
  });
});

describe("buildTurnCard control row", () => {
  it("offers interrupt and end while running, with object values carrying root and turn", () => {
    const card = asCard(buildTurnCard(state({ phase: "running" })));
    expect(buttonActions(card)).toEqual(["stop", "perm", "done"]);
    const value = buttons(card)[0]?.behaviors?.[0]?.value;
    expect(value).toMatchObject({ action: "stop", root_id: "om_root1", turn: 5 });
    expect(typeof value?.seq).toBe("number");
  });

  it("offers retry, full output and end on the latest completed turn", () => {
    const card = asCard(buildTurnCard(state({ phase: "completed" })));
    expect(buttonActions(card)).toEqual(["retry", "full", "perm", "done"]);
  });

  it("replaces the control row with a stats marker once sealed", () => {
    const card = asCard(buildTurnCard(state({ phase: "completed", sealed: true })));
    expect(buttons(card)).toHaveLength(0);
    const last = card.body.elements.at(-1);
    expect(last?.tag).toBe("markdown");
    expect(last?.content).toContain("该轮已结束");
    expect(last?.content).toContain("42s");
  });

  it("marks an expired session without claiming the turn completed", () => {
    const card = asCard(
      buildTurnCard(state({ phase: "expired", sessionStatus: "expired", sealed: true })),
    );
    expect(buttons(card)).toHaveLength(0);
    expect(card.body.elements[0]?.content).toContain("已过期");
    expect(card.body.elements.at(-1)?.content).toContain("会话已过期");
  });

  it("keeps the true terminal status on a sealed card", () => {
    const interrupted = asCard(
      buildTurnCard(state({ phase: "interrupted", sealed: true, hideFullDetail: true })),
    );
    expect(interrupted.body.elements[0]?.content).toContain("已中断");
    expect(interrupted.body.elements.at(-1)?.content).toContain("该轮已结束");
    const failed = asCard(
      buildTurnCard(state({ phase: "failed", sealed: true, hideFullDetail: true })),
    );
    expect(failed.body.elements[0]?.content).toContain("失败");
  });

  it("omits the full-output button when no detail was retained", () => {
    const card = asCard(buildTurnCard(state({ phase: "interrupted", hideFullDetail: true })));
    expect(buttonActions(card)).toEqual(["retry", "perm", "done"]);
  });

  it("asks for confirmation before ending", () => {
    const card = asCard(buildTurnCard(state({ phase: "confirm" })));
    expect(buttonActions(card)).toEqual(["done_confirm", "cancel"]);
    const warning = card.body.elements.find(
      (e) => e.tag === "markdown" && e.content?.includes("不可恢复"),
    );
    expect(warning).toBeDefined();
  });
});

describe("buildCompletionCard", () => {
  it("renders the full answer as markdown with the stats footer", () => {
    const card = asCard(
      buildCompletionCard({
        answer: "## 结论\n\n**P0** 游标只读不写\n\n| a | b |\n|---|---|\n| 1 | 2 |",
        statsLine: "⏱ 237s · 🔧 22 · ≈541.9k tokens",
        note: "⚠️ 1 个操作被权限拒绝",
      }),
    );
    expect(card.schema).toBe("2.0");
    expect(card.config.update_multi).toBe(true);
    const body = card.body.elements[0]?.content ?? "";
    expect(body).toContain("## 结论");
    expect(body).toContain("**P0** 游标只读不写");
    expect(body).toContain("| a | b |");
    expect(body).toContain("⏱ 237s");
    expect(body).toContain("权限拒绝");
    expect(card.body.elements.filter((e) => e.tag === "button")).toHaveLength(0);
  });

  it("omits empty stats and notes", () => {
    const card = asCard(buildCompletionCard({ answer: "只有正文", statsLine: "", note: "" }));
    const body = card.body.elements[0]?.content ?? "";
    expect(body).toContain("只有正文");
    expect(body).not.toContain("⏱");
    expect(body.trim().endsWith("只有正文")).toBe(true);
  });
});

describe("buildTurnCard text handling", () => {
  it("shows step texts while the turn runs", () => {
    const card = asCard(buildTurnCard(state({ texts: ["先看一下", "再确认"] })));
    const contents = card.body.elements.filter((e) => e.tag === "markdown").map((e) => e.content);
    expect(contents).toContain("先看一下");
    expect(contents).toContain("再确认");
  });

  it("drops the final answer text once finalised (it lives in the completion message)", () => {
    const card = buildTurnCard(state({ texts: ["先看一下", "最终答案"], finalized: true }));
    const joined = JSON.stringify(card);
    expect(joined).toContain("先看一下");
    expect(joined).not.toContain("最终答案");
  });

  it("pluralises the turn count", () => {
    expect(asCard(buildTurnCard(state({ turns: 1 }))).header.title.content).toContain("1 turn ·");
    expect(asCard(buildTurnCard(state({ turns: 1 }))).header.title.content).not.toContain(
      "1 turns",
    );
    expect(asCard(buildTurnCard(state({ turns: 3 }))).header.title.content).toContain("3 turns");
  });
});

describe("buildTurnCard permission controls", () => {
  it("shows the posture and agent override in the header", () => {
    const auto = asCard(buildTurnCard(state({ autoPosture: "on" })));
    expect(auto.header.title.content).toContain("🔓 auto");
    const once = asCard(buildTurnCard(state({ autoPosture: "once" })));
    expect(once.header.title.content).toContain("⚡ 下轮放开");
    const agent = asCard(buildTurnCard(state({ agentOverride: "review" })));
    expect(agent.header.title.content).toContain("🧠 review");
    expect(asCard(buildTurnCard(state({ autoPosture: "off" }))).header.title.content).not.toContain(
      "🔓",
    );
  });

  it("labels the permission button by posture", () => {
    const off = asCard(buildTurnCard(state({ phase: "completed", autoPosture: "off" })));
    expect(buttonActions(off)).toContain("perm");
    expect(buttons(off).map((b) => b.text?.content)).toContain("🔐 权限");
    const on = asCard(buildTurnCard(state({ phase: "completed", autoPosture: "on" })));
    expect(buttons(on).map((b) => b.text?.content)).toContain("🔓 收回");
    const once = asCard(buildTurnCard(state({ phase: "completed", autoPosture: "once" })));
    expect(buttons(once).map((b) => b.text?.content)).toContain("⚡ 取消");
  });

  it("renders the confirm row while a permission change is pending", () => {
    const card = asCard(buildTurnCard(state({ phase: "completed", confirmPermission: true })));
    expect(buttonActions(card)).toEqual(["perm_on", "perm_once", "perm_cancel"]);
    const warning = card.body.elements.find(
      (e) => e.tag === "markdown" && e.content?.includes("deny"),
    );
    expect(warning).toBeDefined();
  });

  it("keeps the permission button off sealed cards", () => {
    const card = asCard(buildTurnCard(state({ phase: "completed", sealed: true })));
    expect(buttonActions(card)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  CARD_BUDGET_BYTES,
  type TurnCardEvent,
  type TurnCardState,
  type TurnCardToolEvent,
  buildCompletionCard,
  buildTurnCard,
  cardPayloadBytes,
  estimateCardElements,
  toolSummary,
} from "../src/direct/card.js";
import { mapContentEntry } from "../src/driver/turn-driver.js";
import { capturedToolEntry } from "./helpers/opencode-fixtures.js";

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

function textCardEvent(text: string): TurnCardEvent {
  return { kind: "text", text };
}

function toolCardEvent(tool: TurnCardToolEvent = toolEvent()): TurnCardEvent {
  return { kind: "tool", tool };
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
    events: [],
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

  it("marks continuation segments in the header", () => {
    expect(asCard(buildTurnCard(state({ segment: 1 }))).header.title.content).not.toContain("片段");
    expect(asCard(buildTurnCard(state({ segment: 2 }))).header.title.content).toContain("片段 2");
  });
});

describe("buildTurnCard event order", () => {
  it("renders texts and tools in source order", () => {
    const t1 = toolEvent({ tool: "read", title: "a.txt" });
    const t2 = toolEvent({ tool: "grep", title: "needle" });
    const card = asCard(
      buildTurnCard(
        state({
          events: [
            textCardEvent("先看 A"),
            toolCardEvent(t1),
            textCardEvent("再看 B"),
            toolCardEvent(t2),
          ],
        }),
      ),
    );
    const sequence: string[] = [];
    for (const element of card.body.elements) {
      if (element.tag === "markdown" && element.content?.startsWith("先看")) {
        sequence.push("A");
      } else if (element.tag === "markdown" && element.content?.startsWith("再看")) {
        sequence.push("B");
      } else if (element.tag === "collapsible_panel") {
        const title = element.header?.title?.content ?? "";
        sequence.push(title.includes("read") ? "T1" : "T2");
      }
    }
    expect(sequence).toEqual(["A", "T1", "B", "T2"]);
  });
});

describe("buildTurnCard tool panels", () => {
  it("renders one panel per tool with tool name, command and output tail", () => {
    const card = asCard(
      buildTurnCard(
        state({ events: [toolCardEvent(), toolCardEvent(toolEvent({ tool: "read" }))] }),
      ),
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
    const card = asCard(buildTurnCard(state({ events: [toolCardEvent(toolEvent({ output }))] })));
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
          events: [
            toolCardEvent(
              toolEvent({ tool: "grep", input: { pattern: "ssh", path: "scripts" }, output: "" }),
            ),
          ],
        }),
      ),
    );
    const body = panels(card)[0]?.elements?.[0]?.content ?? "";
    expect(body).toContain("Args:");
    expect(body).toContain("pattern");
  });

  it("notes opencode-side truncation", () => {
    const card = asCard(
      buildTurnCard(state({ events: [toolCardEvent(toolEvent({ truncated: true }))] })),
    );
    expect(panels(card)[0]?.elements?.[0]?.content).toContain("opencode truncated");
  });

  it("summarises captured v2 tool entries by their real input keys", () => {
    const cases: Array<{ name: string; expect: string }> = [
      { name: "read", expect: "sample.txt" },
      { name: "glob", expect: "**/*.txt" },
      { name: "grep", expect: "hello" },
      { name: "write", expect: "out.txt" },
      { name: "edit", expect: "out.txt" },
    ];
    for (const c of cases) {
      const [evt] = mapContentEntry(capturedToolEntry(c.name));
      expect(toolSummary(evt as TurnCardToolEvent)).toBe(c.expect);
      const card = asCard(
        buildTurnCard(state({ events: [toolCardEvent(evt as TurnCardToolEvent)] })),
      );
      expect(panels(card)[0]?.header?.title?.content).toContain(c.expect);
    }
  });

  it("collapses successful panels and expands failed ones with a red border", () => {
    const card = asCard(
      buildTurnCard(
        state({
          events: [
            toolCardEvent(),
            toolCardEvent(toolEvent({ tool: "bash", title: "systemctl status jenkins", exit: 1 })),
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
      buildTurnCard(
        state({
          phase: "running",
          events: [toolCardEvent(), toolCardEvent(toolEvent({ tool: "read" }))],
        }),
      ),
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

  it("keeps the payload within budget by degrading oldest panels first", () => {
    const events = Array.from({ length: 24 }, () =>
      toolCardEvent(toolEvent({ output: bigOutput })),
    );
    const card = buildTurnCard(state({ events }));
    expect(cardPayloadBytes(card)).toBeLessThanOrEqual(CARD_BUDGET_BYTES);
    const ps = panels(asCard(card));
    expect(ps.length).toBeLessThanOrEqual(events.length);
    if (ps.length === events.length) {
      const oldest = ps[0]?.elements?.[0]?.content ?? "";
      const newest = ps.at(-1)?.elements?.[0]?.content ?? "";
      expect(oldest.length).toBeLessThan(newest.length);
      expect(oldest).not.toContain("L30-");
      expect(newest).toContain("L30-");
    } else {
      expect(asCard(card).body.elements.some((e) => e.content?.includes("未展示"))).toBe(true);
    }
  });

  it("drops the oldest panels and marks how many were not shown", () => {
    const events = Array.from({ length: 120 }, () =>
      toolCardEvent(toolEvent({ output: bigOutput })),
    );
    const card = buildTurnCard(state({ events }));
    expect(cardPayloadBytes(card)).toBeLessThanOrEqual(CARD_BUDGET_BYTES);
    const ps = panels(asCard(card));
    expect(ps.length).toBeLessThan(events.length);
    const marker = asCard(card).body.elements.find(
      (e) => e.tag === "markdown" && e.content?.includes("未展示"),
    );
    expect(marker?.content).toContain(String(events.length - ps.length));
  });

  it("truncates a single oversized text event to the budget", () => {
    const card = buildTurnCard(state({ events: [textCardEvent("中".repeat(60_000))] }));
    expect(cardPayloadBytes(card)).toBeLessThanOrEqual(CARD_BUDGET_BYTES);
    expect(JSON.stringify(card)).toContain("…");
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

  it("uses a continuation footer for a segment sealed mid-turn", () => {
    const card = asCard(buildTurnCard(state({ phase: "running", sealed: true, continued: true })));
    expect(buttons(card)).toHaveLength(0);
    expect(card.body.elements.at(-1)?.content).toContain("本段结束，续见下一条卡片");
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
  it("shows step texts in order without a fixed character cap", () => {
    const long = "很长的步骤文本".repeat(100);
    const card = asCard(
      buildTurnCard(state({ events: [textCardEvent("先看一下"), textCardEvent(long)] })),
    );
    const contents = card.body.elements.filter((e) => e.tag === "markdown").map((e) => e.content);
    expect(contents).toContain("先看一下");
    expect(contents).toContain(long);
  });

  it("pluralises the turn count", () => {
    expect(asCard(buildTurnCard(state({ turns: 1 }))).header.title.content).toContain("1 turn ·");
    expect(asCard(buildTurnCard(state({ turns: 1 }))).header.title.content).not.toContain(
      "1 turns",
    );
    expect(asCard(buildTurnCard(state({ turns: 3 }))).header.title.content).toContain("3 turns");
  });
});

describe("buildTurnCard budget measurement", () => {
  it("estimates elements as fixed overhead plus text=1 and tool=3", () => {
    expect(
      estimateCardElements(
        state({
          events: [
            textCardEvent("a"),
            textCardEvent("b"),
            toolCardEvent(),
            toolCardEvent(toolEvent({ tool: "read" })),
          ],
        }),
      ),
    ).toBe(12 + 1 + 1 + 3 + 3);
  });

  it("measures the escaped UTF-8 payload, not the raw character count", () => {
    const card = buildTurnCard(state({ events: [textCardEvent("中文".repeat(100))] }));
    const rawBytes = Buffer.byteLength(JSON.stringify(card), "utf8");
    expect(cardPayloadBytes(card)).toBeGreaterThan(rawBytes);
    expect(cardPayloadBytes(card)).toBeGreaterThan(JSON.stringify(card).length * 1.4);
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

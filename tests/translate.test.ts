import { afterEach, describe, expect, it } from "vitest";
import { helpTextFor, intakeAckTextFor } from "../src/bridge/commands.js";
import { EXACT, PATTERNS } from "../src/translate/dict.js";
import {
  type TranslateWarnLogger,
  getLocale,
  resetTranslateWarned,
  setLocale,
  setTranslateWarnLogger,
  translate,
} from "../src/translate/locale.js";
import { normalizeTemplate } from "../src/translate/normalize.js";

afterEach(() => {
  setLocale("zh");
  setTranslateWarnLogger(null);
  resetTranslateWarned();
});

describe("normalizeTemplate", () => {
  it("returns plain literal unchanged when no interpolation", () => {
    expect(normalizeTemplate("已取消")).toBe("已取消");
  });

  it("replaces a single interpolation with a wildcard", () => {
    expect(normalizeTemplate("已同步到 ${key}")).toBe("已同步到 (.*)");
  });

  it("merges adjacent interpolations into one wildcard", () => {
    expect(normalizeTemplate("还有 ${n}${m} 个")).toBe("还有 (.*) 个");
  });

  it("handles multiple variables in one template", () => {
    expect(normalizeTemplate("${a} 通过 / ${b} 失败")).toBe("(.*) 通过 / (.*) 失败");
  });

  it("escapes regex metacharacters in the literal parts", () => {
    expect(normalizeTemplate("**失败：** ${detail}")).toBe("\\*\\*失败：\\*\\* (.*)");
  });
});

describe("translate", () => {
  it("passes text through unchanged when locale is zh", () => {
    setLocale("zh");
    expect(translate("已取消")).toBe("已取消");
  });

  it("translates a static string via the exact dictionary when en", () => {
    setLocale("en");
    expect(translate("已取消")).toBe("Cancelled");
    expect(translate("已刷新")).toBe("Refreshed");
  });

  it("passes through unmatched text unchanged when en", () => {
    setLocale("en");
    expect(translate("完全未知的句子 xyz")).toBe("完全未知的句子 xyz");
  });

  it("translates the frame and passes the variable through", () => {
    setLocale("en");
    expect(translate("… 还有 3 个工具调用未展示（完整明细见 TUI 活动视图）")).toBe(
      "… 3 more tool calls not shown (see the TUI activity view for full detail)",
    );
    expect(translate("… 还有 12 个工具调用未展示（完整明细见 TUI 活动视图）")).toBe(
      "… 12 more tool calls not shown (see the TUI activity view for full detail)",
    );
  });

  it("does not re-translate passed-through variable content", () => {
    setLocale("en");
    const out = translate("… 还有 已取消 个工具调用未展示（完整明细见 TUI 活动视图）");
    expect(out).toContain("已取消");
    expect(out).not.toContain("Cancelled");
  });

  it("translates multi-line text line by line", () => {
    setLocale("en");
    expect(translate("状态：To Do\n负责人：（未分配）")).toBe("State: To Do\nAssignee: （未分配）");
    expect(translate("状态：（未知）")).toBe("State: （未知）");
  });
});

describe("locale provider", () => {
  it("defaults to zh and reflects setLocale", () => {
    expect(getLocale()).toBe("zh");
    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(translate("已取消")).toBe("Cancelled");
    setLocale("zh");
    expect(translate("已取消")).toBe("已取消");
  });
});

describe("runtime residual-Han warning", () => {
  afterEach(() => {
    setLocale("zh");
    setTranslateWarnLogger(null);
    resetTranslateWarned();
  });

  it("warns once per untranslated Han string in en mode and still returns it", () => {
    const warnings: string[] = [];
    setTranslateWarnLogger(((msg: string) => warnings.push(msg)) satisfies TranslateWarnLogger);
    setLocale("en");
    const out = translate("完全未知的句子 xyz");
    expect(out).toBe("完全未知的句子 xyz");
    expect(warnings).toHaveLength(1);
    translate("完全未知的句子 xyz");
    expect(warnings).toHaveLength(1);
    translate("另一句没翻译的");
    expect(warnings).toHaveLength(2);
  });

  it("does not warn in zh mode or for fully translated text", () => {
    const warnings: string[] = [];
    setTranslateWarnLogger(((msg: string) => warnings.push(msg)) satisfies TranslateWarnLogger);
    setLocale("en");
    expect(translate("已取消")).toBe("Cancelled");
    expect(warnings).toHaveLength(0);
    setLocale("zh");
    translate("完全未知的句子 xyz");
    expect(warnings).toHaveLength(0);
  });
});

describe("en smoke: bridge help and ack render without Han", () => {
  afterEach(() => {
    setLocale("zh");
  });

  it("translates the full help blocks line by line", () => {
    setLocale("en");
    for (const text of [helpTextFor(true), helpTextFor(false)]) {
      const out = translate(text);
      expect(out).not.toMatch(/[\u4e00-\u9fff]/);
      expect(out).toContain("/help");
    }
  });

  it("translates intake acks", () => {
    setLocale("en");
    expect(translate(intakeAckTextFor(true))).not.toMatch(/[\u4e00-\u9fff]/);
    expect(translate(intakeAckTextFor(false))).not.toMatch(/[\u4e00-\u9fff]/);
  });
});

describe("dictionary integrity guards", () => {
  afterEach(() => {
    setLocale("zh");
  });

  it("every pattern's $N placeholders reference existing capture groups", () => {
    for (const rule of PATTERNS) {
      const groups = (rule.re.source.match(/\(\.\*\)/g) ?? []).length;
      const bare = rule.en.replaceAll("$$", "");
      const refs = [...bare.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      for (const n of refs) {
        expect(
          n,
          `en "${rule.en.slice(0, 60)}" references $${n} but the pattern has ${groups} groups (${rule.re.source})`,
        ).toBeLessThanOrEqual(groups);
      }
      expect(bare, `en uses special replacement sequences: ${rule.en}`).not.toMatch(/\$[&`']/);
    }
  });

  it("multi-line block templates translate end to end", () => {
    setLocale("en");
    const lock =
      "\n  tasking 启动失败：同一飞书应用/群已有实例在运行（pid 42，workflow: /w/WORKFLOW.md）。\n  飞书事件为集群路由，双实例会互相抢消息、重复建话题。\n  请先 tasking stop 旧实例，或更换 app_id/intake_chat_id。\n\n";
    const out = translate(lock);
    expect(out).toContain("another instance is already running");
    expect(out).toContain("pid 42");
    expect(out).toContain("/w/WORKFLOW.md");
    expect(out).not.toMatch(/[\u4e00-\u9fff]/);
    expect(translate("tasking doctor — 全链路只读体检\n\n")).toBe(
      "tasking doctor — read-only full-chain health check\n\n",
    );
  });

  it("every dictionary entry has a non-empty en value with no Han leak", () => {
    setLocale("en");
    const allowHan = new Set([
      "中文",
      "Language of the generated WORKFLOW.md comments and guidance. Press enter for 中文.",
    ]);
    for (const [zh, en] of Object.entries(EXACT)) {
      expect(en, `empty en value for: ${zh}`).not.toBe("");
      if (!allowHan.has(zh)) {
        expect(en, `en value still contains Han: ${zh} -> ${en}`).not.toMatch(/[\u4e00-\u9fff]/);
      }
    }
    for (const rule of PATTERNS) {
      expect(rule.en, `empty en for pattern: ${rule.re.source}`).not.toBe("");
    }
  });

  it("en translations contain real newlines, never the literal two-char \\n sequence", () => {
    const entries: Array<[string, string]> = [
      ...Object.entries(EXACT).map(([zh, en]) => [zh, en] as [string, string]),
      ...PATTERNS.map((rule) => [rule.re.source, rule.en] as [string, string]),
    ];
    for (const [key, en] of entries) {
      expect(en.includes("\\n"), `literal \\n in en translation for: ${key.slice(0, 60)}`).toBe(
        false,
      );
    }
  });
});

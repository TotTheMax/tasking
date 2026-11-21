import { describe, expect, it } from "vitest";
import {
  type AutoContinueState,
  type AutoTurnMetrics,
  classifyAutoTurn,
  freshAutoContinueState,
  isFileMutationTool,
  isLowWorkTurn,
  isRepeatedTurn,
  looksLikeQuestion,
  normalizeForComparison,
  resetAutoContinueRuns,
  textSimilarity,
} from "../src/direct/auto-continue.js";

function metrics(overrides: Partial<AutoTurnMetrics> = {}): AutoTurnMetrics {
  return {
    status: "succeeded",
    error: null,
    toolCalls: 2,
    fileMutations: 1,
    outputTokens: 1200,
    textChars: 1200,
    lastText: "已完成这一步，接下来继续处理剩余部分。",
    durationMs: 30_000,
    ...overrides,
  };
}

function state(overrides: Partial<AutoContinueState> = {}): AutoContinueState {
  return { ...freshAutoContinueState(), used: 1, ...overrides };
}

describe("normalizeForComparison / textSimilarity", () => {
  it("treats punctuation, whitespace, case and code fences as insignificant", () => {
    const a = "已完成配置重构，接下来补测试。\n```ts\nconst x = 1;\n```";
    const b = "已完成 配置重构 接下来补测试";
    expect(normalizeForComparison(a)).not.toContain("```");
    expect(textSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it("scores identical text as 1 and unrelated text as low", () => {
    expect(textSimilarity("继续实现并跑测试", "继续实现并跑测试")).toBe(1);
    expect(textSimilarity("继续实现并跑测试", "现在开始写用户文档")).toBeLessThan(0.2);
  });

  it("handles short and empty text without NaN", () => {
    expect(textSimilarity("", "")).toBe(1);
    expect(textSimilarity("好", "好")).toBe(1);
    expect(textSimilarity("好", "不")).toBe(0);
    expect(textSimilarity("", "继续")).toBe(0);
  });
});

describe("low work / repetition / question signals", () => {
  it("classifies only turns with no tools and short output as low work", () => {
    expect(isLowWorkTurn(metrics({ toolCalls: 0, outputTokens: 180, textChars: 320 }))).toBe(true);
    expect(isLowWorkTurn(metrics({ toolCalls: 1, outputTokens: 180, textChars: 320 }))).toBe(false);
    expect(isLowWorkTurn(metrics({ toolCalls: 0, outputTokens: 600, textChars: 320 }))).toBe(false);
    expect(isLowWorkTurn(metrics({ toolCalls: 0, outputTokens: 180, textChars: 700 }))).toBe(false);
  });

  it("detects a repeated summary only when neither turn wrote files", () => {
    const previous = state({
      prevLastText: "已完成配置重构，接下来补测试。",
      prevFileMutations: 0,
    });
    const current = metrics({ lastText: "已完成配置重构，接下来补测试", fileMutations: 0 });
    expect(isRepeatedTurn(current, previous)).toBe(true);
    expect(isRepeatedTurn(metrics({ ...current, fileMutations: 1 }), previous)).toBe(false);
    expect(isRepeatedTurn(current, { ...previous, prevFileMutations: 1 })).toBe(false);
    expect(isRepeatedTurn(metrics({ ...current, lastText: "  " }), previous)).toBe(false);
  });

  it("recognises question endings and bilingual markers", () => {
    expect(looksLikeQuestion("要保留旧 API 吗？")).toBe(true);
    expect(looksLikeQuestion("Should I keep the old API?")).toBe(true);
    expect(looksLikeQuestion("需要你确认一下迁移策略")).toBe(true);
    expect(looksLikeQuestion("已完成。接下来继续补测试。")).toBe(false);
    expect(looksLikeQuestion("中途提到是否要迁移，但最后给出了结论。")).toBe(false);
  });

  it("identifies file mutation tools but not bash", () => {
    for (const tool of ["write", "edit", "patch", "apply_patch", "multiedit"]) {
      expect(isFileMutationTool(tool)).toBe(true);
    }
    expect(isFileMutationTool("bash")).toBe(false);
    expect(isFileMutationTool("read")).toBe(false);
  });
});

describe("classifyAutoTurn", () => {
  it("continues after a normal productive turn", () => {
    const decision = classifyAutoTurn({
      metrics: metrics(),
      state: state({ used: 1 }),
      budget: 5,
      streakThreshold: 2,
    });
    expect(decision).toMatchObject({ action: "continue" });
    expect(decision.state.repeatRun).toBe(1);
    expect(decision.state.lowWorkRun).toBe(0);
  });

  it("pauses after two consecutive low-work turns", () => {
    const first = classifyAutoTurn({
      metrics: metrics({ toolCalls: 0, outputTokens: 180, textChars: 320 }),
      state: state({ used: 1 }),
      budget: 5,
      streakThreshold: 2,
    });
    expect(first.action).toBe("continue");
    const second = classifyAutoTurn({
      metrics: metrics({ toolCalls: 0, outputTokens: 210, textChars: 280 }),
      state: { ...first.state, used: 2 },
      budget: 5,
      streakThreshold: 2,
    });
    expect(second).toMatchObject({ action: "pause", reason: "low_work" });
  });

  it("pauses after two consecutive repeated summaries", () => {
    const first = classifyAutoTurn({
      metrics: metrics({
        toolCalls: 0,
        fileMutations: 0,
        lastText: "已完成配置重构，接下来补测试。",
      }),
      state: state({ used: 1, prevFileMutations: 0 }),
      budget: 5,
      streakThreshold: 2,
    });
    expect(first.action).toBe("continue");
    const second = classifyAutoTurn({
      metrics: metrics({
        toolCalls: 0,
        fileMutations: 0,
        lastText: "已完成配置重构，接下来补测试",
      }),
      state: { ...first.state, used: 2 },
      budget: 5,
      streakThreshold: 2,
    });
    expect(second).toMatchObject({ action: "pause", reason: "repetition" });
  });

  it("pauses on a question before low-work/repetition", () => {
    const decision = classifyAutoTurn({
      metrics: metrics({
        toolCalls: 0,
        outputTokens: 120,
        textChars: 40,
        lastText: "要保留旧 API 吗？",
      }),
      state: state({ used: 1 }),
      budget: 5,
      streakThreshold: 2,
    });
    expect(decision).toMatchObject({ action: "pause", reason: "question" });
  });

  it("hard-stops when the budget is exhausted, even on a question", () => {
    const decision = classifyAutoTurn({
      metrics: metrics({ toolCalls: 0, lastText: "要保留旧 API 吗？" }),
      state: state({ used: 5 }),
      budget: 5,
      streakThreshold: 2,
    });
    expect(decision).toMatchObject({ action: "stop", reason: "budget" });
  });

  it("hard-stops on failure and permission timeout", () => {
    expect(
      classifyAutoTurn({
        metrics: metrics({ status: "failed", error: "boom" }),
        state: state(),
        budget: 5,
        streakThreshold: 2,
      }),
    ).toMatchObject({ action: "stop", reason: "failed" });
    expect(
      classifyAutoTurn({
        metrics: metrics({ status: "timed_out", error: "permission_timeout" }),
        state: state(),
        budget: 5,
        streakThreshold: 2,
      }),
    ).toMatchObject({ action: "stop", reason: "permission_timeout" });
    expect(
      classifyAutoTurn({
        metrics: metrics({ status: "interrupted" }),
        state: state(),
        budget: 5,
        streakThreshold: 2,
      }),
    ).toMatchObject({ action: "stop", reason: "interrupted" });
  });

  it("retries turn/inactivity timeouts while budget remains, resetting runs", () => {
    const decision = classifyAutoTurn({
      metrics: metrics({
        status: "timed_out",
        error: "turn_timeout",
        toolCalls: 0,
        outputTokens: 0,
        textChars: 0,
        lastText: "",
      }),
      state: state({
        used: 2,
        lowWorkRun: 1,
        repeatRun: 1,
        prevLastText: "上次总结",
        prevFileMutations: 0,
        pausedReason: "low_work",
      }),
      budget: 5,
      streakThreshold: 2,
    });
    expect(decision).toMatchObject({ action: "retry", reason: "timeout" });
    expect(decision.state.lowWorkRun).toBe(0);
    expect(decision.state.repeatRun).toBe(0);
    expect(decision.state.prevLastText).toBeNull();
    expect(decision.state.pausedReason).toBeNull();
    expect(decision.state.used).toBe(2);
  });

  it("hard-stops when a timeout lands on the last budget slot", () => {
    const decision = classifyAutoTurn({
      metrics: metrics({ status: "timed_out", error: "inactivity_timeout" }),
      state: state({ used: 5 }),
      budget: 5,
      streakThreshold: 2,
    });
    expect(decision).toMatchObject({ action: "stop", reason: "budget", detail: "timeout" });
  });
});

describe("resetAutoContinueRuns", () => {
  it("clears run counters and the previous text while preserving used", () => {
    const reset = resetAutoContinueRuns({
      used: 3,
      lowWorkRun: 2,
      repeatRun: 2,
      prevLastText: "x",
      prevFileMutations: 1,
      pausedReason: "repetition",
    });
    expect(reset).toEqual({
      used: 3,
      lowWorkRun: 0,
      repeatRun: 0,
      prevLastText: null,
      prevFileMutations: 0,
      pausedReason: null,
    });
  });
});

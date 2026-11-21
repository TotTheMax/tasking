export type AutoTurnStatus = "succeeded" | "failed" | "timed_out" | "interrupted" | "error";

export interface AutoTurnMetrics {
  status: AutoTurnStatus;
  error: string | null;
  toolCalls: number;
  fileMutations: number;
  outputTokens: number;
  textChars: number;
  lastText: string;
  durationMs: number;
}

export type AutoContinuePauseReason = "question" | "repetition" | "low_work";

export type AutoContinueStopReason = "failed" | "permission_timeout" | "interrupted" | "budget";

export interface AutoContinueState {
  used: number;
  lowWorkRun: number;
  repeatRun: number;
  prevLastText: string | null;
  prevFileMutations: number;
  pausedReason: AutoContinuePauseReason | null;
}

export type AutoContinueDecision =
  | { action: "continue"; state: AutoContinueState }
  | { action: "retry"; reason: "timeout"; state: AutoContinueState }
  | { action: "pause"; reason: AutoContinuePauseReason; state: AutoContinueState }
  | { action: "stop"; reason: AutoContinueStopReason; detail?: string; state: AutoContinueState };

export interface ClassifyAutoTurnInput {
  metrics: AutoTurnMetrics;
  state: AutoContinueState;
  budget: number;
  streakThreshold: number;
}

export const LOW_WORK_MAX_OUTPUT_TOKENS = 500;
export const LOW_WORK_MAX_TEXT_CHARS = 600;
export const REPEAT_SIMILARITY = 0.9;
export const REPEAT_NGRAM = 3;
export const REPEAT_MAX_CHARS = 4000;

const FILE_MUTATION_TOOLS = new Set(["write", "edit", "patch", "apply_patch", "multiedit"]);

const PUNCTUATION = /[，。！？；：、,.!?;:"'“”‘’()（）\[\]{}<>《》…—\-]/g;
const QUESTION_MARKERS =
  /(请确认|需要你|是否|要不要|等你确认|please confirm|should i|do you want)/i;

export function freshAutoContinueState(): AutoContinueState {
  return {
    used: 0,
    lowWorkRun: 0,
    repeatRun: 0,
    prevLastText: null,
    prevFileMutations: 0,
    pausedReason: null,
  };
}

export function resetAutoContinueRuns(state: AutoContinueState): AutoContinueState {
  return {
    ...state,
    lowWorkRun: 0,
    repeatRun: 0,
    prevLastText: null,
    prevFileMutations: 0,
    pausedReason: null,
  };
}

export function isFileMutationTool(tool: string | null | undefined): boolean {
  if (typeof tool !== "string" || tool === "") return false;
  return FILE_MUTATION_TOOLS.has(tool.toLowerCase());
}

export function isLowWorkTurn(metrics: AutoTurnMetrics): boolean {
  return (
    metrics.toolCalls === 0 &&
    metrics.outputTokens < LOW_WORK_MAX_OUTPUT_TOKENS &&
    metrics.textChars < LOW_WORK_MAX_TEXT_CHARS
  );
}

export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (/[?？]$/.test(trimmed)) return true;
  const clauses = trimmed
    .split(/[。！？!?，,；;\n]/)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== "");
  const lastClause = clauses[clauses.length - 1] ?? trimmed;
  return QUESTION_MARKERS.test(lastClause);
}

export function normalizeForComparison(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(PUNCTUATION, "")
    .replace(/\s+/g, "")
    .slice(0, REPEAT_MAX_CHARS);
}

export function ngramSet(text: string, n: number = REPEAT_NGRAM): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + n <= text.length; i++) set.add(text.slice(i, i + n));
  return set;
}

export function textSimilarity(a: string, b: string): number {
  const left = normalizeForComparison(a);
  const right = normalizeForComparison(b);
  if (left === "" && right === "") return 1;
  if (left === "" || right === "") return 0;
  if (left.length < REPEAT_NGRAM || right.length < REPEAT_NGRAM) {
    return left === right ? 1 : 0;
  }
  const aGrams = ngramSet(left);
  const bGrams = ngramSet(right);
  let intersection = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) intersection++;
  }
  return (2 * intersection) / (aGrams.size + bGrams.size);
}

export function isRepeatedTurn(metrics: AutoTurnMetrics, state: AutoContinueState): boolean {
  if (metrics.fileMutations > 0 || state.prevFileMutations > 0) return false;
  if (metrics.lastText.trim() === "" || state.prevLastText === null) return false;
  return textSimilarity(state.prevLastText, metrics.lastText) >= REPEAT_SIMILARITY;
}

export function classifyAutoTurn(input: ClassifyAutoTurnInput): AutoContinueDecision {
  const { metrics, state, budget, streakThreshold } = input;
  const next: AutoContinueState = {
    ...state,
    pausedReason: null,
    prevLastText: metrics.lastText.trim() === "" ? null : metrics.lastText,
    prevFileMutations: metrics.fileMutations,
  };

  if (metrics.status === "interrupted") {
    return { action: "stop", reason: "interrupted", state: next };
  }
  if (metrics.status === "failed" || metrics.status === "error") {
    return { action: "stop", reason: "failed", state: next };
  }
  if (metrics.status === "timed_out") {
    if (metrics.error?.includes("permission_timeout")) {
      return { action: "stop", reason: "permission_timeout", state: next };
    }
    if (state.used < budget) {
      return { action: "retry", reason: "timeout", state: resetAutoContinueRuns(next) };
    }
    return { action: "stop", reason: "budget", detail: "timeout", state: next };
  }

  const lowWork = isLowWorkTurn(metrics);
  const repeated = isRepeatedTurn(metrics, state);
  next.lowWorkRun = lowWork ? state.lowWorkRun + 1 : 0;
  next.repeatRun = repeated ? state.repeatRun + 1 : 1;

  if (state.used >= budget) {
    return { action: "stop", reason: "budget", state: next };
  }
  if (looksLikeQuestion(metrics.lastText)) {
    return { action: "pause", reason: "question", state: { ...next, pausedReason: "question" } };
  }
  if (next.repeatRun >= streakThreshold) {
    return {
      action: "pause",
      reason: "repetition",
      state: { ...next, pausedReason: "repetition" },
    };
  }
  if (next.lowWorkRun >= streakThreshold) {
    return {
      action: "pause",
      reason: "low_work",
      state: { ...next, pausedReason: "low_work" },
    };
  }
  return { action: "continue", state: next };
}

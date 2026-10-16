import { translate } from "../translate/locale.js";

export type TurnCardPhase =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "expired"
  | "confirm";

export type TurnCardSessionStatus = "queued" | "running" | "idle" | "done" | "expired";

export interface TurnCardToolEvent {
  tool: string;
  title?: string;
  status?: string;
  exit?: number;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  truncated?: boolean;
}

export interface TurnCardState {
  rootId: string;
  sessionName: string;
  sessionStatus: TurnCardSessionStatus;
  turns: number;
  totalTokens: number;
  queued: number;
  turn: number;
  phase: TurnCardPhase;
  toolCalls: number;
  durationSec: number;
  turnTokens: number;
  texts: string[];
  tools: TurnCardToolEvent[];
  retryFromTurn?: number;
  hideFullDetail?: boolean;
  finalized?: boolean;
  sealed?: boolean;
  renderSeq?: number;
  autoPosture?: "off" | "on" | "once";
  agentOverride?: string | null;
  confirmPermission?: boolean;
}

export interface CompletionCardInput {
  answer: string;
  statsLine: string;
  note: string;
}

export function buildCompletionCard(input: CompletionCardInput): unknown {
  const footer = [input.statsLine, input.note].filter((part) => part.trim() !== "").join("\n");
  const content = footer === "" ? input.answer : `${input.answer}\n\n${footer}`;
  return {
    schema: "2.0",
    config: { update_multi: true },
    body: { elements: [{ tag: "markdown", content: content }] },
  };
}

export {
  buildInfoCard,
  type InfoCardButton,
  type InfoCardInput,
} from "../shared/info-card.js";

export const CARD_BUDGET_BYTES = 24 * 1024;

let cardRenderSeq = 0;

const OUTPUT_TAIL_LINES = 15;
const DEGRADED_TAIL_LINES = 3;
const MAX_LABEL_CHARS = 120;
const MAX_TEXT_CHARS = 400;

const SESSION_STATUS_LABEL: Record<TurnCardSessionStatus, string> = {
  queued: "排队中",
  running: "运行中",
  idle: "空闲",
  done: "已结束",
  expired: "已过期",
};

const PHASE_LABEL: Record<TurnCardPhase, string> = {
  running: "▶ 运行中",
  completed: "✅ 完成",
  failed: "❌ 失败",
  interrupted: "⚠️ 已中断",
  expired: "ℹ️ 已过期",
  confirm: "⚠️ 已中断",
};

export function formatTokens(total: number): string {
  if (total >= 1000000) return `${(total / 1000000).toFixed(1)}M`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function truncateLabel(text: string): string {
  return text.length <= MAX_LABEL_CHARS ? text : `${text.slice(0, MAX_LABEL_CHARS)}…`;
}

function tailLines(output: string, max: number): { lines: string[]; dropped: number } {
  const lines = output.split("\n");
  if (lines.length <= max) return { lines, dropped: 0 };
  return { lines: lines.slice(lines.length - max), dropped: lines.length - max };
}

export function isFailed(evt: TurnCardToolEvent): boolean {
  return (evt.exit !== undefined && evt.exit !== 0) || evt.error !== undefined;
}

export function toolSummary(evt: TurnCardToolEvent): string {
  if (typeof evt.title === "string" && evt.title.trim() !== "") return evt.title;
  const command = evt.input?.command;
  if (typeof command === "string" && command.trim() !== "") return command;
  const filePath = evt.input?.filePath;
  if (typeof filePath === "string" && filePath !== "") return filePath;
  return "";
}

function renderPanelBody(evt: TurnCardToolEvent, outputTailLines: number | null): string {
  const failed = isFailed(evt);
  const status = evt.status ?? "completed";
  const exitPart = evt.exit !== undefined ? ` (exit ${evt.exit})` : "";
  const durationPart = evt.durationMs !== undefined ? ` · ${formatDuration(evt.durationMs)}` : "";
  const lines: string[] = [
    `**Status:** ${failed ? "✗ " : ""}${status}${exitPart}${durationPart}`,
    `**Tool:** \`${evt.tool}\``,
  ];
  const command = evt.input?.command;
  if (typeof command === "string") {
    lines.push("", "**Command:**", "```bash", command, "```");
  } else if (evt.input !== undefined) {
    lines.push("", "**Args:**", "```json", JSON.stringify(evt.input, null, 2), "```");
  }
  if (evt.output !== undefined && outputTailLines !== null) {
    const { lines: shown, dropped } = tailLines(evt.output, outputTailLines);
    lines.push("", "**Output:**");
    if (dropped > 0) lines.push(`… (${dropped} more lines)`);
    lines.push("```");
    if (evt.output.trim() === "") lines.push("(no output)");
    else lines.push(...shown);
    lines.push("```");
    if (evt.truncated) lines.push("… (opencode truncated)");
  }
  return lines.join("\n");
}

function renderPanel(
  evt: TurnCardToolEvent,
  outputTailLines: number | null,
): Record<string, unknown> {
  const failed = isFailed(evt);
  const summary = truncateLabel(toolSummary(evt));
  const icon = failed ? "✗" : "🔧";
  const title = summary === "" ? `${icon} **${evt.tool}**` : `${icon} **${evt.tool}** · ${summary}`;
  const meta = renderPanelMeta(evt);
  return {
    tag: "collapsible_panel",
    expanded: failed,
    header: { title: { tag: "markdown", content: title } },
    border: { color: failed ? "red" : "grey", corner_radius: "5px" },
    elements: [
      { tag: "markdown", content: renderPanelBody(evt, outputTailLines) },
      ...(meta === "" ? [] : [{ tag: "markdown", content: meta }]),
    ],
  };
}

function renderPanelMeta(evt: TurnCardToolEvent): string {
  const failed = isFailed(evt);
  if (!failed) return "";
  const detail = evt.error ?? (evt.exit !== undefined ? `exit ${evt.exit}` : "");
  return detail === "" ? "**失败**" : `**失败：** ${detail}`;
}

function renderButton(
  label: string,
  action: string,
  state: TurnCardState,
  type: "default" | "primary" | "danger" = "default",
): Record<string, unknown> {
  return {
    tag: "button",
    text: { tag: "plain_text", content: label },
    type,
    size: "medium",
    behaviors: [
      {
        type: "callback",
        value: {
          action,
          root_id: state.rootId,
          turn: state.turn,
          seq: state.renderSeq ?? 0,
        },
      },
    ],
  };
}

function renderFooter(state: TurnCardState): Array<Record<string, unknown>> {
  if (state.confirmPermission) {
    return [
      {
        tag: "markdown",
        content: "⚠️ 放开后本会话后续轮次不再询问权限；目标仓库自身的 deny 规则仍然生效。",
      },
      renderButton("✅ 本会话放开", "perm_on", state, "primary"),
      renderButton("⚡ 仅下一轮", "perm_once", state),
      renderButton("✖ 取消", "perm_cancel", state),
    ];
  }
  if (state.sealed || state.phase === "expired") {
    return [
      {
        tag: "markdown",
        content:
          state.phase === "expired"
            ? "— 会话已过期 —"
            : translate(
                `— 该轮已结束 · ${state.durationSec}s · ≈${formatTokens(state.turnTokens)} —`,
              ),
      },
    ];
  }
  if (state.phase === "confirm") {
    return [
      {
        tag: "markdown",
        content: "⚠️ 结束会话将删除该 opencode 会话（不可恢复）。",
      },
      renderButton("确认结束", "done_confirm", state, "danger"),
      renderButton("取消", "cancel", state),
    ];
  }
  const permission = renderPermissionButton(state);
  if (state.phase === "running") {
    return [
      renderButton("⏹ 中断", "stop", state),
      permission,
      renderButton("🛑 结束", "done", state, "danger"),
    ];
  }
  return [
    renderButton("🔁 重试", "retry", state),
    ...(state.hideFullDetail ? [] : [renderButton("📄 完整输出", "full", state)]),
    permission,
    renderButton("🛑 结束", "done", state, "danger"),
  ];
}

function renderPostureMarker(state: TurnCardState): string {
  const agent = state.agentOverride ? ` · 🧠 ${state.agentOverride}` : "";
  const posture =
    state.autoPosture === "on"
      ? " · 🔓 auto"
      : state.autoPosture === "once"
        ? translate(" · ⚡ 下轮放开")
        : "";
  return `${agent}${posture}`;
}

function renderPermissionButton(state: TurnCardState): Record<string, unknown> {
  const posture = state.autoPosture ?? "off";
  const label =
    posture === "on"
      ? translate("🔓 收回")
      : posture === "once"
        ? translate("⚡ 取消")
        : translate("🔐 权限");
  const button = renderButton(label, "perm", state);
  const behavior = (button.behaviors as Array<{ value: Record<string, unknown> }>)[0];
  if (behavior) behavior.value.posture = posture;
  return button;
}

function renderCard(state: TurnCardState, levels: number[]): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];
  const queuePart = state.queued > 0 ? translate(` · 队列 ${state.queued}`) : "";
  const retryPart =
    state.retryFromTurn !== undefined ? translate(` · 🔁 重试自 Turn ${state.retryFromTurn}`) : "";
  const durationPart = state.durationSec > 0 ? ` · ${state.durationSec}s` : "";
  elements.push({
    tag: "markdown",
    content: `**Turn ${state.turn}** · ${translate(PHASE_LABEL[state.phase])}${durationPart} · 🔧 ${state.toolCalls} · ≈${formatTokens(state.turnTokens)}${retryPart}`,
  });
  const stepTexts = state.finalized ? state.texts.slice(0, -1) : state.texts;
  for (const text of stepTexts) {
    if (text.trim() === "") continue;
    elements.push({
      tag: "markdown",
      content: text.length <= MAX_TEXT_CHARS ? text : `${text.slice(0, MAX_TEXT_CHARS)}…`,
    });
  }
  let dropped = 0;
  for (const [index, evt] of state.tools.entries()) {
    const level = levels[index] ?? 0;
    if (level >= 3) {
      dropped++;
      continue;
    }
    elements.push(
      renderPanel(evt, level === 2 ? null : level === 1 ? DEGRADED_TAIL_LINES : OUTPUT_TAIL_LINES),
    );
  }
  if (dropped > 0) {
    elements.push({
      tag: "markdown",
      content: `… 还有 ${dropped} 个工具调用未展示（完整明细见 TUI 活动视图）`,
    });
  }
  elements.push(...renderFooter(state));
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `📁 ${state.sessionName} · ${translate(SESSION_STATUS_LABEL[state.sessionStatus])} · ${state.turns} turn${state.turns === 1 ? "" : "s"} · ≈${formatTokens(state.totalTokens)}${queuePart}${renderPostureMarker(state)}`,
      },
    },
    body: { elements },
  };
}

export function buildTurnCard(state: TurnCardState): unknown {
  const levels = state.tools.map(() => 0);
  const stamped: TurnCardState = { ...state, renderSeq: ++cardRenderSeq };
  let card = renderCard(stamped, levels);
  const fits = (): boolean => JSON.stringify(card).length <= CARD_BUDGET_BYTES;
  if (!fits()) {
    for (const target of [1, 2, 3]) {
      for (let i = 0; i < state.tools.length && !fits(); i++) {
        if ((levels[i] ?? 0) < target) {
          levels[i] = target;
          card = renderCard(stamped, levels);
        }
      }
    }
  }
  return card;
}

export interface ApprovalCardRequest {
  rootId: string;
  turn: number;
  requestID: string;
  action: string;
  resources: string[];
  save?: string[];
  kind?: "bridge" | "direct";
}

export type ApprovalCardResolution =
  | { state: "replied"; decision: "once" | "always" | "reject" }
  | { state: "expired" | "cancelled" | "external" };

function approvalButton(
  label: string,
  action: string,
  req: ApprovalCardRequest,
  type: "default" | "primary" | "danger" = "default",
): Record<string, unknown> {
  return {
    tag: "button",
    text: { tag: "plain_text", content: label },
    type,
    size: "medium",
    behaviors: [
      {
        type: "callback",
        value: {
          action,
          root_id: req.rootId,
          turn: req.turn,
          request_id: req.requestID,
          ...(req.kind ? { kind: req.kind } : {}),
        },
      },
    ],
  };
}

const APPROVAL_STAMP: Record<string, string> = {
  "replied:once": "✅ 已允许",
  "replied:always": "♾️ 已始终允许",
  "replied:reject": "❌ 已拒绝",
  expired: "⏰ 超时已拒绝",
  cancelled: "⛔ 已随任务中断",
  external: "🕓 已在其他端处理",
};

export function buildApprovalCard(
  req: ApprovalCardRequest,
  resolution?: ApprovalCardResolution,
): Record<string, unknown> {
  const resources = req.resources.map((r) => `\`${r}\``).join(" · ");
  const saveNote =
    req.save && req.save.length > 0 ? "\n始终允许将按模式保存：" + req.save.join("、") : "";
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content: `🔐 **等待审批** · ${req.action}\n${resources}${saveNote}`,
    },
  ];
  if (resolution) {
    const key =
      resolution.state === "replied" ? `replied:${resolution.decision}` : resolution.state;
    elements.push({ tag: "markdown", content: `— ${APPROVAL_STAMP[key] ?? "已处理"} —` });
  } else {
    elements.push(approvalButton("✅ 允许一次", "approve_once", req, "primary"));
    elements.push(approvalButton("♾️ 始终允许", "approve_always", req));
    elements.push(approvalButton("✖ 拒绝", "approve_reject", req, "danger"));
  }
  return {
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: "权限审批" },
      template: "blue",
    },
    body: { elements },
  };
}

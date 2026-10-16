import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { FeishuCardAction } from "../adapters/feishu/events.js";
import {
  type FeishuAttachment,
  type FeishuPolledMessage,
  toSecondsStr,
} from "../adapters/feishu/source.js";
import type { BindingStore, DirectSession } from "../bridge/binding-store.js";
import { parseChat } from "../bridge/commands.js";
import type { DirectConfig, EffectiveConfig } from "../config/config-types.js";
import { type ApiExecFn, defaultApiExec } from "../driver/api-client.js";
import { ApprovalCoordinator, type ApprovalRequest } from "../driver/approval.js";
import type { PendingPermission, PermissionDecision } from "../driver/session-ops.js";
import { ALLOW_ALL_RULES, replyPermission, setSessionPermissions } from "../driver/session-ops.js";
import type { TurnDriverEvent } from "../driver/turn-driver.js";
import type { ActivityEvent } from "../observability/activity-store.js";
import type { Logger } from "../observability/logger.js";
import { TaskingError, toTaskingError } from "../shared/errors.js";
import type { RuntimeDirectSession } from "../shared/types.js";
import {
  CARD_BUDGET_BYTES,
  type TurnCardPhase,
  type TurnCardSessionStatus,
  type TurnCardState,
  type TurnCardToolEvent,
  buildApprovalCard,
  buildCompletionCard,
  buildInfoCard,
  buildTurnCard,
  formatTokens,
  isFailed,
  toolSummary,
} from "./card.js";
import { type DirectTurnDriver, createDefaultTurnDriver } from "./driver.js";

export interface DirectFeishuPort {
  replyInThread(
    rootId: string,
    text: string,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }>;
  replyFlat(rootId: string, text: string): Promise<void>;
  listThreadReplies?(threadId: string, since?: string | null): Promise<FeishuPolledMessage[]>;
  replyCardInThread?(
    rootId: string,
    card: unknown,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }>;
  updateCard?(messageId: string, card: unknown): Promise<void>;
  uploadFile?(content: Uint8Array, fileName: string): Promise<string>;
  listChatMembers?(chatId: string): Promise<Array<{ open_id: string; name: string }>>;
  downloadMessageResource?(
    messageId: string,
    fileKey: string,
    kind: "image" | "file",
  ): Promise<{ data: Uint8Array; contentType: string | null }>;
  sendFileMessage?(
    rootId: string,
    fileKey: string,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }>;
}

export interface DirectManagerDeps {
  feishu: DirectFeishuPort;
  store: BindingStore;
  config: () => EffectiveConfig;
  logger: Logger;
  turnDriver?: DirectTurnDriver;
  apiExec?: ApiExecFn;
  activity?: (sessionKey: string, evt: ActivityEvent) => void;
  clearActivity?: (sessionKey: string) => void;
  deleteSession?: (sessionId: string) => Promise<void>;
  cardRetryDelayMs?: number;
}

const MAX_MESSAGE_CHARS = 3500;
const TTL_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CARD_UPDATE_INTERVAL_MS = 1500;
const CARD_RETRY_DELAY_MS = 2000;
const CARD_RETRY_JITTER_MS = 1000;
const CARD_ACTION_DEDUP_MS = 2 * 60 * 1000;
const MEMBER_CACHE_TTL_MS = 60 * 60 * 1000;
const CARD_HEARTBEAT_MS = 5000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const COLLECT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const FULL_DETAIL_MAX_BYTES = 1_000_000;
const FULL_TEXT_LIMIT_BYTES = 140_000;

export interface DirectCardActionValue {
  action?: unknown;
  root_id?: unknown;
  turn?: unknown;
  request_id?: unknown;
}

import type { CardActionReply } from "../shared/info-card.js";
import { translate } from "../translate/locale.js";

export type { CardActionReply };

interface SessionRuntime {
  queue: string[];
  turnInFlight: boolean;
  abort: AbortController | null;
  stopRequested: boolean;
  cardId: string | null;
  cardsAvailable: boolean;
  turn: TurnCardState | null;
  turnStartedAt: number;
  flushedTools: number;
  autoOnce: boolean;
  turnUsedOnce: boolean;
  postureOpen: boolean;
  waitingApproval: boolean;
  waitingSince: number | null;
  heartbeatTimer: NodeJS.Timeout | null;
  collect: string[] | null;
  collectTimer: NodeJS.Timeout | null;
  fullDetail: TurnCardToolEvent[];
  fullDetailBytes: number;
  fullDetailDropped: number;
  flushTimer: NodeJS.Timeout | null;
  flushInFlight: boolean;
  flushQueued: boolean;
  flushPromise: Promise<void> | null;
}

interface TurnStats {
  toolCalls: number;
  permissionRejections: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastText: string;
}

export function isDirectEnabled(config: EffectiveConfig): boolean {
  return config.feishu.enabled && config.feishu.direct.enabled;
}

const defaultDriverFor = (exec: ApiExecFn): DirectTurnDriver => createDefaultTurnDriver(exec);

export class DirectSessionManager {
  private readonly deps: DirectManagerDeps;
  private readonly runtime = new Map<string, SessionRuntime>();
  private readonly aggregate = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private readonly terminalHintedRoots = new Set<string>();
  private readonly cardActionSeen = new Map<string, number>();
  private readonly memberCache = new Map<string, { at: number; names: Map<string, string> }>();
  private pendingWork = 0;
  private readonly approvalRoots = new Map<string, string>();
  private readonly approvalCards = new Map<
    string,
    { messageId: string; rootId: string; request: ApprovalRequest }
  >();
  private readonly approvals: ApprovalCoordinator;
  private readonly dirSlots = new Map<string, { busy: boolean; waiters: Array<() => void> }>();
  private running = false;
  private halted = false;
  private ttlTimer: NodeJS.Timeout | null = null;
  private activeTurns = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(deps: DirectManagerDeps) {
    this.deps = deps;
    const exec = () => deps.apiExec ?? defaultApiExec();
    this.approvals = new ApprovalCoordinator({
      replyPermission: async (sessionId, requestID, decision) => {
        const cfg = deps.config();
        await replyPermission(
          exec(),
          { command: cfg.opencode.command, serverUrl: cfg.opencode.server_url },
          sessionId,
          requestID,
          decision,
        );
      },
      onCardRequested: (request) => {
        void this.sendApprovalCard(request);
      },
      onCardResolved: (requestID, state, decision) => {
        if (state === "pending") return;
        void this.stampApprovalCard(requestID, state, decision);
      },
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.halted = false;
    this.ttlTimer = setInterval(() => this.expireIdle(), TTL_SWEEP_INTERVAL_MS);
    this.ttlTimer.unref?.();
  }

  stop(): void {
    this.running = false;
    this.halted = true;
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }
    for (const rt of this.runtime.values()) {
      this.stopHeartbeat(rt);
      if (rt.collectTimer) {
        clearTimeout(rt.collectTimer);
        rt.collectTimer = null;
      }
      if (rt.flushTimer) {
        clearTimeout(rt.flushTimer);
        rt.flushTimer = null;
      }
      rt.queue = [];
      rt.collect = null;
      if (rt.turnInFlight) {
        rt.stopRequested = true;
        rt.abort?.abort();
      }
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  async whenIdle(): Promise<void> {
    for (;;) {
      const busy = this.activeTurns > 0 || this.hasQueuedWork();
      if (!busy) return;
      await new Promise((r) => setImmediate(r));
    }
  }

  private hasQueuedWork(): boolean {
    if (this.pendingWork > 0) return true;
    for (const rt of this.runtime.values()) {
      if (
        rt.turnInFlight ||
        rt.queue.length > 0 ||
        rt.flushTimer !== null ||
        rt.flushInFlight ||
        rt.flushQueued
      ) {
        return true;
      }
    }
    return false;
  }

  async handleCardAction(action: FeishuCardAction): Promise<CardActionReply | undefined> {
    const value = (action.value ?? {}) as DirectCardActionValue;
    const rootId = typeof value.root_id === "string" ? value.root_id : "";
    const name = typeof value.action === "string" ? value.action : "";
    const turn = typeof value.turn === "number" ? value.turn : null;
    if (rootId === "" || name === "") return undefined;
    const idempotent = name.startsWith("auto_") || name.startsWith("collect_");
    if (!idempotent && !this.claimCardAction(action)) {
      this.deps.logger.debug("direct card action deduplicated", {
        root_id: rootId,
        action: name,
        turn,
      });
      return { toast: { type: "info", content: "该操作已处理" } };
    }
    const session = this.deps.store.getDirectSession(rootId);
    if (!session) return { toast: { type: "error", content: "会话不存在或已清理" } };
    const rt = this.runtimeFor(rootId);
    const currentTurn = rt.turn?.turn ?? session.turns;
    this.deps.logger.debug("direct card action received", {
      root_id: rootId,
      action: name,
      turn,
      operator: action.operatorName ?? action.operatorOpenId ?? null,
      message_id: action.messageId,
    });

    if (name === "done" || name === "done_confirm" || name === "cancel") {
      return this.handleLifecycleAction(name, session, rt, action);
    }
    if (name === "approve_once" || name === "approve_always" || name === "approve_reject") {
      return await this.handleApprovalAction(name, value);
    }
    if (name === "perm" || name === "perm_on" || name === "perm_once" || name === "perm_cancel") {
      return await this.handlePermissionAction(name, session, rt);
    }
    if (name.startsWith("auto_") || name.startsWith("collect_")) {
      return this.handleInfoAction(name, session, rt, action);
    }
    if (turn !== null && turn !== currentTurn) {
      return { toast: { type: "info", content: "该轮已结束" } };
    }
    if (name === "stop") {
      if (!rt.turnInFlight || !rt.abort) {
        return { toast: { type: "info", content: "该轮已结束" } };
      }
      const queued = this.beginInterrupt(session, rt);
      const interrupted = rt.turn ? { ...rt.turn, phase: "interrupted" as TurnCardPhase } : null;
      this.deferAction(async () => {
        await this.finalizeCardPhase(session.root_id, "interrupted");
        await this.announceInterrupt(session.root_id, queued, await this.operatorLabel(action));
      });
      return {
        toast: { type: "success", content: "已中断当前任务" },
        ...(interrupted ? { card: buildTurnCard(interrupted) } : {}),
      };
    }
    if (name === "retry") {
      const prompt = session.last_prompt;
      if (!prompt) return { toast: { type: "error", content: "没有可重试的上一轮" } };
      this.deferAction(() => this.enqueueRetry(session.root_id, prompt, currentTurn));
      return { toast: { type: "success", content: "已重试上一轮" } };
    }
    if (session.status === "done" || session.status === "expired") {
      return { toast: { type: "info", content: "会话已结束" } };
    }
    if (name === "full") {
      this.deferAction(() => this.sendFullDetail(session, rt));
      return { toast: { type: "info", content: "正在整理完整输出…" } };
    }
    return { toast: { type: "warning", content: "未知操作" } };
  }

  private turnNow(rootId: string): number {
    const session = this.deps.store.getDirectSession(rootId);
    return (session?.turns ?? 0) + 1;
  }

  private async handlePendingPermissions(
    rootId: string,
    pending: PendingPermission[],
  ): Promise<void> {
    const bySession = new Map<string, PendingPermission[]>();
    for (const p of pending) {
      this.approvalRoots.set(p.sessionID, rootId);
      if (this.approvals.state(p.id) !== undefined) continue;
      const list = bySession.get(p.sessionID) ?? [];
      list.push(p);
      bySession.set(p.sessionID, list);
    }
    for (const [sessionId, items] of bySession) {
      this.approvals.ingest(sessionId, items);
    }
  }

  private async sendApprovalCard(request: ApprovalRequest): Promise<void> {
    const rootId = this.sessionRootByApproval(request);
    if (rootId === null) return;
    const card = buildApprovalCard({
      rootId,
      turn: this.turnNow(rootId),
      requestID: request.requestID,
      action: request.action,
      resources: request.resources,
      save: request.save,
      kind: "direct",
    });
    const replyCard = this.deps.feishu.replyCardInThread;
    if (!replyCard) {
      await this.replySafe(
        rootId,
        `🔐 等待审批：${request.action} ${request.resources.join("、")}（当前客户端不支持卡片，30 分钟未处理将自动拒绝）`,
      );
      return;
    }
    try {
      const res = await replyCard(rootId, card);
      if (res.message_id) {
        this.approvalCards.set(request.requestID, { messageId: res.message_id, rootId, request });
      }
    } catch (e) {
      this.deps.logger.warn("approval card send failed", {
        request_id: request.requestID,
        error: toTaskingError(e).message,
      });
    }
  }

  private sessionRootByApproval(request: ApprovalRequest): string | null {
    const recorded = this.approvalRoots.get(request.sessionId);
    if (recorded !== undefined) return recorded;
    for (const rootId of this.runtime.keys()) {
      const session = this.deps.store.getDirectSession(rootId);
      if (session?.session_id === request.sessionId) return rootId;
    }
    return null;
  }

  private async stampApprovalCard(
    requestID: string,
    state: "replied" | "expired" | "cancelled" | "external",
    decision?: PermissionDecision,
  ): Promise<void> {
    const entry = this.approvalCards.get(requestID);
    if (!entry) return;
    const update = this.deps.feishu.updateCard;
    if (!update) return;
    const resolution =
      state === "replied" && (decision === "once" || decision === "always" || decision === "reject")
        ? { state: "replied" as const, decision }
        : { state: state as "expired" | "cancelled" | "external" };
    const card = buildApprovalCard(
      {
        rootId: entry.rootId,
        turn: this.turnNow(entry.rootId),
        requestID,
        action: entry.request.action,
        resources: entry.request.resources,
        save: entry.request.save,
      },
      resolution,
    );
    try {
      await update(entry.messageId, card);
    } catch (e) {
      this.deps.logger.warn("approval card stamp failed", {
        request_id: requestID,
        error: toTaskingError(e).message,
      });
    }
  }

  private async handleApprovalAction(
    name: string,
    value: DirectCardActionValue,
  ): Promise<CardActionReply> {
    const requestID = typeof value.request_id === "string" ? value.request_id : null;
    if (!requestID) {
      return { toast: { type: "error", content: "审批单标识缺失，无法处理" } };
    }
    const decision: PermissionDecision =
      name === "approve_once" ? "once" : name === "approve_always" ? "always" : "reject";
    const outcome = await this.approvals.reply(requestID, decision);
    const toast =
      outcome === "replied"
        ? { type: "success" as const, content: decision === "reject" ? "已拒绝" : "已允许" }
        : outcome === "already"
          ? { type: "info" as const, content: "该审批已处理" }
          : outcome === "unknown"
            ? { type: "warning" as const, content: "审批单不存在或已过期" }
            : { type: "error" as const, content: "审批提交失败，请重试" };
    return { toast };
  }

  private async applySessionPosture(
    session: DirectSession,
    rt: SessionRuntime,
    open: boolean,
  ): Promise<void> {
    const sessionId = session.session_id;
    if (!sessionId) {
      rt.postureOpen = open;
      return;
    }
    const cfg = this.deps.config();
    try {
      await setSessionPermissions(
        this.deps.apiExec ?? defaultApiExec(),
        { command: cfg.opencode.command, serverUrl: cfg.opencode.server_url },
        sessionId,
        open ? ALLOW_ALL_RULES : null,
      );
      rt.postureOpen = open;
    } catch (e) {
      this.deps.logger.warn("session posture update failed", {
        root_id: session.root_id,
        open,
        error: toTaskingError(e).message,
      });
    }
  }

  private async handlePermissionAction(
    name: string,
    session: DirectSession,
    rt: SessionRuntime,
  ): Promise<CardActionReply> {
    const card = (confirm: boolean): { card?: unknown } => {
      const built = this.permissionCard(session, rt, confirm);
      return built === null ? {} : { card: built };
    };
    if (name === "perm_cancel") {
      return { toast: { type: "info", content: "已取消" }, ...card(false) };
    }
    const fresh = this.deps.store.getDirectSession(session.root_id) ?? session;
    if (name === "perm") {
      if (fresh.auto_approve_override === "on" || rt.autoOnce || rt.turnUsedOnce) {
        rt.autoOnce = false;
        rt.turnUsedOnce = false;
        this.deps.store.updateDirectSession(session.root_id, { auto_approve_override: null });
        await this.applySessionPosture(fresh, rt, false);
        return { toast: { type: "success", content: "已收回权限放开" }, ...card(false) };
      }
      return { toast: { type: "warning", content: "请确认是否放开权限" }, ...card(true) };
    }
    if (name === "perm_once") {
      rt.autoOnce = true;
      return { toast: { type: "success", content: "已设置为仅下一轮放开" }, ...card(false) };
    }
    this.deps.store.updateDirectSession(session.root_id, { auto_approve_override: "on" });
    await this.applySessionPosture(fresh, rt, true);
    return {
      toast: { type: "success", content: "已放开本会话权限（立即生效）" },
      ...card(false),
    };
  }

  private permissionCard(session: DirectSession, rt: SessionRuntime, confirm: boolean): unknown {
    if (!rt.turn) return null;
    const fresh = this.deps.store.getDirectSession(session.root_id) ?? session;
    const state: TurnCardState = {
      ...rt.turn,
      autoPosture: this.turnAutoPosture(fresh, rt),
      ...(rt.waitingApproval
        ? {
            waitingRemainingMs:
              rt.waitingSince !== null
                ? Math.max(
                    0,
                    this.deps.config().opencode.permission_timeout_ms -
                      (Date.now() - rt.waitingSince),
                  )
                : null,
          }
        : {}),
      agentOverride: fresh.agent_override,
    };
    if (confirm) state.confirmPermission = true;
    return buildTurnCard(state);
  }

  private handleInfoAction(
    name: string,
    session: DirectSession,
    rt: SessionRuntime,
    action: FeishuCardAction,
  ): CardActionReply {
    if (name.startsWith("auto_")) {
      const arg = name.slice("auto_".length);
      const result = this.applyAutoArg(session, rt, arg);
      this.refreshInfoCard(action.messageId, () => this.autoCard(this.freshSession(session), rt));
      return { toast: { type: result.toast, content: result.toastText } };
    }
    if (name === "collect_start") {
      if (rt.collect !== null) {
        return { toast: { type: "info", content: "已在收集模式" } };
      }
      rt.collect = [];
      this.armCollectTimer(session.root_id);
      this.refreshInfoCard(action.messageId, () => this.collectCard(rt, session.root_id));
      return { toast: { type: "success", content: "已进入收集模式" } };
    }
    if (name === "collect_cancel") {
      if (rt.collect === null) {
        return { toast: { type: "info", content: "当前不在收集模式" } };
      }
      const dropped = rt.collect.length;
      this.clearCollect(session.root_id);
      this.refreshInfoCard(action.messageId, () => this.collectCard(rt, session.root_id));
      return {
        toast: {
          type: "success",
          content: dropped === 0 ? "已退出收集模式" : `已退出收集模式，丢弃 ${dropped} 条`,
        },
      };
    }
    if (rt.collect === null) {
      return { toast: { type: "info", content: "当前不在收集模式" } };
    }
    const buffered = rt.collect;
    this.clearCollect(session.root_id);
    if (buffered.length === 0) {
      this.refreshInfoCard(action.messageId, () => this.collectCard(rt, session.root_id));
      return { toast: { type: "info", content: "没有待提交内容" } };
    }
    this.enqueueTurn(session.root_id, buffered.join("\n---\n"));
    this.refreshInfoCard(action.messageId, () => this.collectCard(rt, session.root_id));
    return { toast: { type: "success", content: `已提交 ${buffered.length} 条为一轮` } };
  }

  private freshSession(session: DirectSession): DirectSession {
    return this.deps.store.getDirectSession(session.root_id) ?? session;
  }

  private refreshInfoCard(messageId: string, build: () => unknown): void {
    const updateCard = this.deps.feishu.updateCard;
    if (!updateCard || messageId === "") return;
    this.deferAction(async () => {
      try {
        await updateCard.call(this.deps.feishu, messageId, build());
      } catch (e) {
        this.deps.logger.debug("direct info card refresh failed", {
          message_id: messageId,
          error: toTaskingError(e).message,
        });
      }
    });
  }

  private async replyInfoCard(
    session: DirectSession,
    card: unknown,
    fallbackText: string,
  ): Promise<void> {
    const replyCard = this.deps.feishu.replyCardInThread;
    if (replyCard) {
      try {
        await replyCard.call(this.deps.feishu, session.root_id, card);
        return;
      } catch (e) {
        this.deps.logger.warn("direct info card failed; falling back to text", {
          root_id: session.root_id,
          error: toTaskingError(e).message,
        });
      }
    }
    await this.replySafe(session.root_id, fallbackText);
  }

  private helpCard(): unknown {
    return buildInfoCard({
      title: "📖 直连会话帮助",
      lines: [
        "**续聊**：直接回复本话题 → 与 agent 对话（排队串行执行）",
        "**富输入**：直接发图片/文件 → 下载到工作区并把路径交给 agent",
        "",
        "**命令**",
        "`/collect` → 收集多条消息；`/send` 提交为一轮；`/cancel` 丢弃",
        "`/auto [on|once|off|reset]` → 本会话权限姿态（下一轮生效）",
        "`/name <文本>` → 会话改名（卡片头部与 TUI）",
        "`/agent <name>` · `/model <name>` → 切换 agent/model（`reset` 恢复）",
        "`/new` → 清空上下文开启新会话",
        "`/status` → 查看会话状态",
        "`/stop` → 中断当前任务（含清空排队）",
        "`/done` → 结束会话",
        "",
        "新建会话 → 在群里发 `/chat <项目|路径> <消息>`",
      ],
    });
  }

  private autoPostureOf(session: DirectSession, rt: SessionRuntime): "on" | "once" | "off" {
    if (session.auto_approve_override === "on") return "on";
    if (rt.autoOnce) return "once";
    return "off";
  }

  private autoCard(session: DirectSession, rt: SessionRuntime): unknown {
    const current = this.autoPostureOf(session, rt);
    const label =
      current === "on"
        ? translate("🔓 本会话放开")
        : current === "once"
          ? translate("⚡ 仅下一轮放开")
          : translate("🔒 默认（不传 --auto）");
    return buildInfoCard({
      title: "🔐 权限姿态",
      rootId: session.root_id,
      lines: [
        `当前：${label}`,
        this.autoSourceLabel(session),
        "",
        "放开后本会话后续轮次不再询问权限；目标仓库自身的 deny 规则仍然生效。",
      ],
      buttons: [
        {
          label: "🔓 本会话放开",
          action: "auto_on",
          type: current === "on" ? "primary" : "default",
        },
        {
          label: "⚡ 仅下一轮",
          action: "auto_once",
          type: current === "once" ? "primary" : "default",
        },
        {
          label: "🔒 恢复默认",
          action: "auto_off",
          type: current === "off" ? "primary" : "default",
        },
      ],
    });
  }

  private collectCard(rt: SessionRuntime, rootId: string): unknown {
    const buffered = rt.collect;
    if (buffered === null) {
      return buildInfoCard({
        title: "📥 收集模式",
        lines: [
          "把接下来的多条消息（含图片/文件）攒成**一轮**再执行。",
          "点下方按钮开始，或直接发 `/collect`。",
        ],
        buttons: [{ label: "📥 开始收集", action: "collect_start", type: "primary" }],
        rootId,
      });
    }
    const idleMinutes = Math.round(COLLECT_IDLE_TIMEOUT_MS / 60000);
    return buildInfoCard({
      title: "📥 收集模式",
      lines: [
        `📥 收集中：已收集 **${buffered.length}** 条待提交。`,
        "后续消息（含图片/文件）都会先收集，不立即执行。",
        `发完点下方按钮提交为一轮（或发 \`/send\`）；${idleMinutes} 分钟无新消息会自动提交。`,
        "（缓冲仅在内存，daemon 重启会丢失。）",
      ],
      buttons: [
        { label: "📤 提交为一轮", action: "collect_send", type: "primary" },
        { label: "🗑 丢弃", action: "collect_cancel", type: "danger" },
      ],
      rootId,
    });
  }

  private applyAutoArg(
    session: DirectSession,
    rt: SessionRuntime,
    arg: string,
  ): { text: string; toast: CardActionReply["toast"]["type"]; toastText: string } {
    if (arg === "on") {
      this.deps.store.updateDirectSession(session.root_id, { auto_approve_override: "on" });
      return {
        text: "🔓 已放开本会话权限（下一轮生效）。目标仓库自身的 deny 规则仍然生效；/auto reset 可恢复。",
        toast: "success",
        toastText: "已放开本会话权限",
      };
    }
    if (arg === "once") {
      rt.autoOnce = true;
      return {
        text: "⚡ 仅下一轮放开权限（用完自动恢复默认）。",
        toast: "success",
        toastText: "仅下一轮放开权限",
      };
    }
    if (arg === "off" || arg === "reset") {
      rt.autoOnce = false;
      this.deps.store.updateDirectSession(session.root_id, { auto_approve_override: null });
      return {
        text: `🔒 已恢复默认权限姿态（下一轮生效）。${this.autoSourceLabel(session)}`,
        toast: "success",
        toastText: "已恢复默认权限姿态",
      };
    }
    return {
      text: "用法：/auto（查看）｜/auto on｜/auto once｜/auto off｜/auto reset",
      toast: "warning",
      toastText: "未知的 /auto 参数",
    };
  }

  private handleLifecycleAction(
    name: string,
    session: DirectSession,
    rt: SessionRuntime,
    action: FeishuCardAction,
  ): CardActionReply {
    if (name === "cancel") {
      const restored = rt.turn
        ? { ...rt.turn, phase: rt.turnInFlight ? "running" : rt.turn.phase }
        : null;
      return {
        toast: { type: "info", content: "已取消" },
        ...(restored ? { card: buildTurnCard(restored) } : {}),
      };
    }
    if (name === "done") {
      const confirming = rt.turn ? { ...rt.turn, phase: "confirm" as TurnCardPhase } : null;
      return {
        toast: { type: "warning", content: "请确认是否结束会话" },
        ...(confirming ? { card: buildTurnCard(confirming) } : {}),
      };
    }
    this.deferAction(async () => this.executeDone(session, await this.operatorLabel(action)));
    const ended = rt.turn ? { ...rt.turn, sealed: true } : null;
    return {
      toast: { type: "success", content: "会话已结束" },
      ...(ended ? { card: buildTurnCard(ended) } : {}),
    };
  }

  private async operatorLabel(action: FeishuCardAction): Promise<string> {
    if (action.operatorName !== null && action.operatorName !== "") return action.operatorName;
    const openId = action.operatorOpenId;
    if (openId === null || openId === "") return "未知";
    const cached = this.memberCache.get(action.chatId);
    if (cached && Date.now() - cached.at < MEMBER_CACHE_TTL_MS) {
      const hit = cached.names.get(openId);
      if (hit !== undefined && hit !== "") return hit;
    }
    const names = await this.fetchMemberNames(action.chatId);
    const name = names?.get(openId);
    return name !== undefined && name !== "" ? name : openId;
  }

  private async fetchMemberNames(chatId: string): Promise<Map<string, string> | null> {
    const list = this.deps.feishu.listChatMembers;
    if (!list || chatId === "") return null;
    try {
      const members = await list.call(this.deps.feishu, chatId);
      const names = new Map(members.map((m) => [m.open_id, m.name]));
      this.memberCache.set(chatId, { at: Date.now(), names });
      return names;
    } catch (e) {
      this.deps.logger.debug("direct member lookup failed", {
        chat_id: chatId,
        error: toTaskingError(e).message,
      });
      return this.memberCache.get(chatId)?.names ?? null;
    }
  }

  private deferAction(work: () => Promise<void>): void {
    this.pendingWork++;
    setImmediate(() => {
      void work()
        .catch((e) =>
          this.deps.logger.warn("direct card action failed", {
            error: toTaskingError(e).message,
          }),
        )
        .finally(() => {
          this.pendingWork = Math.max(0, this.pendingWork - 1);
        });
    });
  }

  private claimCardAction(action: FeishuCardAction): boolean {
    const key = `${action.messageId}:${action.operatorOpenId ?? ""}:${JSON.stringify(action.value ?? null)}`;
    const now = Date.now();
    for (const [seen, ts] of this.cardActionSeen) {
      if (now - ts > CARD_ACTION_DEDUP_MS) this.cardActionSeen.delete(seen);
    }
    if (this.cardActionSeen.has(key)) return false;
    this.cardActionSeen.set(key, now);
    return true;
  }

  private async enqueueRetry(rootId: string, prompt: string, fromTurn: number): Promise<void> {
    const rt = this.runtimeFor(rootId);
    if (rt.turnInFlight) {
      rt.queue.push(prompt);
      return;
    }
    void this.runTurnLoop(rootId, prompt, fromTurn).catch((e) =>
      this.deps.logger.error("direct retry turn failed", {
        root_id: rootId,
        error: toTaskingError(e).message,
      }),
    );
  }

  async handleIntakeMessage(m: FeishuPolledMessage): Promise<boolean> {
    const config = this.deps.config();
    if (!isDirectEnabled(config)) return false;
    const parsed = parseChat(m.text);
    if (!parsed) return false;
    try {
      if (parsed.kind === "list") {
        await this.deps.feishu.replyFlat(
          m.message_id,
          this.renderProjectList(config.feishu.direct),
        );
        return true;
      }
      if (parsed.kind === "help") {
        await this.deps.feishu.replyFlat(m.message_id, renderChatHelp("intake"));
        return true;
      }
      if (parsed.message.trim() === "") {
        await this.deps.feishu.replyFlat(
          m.message_id,
          "请在 /chat 命令后带上首条消息，例如 `/chat tasking 帮我跑下测试`",
        );
        return true;
      }
      const existing = this.deps.store.getDirectSession(m.message_id);
      if (existing) {
        this.deps.logger.debug("direct chat root re-delivered; skipping silently", {
          root_id: m.message_id,
          status: existing.status,
        });
        return true;
      }
      const target = this.resolveTarget(parsed.target ?? "", parsed.isPath, config.feishu.direct);
      if ("error" in target) {
        await this.deps.feishu.replyFlat(m.message_id, target.error);
        return true;
      }
      const dir = target.path;
      this.deps.store.upsertDirectSession({
        root_id: m.message_id,
        chat_id: m.chat_id,
        project: parsed.isPath ? null : (parsed.target ?? "").toLowerCase(),
        name: sessionName(parsed.message),
        path: dir,
        session_id: null,
        status: "idle",
      });
      const detailedCards =
        config.feishu.direct.verbosity === "detailed" &&
        typeof this.deps.feishu.replyCardInThread === "function";
      if (!detailedCards) {
        const label = parsed.isPath
          ? translate(`目录 ${basename(dir)}`)
          : translate(`项目 ${parsed.target}`);
        await this.replySafe(m.message_id, `✅ 会话已创建（${label}），正在开始…`);
      }
      void this.fetchMemberNames(m.chat_id);
      this.enqueueTurn(m.message_id, parsed.message);
      return true;
    } catch (e) {
      this.deps.logger.warn("direct chat intake failed", {
        msg_id: m.message_id,
        error: toTaskingError(e).message,
      });
      await this.deps.feishu
        .replyFlat(m.message_id, `⚠️ /chat 处理失败：${toTaskingError(e).message}`)
        .catch(() => {});
      return true;
    }
  }

  async handleThreadMessage(m: FeishuPolledMessage): Promise<boolean> {
    const config = this.deps.config();
    if (!isDirectEnabled(config)) return false;
    if (m.root_id === null) return false;
    const session = this.deps.store.getDirectSession(m.root_id);
    if (!session) return false;
    const curSec = toSecondsStr(session.last_msg_id ?? "");
    if (curSec !== "") {
      const t = Number(m.create_time);
      if (t < Number(curSec)) return true;
      if (t === Number(curSec) && session.seen_ids.includes(m.message_id)) return true;
    }
    this.deps.store.advanceDirectCursor(m.root_id, m.message_id, m.create_time);
    if (m.sender_type === "app") return true;
    if (session.status === "done" || session.status === "expired") {
      if (!this.terminalHintedRoots.has(m.root_id)) {
        this.terminalHintedRoots.add(m.root_id);
        await this.replySafe(
          m.root_id,
          session.status === "done"
            ? "ℹ️ 此会话已结束（/done）。重新发起请 /chat 创建新会话。"
            : "ℹ️ 此会话已过期。重新发起请 /chat 创建新会话。",
        );
      }
      return true;
    }
    const trimmed = m.text.trim();
    if (trimmed === "/done") {
      await this.executeDone(session);
      return true;
    }
    if (trimmed === "/stop") {
      await this.executeStop(session);
      return true;
    }
    if (trimmed === "/help" || trimmed === "/?") {
      await this.replyInfoCard(session, this.helpCard(), renderChatHelp("thread"));
      return true;
    }
    if (trimmed === "/collect") {
      await this.executeCollect(session);
      return true;
    }
    if (trimmed === "/send") {
      await this.executeSend(session);
      return true;
    }
    if (trimmed === "/cancel") {
      await this.executeCancel(session);
      return true;
    }
    if (trimmed === "/name" || trimmed.startsWith("/name ")) {
      await this.executeName(session, trimmed);
      return true;
    }
    if (trimmed === "/status") {
      await this.replyStatus(session);
      return true;
    }
    if (trimmed === "/new") {
      await this.executeNew(session);
      return true;
    }
    if (trimmed === "/auto" || trimmed.startsWith("/auto ")) {
      await this.executeAuto(session, trimmed);
      return true;
    }
    if (trimmed === "/agent" || trimmed.startsWith("/agent ")) {
      await this.executeAgent(session, trimmed);
      return true;
    }
    if (trimmed === "/model" || trimmed.startsWith("/model ")) {
      await this.executeModel(session, trimmed);
      return true;
    }
    if (trimmed.startsWith("/")) {
      await this.replySafe(
        m.root_id,
        "未知命令。直连会话支持：直接回复续聊、/collect、/send、/cancel、/auto、/agent、/model、/new、/name、/status、/stop、/done、/help",
      );
      return true;
    }
    const attachments = m.attachments ?? [];
    if (trimmed === "" && attachments.length === 0) {
      await this.replySafe(m.root_id, "⚠️ 暂仅支持文本消息，图片/文件请用文字描述～");
      return true;
    }
    const prompt = await this.composePromptWithAttachments(session, m, trimmed);
    if (prompt === null) {
      await this.replySafe(
        m.root_id,
        "⚠️ 附件未能读取，本轮未执行；请重发，或把文件放到工作目录后把路径发给我。",
      );
      return true;
    }
    const rt = this.runtimeFor(m.root_id);
    if (rt.collect !== null) {
      rt.collect.push(prompt);
      this.armCollectTimer(session.root_id);
      await this.replySafe(
        m.root_id,
        `📥 已收集 ${rt.collect.length} 条（/send 提交为一轮，/cancel 丢弃）`,
      );
      return true;
    }
    this.enqueueTurn(m.root_id, prompt);
    return true;
  }

  async recover(): Promise<void> {
    const running = this.deps.store.listDirectSessionsByStatus("running");
    for (const s of running) {
      this.deps.store.markDirectSessionStatus(s.root_id, "idle");
      await this.finalizeStoredCard(
        s,
        "interrupted",
        "idle",
        true,
        "daemon 重启，上一轮已中断；工具明细未保留，可点「重试」重跑上一轮。",
      );
      await this.replySafe(
        s.root_id,
        "⚠️ 上次运行被中断（daemon 重启），请重发消息继续；若当时是第一轮对话，此前内容不会保留。",
      );
    }
  }

  private async finalizeStoredCard(
    session: DirectSession,
    phase: TurnCardPhase,
    sessionStatus: TurnCardSessionStatus,
    hideFullDetail: boolean,
    note = "",
    sealed = false,
  ): Promise<void> {
    const cardId = session.card_message_id;
    const updateCard = this.deps.feishu.updateCard;
    if (!cardId || !updateCard) return;
    const state: TurnCardState = {
      rootId: session.root_id,
      sessionName: session.name ?? sessionName(session.path),
      sessionStatus,
      turns: session.turns,
      totalTokens: session.total_tokens,
      queued: 0,
      turn: session.turns,
      phase,
      toolCalls: 0,
      durationSec: 0,
      turnTokens: 0,
      texts: note === "" ? [] : [note],
      tools: [],
    };
    if (hideFullDetail) state.hideFullDetail = true;
    if (sealed) state.sealed = true;
    this.runtimeFor(session.root_id).turn = state;
    try {
      await updateCard.call(this.deps.feishu, cardId, buildTurnCard(state));
    } catch (e) {
      this.deps.logger.warn("direct card finalize failed", {
        root_id: session.root_id,
        error: toTaskingError(e).message,
      });
    }
  }

  listActive(): RuntimeDirectSession[] {
    const sessions = this.deps.store.listActiveDirectSessions();
    const config = this.deps.config();
    return sessions.map((s) => {
      const rt = this.runtime.get(s.root_id);
      return {
        id: `direct:${s.root_id}`,
        root_id: s.root_id,
        name: s.name,
        project: s.project,
        path: s.path,
        status: s.status === "running" ? "running" : "idle",
        session_id: s.session_id,
        queued: rt?.queue.length ?? 0,
        updated_at: s.updated_at,
        agent: config.opencode.agent,
        model: config.opencode.model,
        variant: config.opencode.variant,
        turns: s.turns,
        input_tokens: s.input_tokens,
        output_tokens: s.output_tokens,
        total_tokens: s.total_tokens,
        ...(rt?.waitingApproval
          ? {
              waiting_approval: true,
              waiting_remaining_ms:
                rt.waitingSince !== null
                  ? Math.max(
                      0,
                      config.opencode.permission_timeout_ms - (Date.now() - rt.waitingSince),
                    )
                  : null,
            }
          : {}),
      };
    });
  }

  aggregateTotals(): { input_tokens: number; output_tokens: number; total_tokens: number } {
    return {
      input_tokens: this.aggregate.inputTokens,
      output_tokens: this.aggregate.outputTokens,
      total_tokens: this.aggregate.totalTokens,
    };
  }

  private async cleanupSession(session: DirectSession): Promise<void> {
    this.clearCollect(session.root_id);
    this.runtime.delete(session.root_id);
    rmSync(join(this.deps.config().workspace.root, "direct-inbox", session.root_id), {
      recursive: true,
      force: true,
    });
    this.deps.clearActivity?.(`direct:${session.root_id}`);
    const remove = this.deps.deleteSession;
    const sessionId = session.session_id;
    if (!remove || !sessionId) return;
    try {
      await remove(sessionId);
    } catch (e) {
      this.deps.logger.warn("direct session delete failed", {
        root_id: session.root_id,
        error: toTaskingError(e).message,
      });
    }
  }

  expireIdle(now: number = Date.now()): number {
    const ttl = this.deps.config().feishu.direct.idle_ttl_ms;
    const expired = this.deps.store.listExpiredDirectSessions(now - ttl);
    for (const s of expired) {
      this.deps.store.markDirectSessionStatus(s.root_id, "expired");
      this.terminalHintedRoots.add(s.root_id);
      this.pendingWork++;
      void this.finalizeStoredCard(s, "expired", "expired", true, "", true).finally(() => {
        this.pendingWork = Math.max(0, this.pendingWork - 1);
      });
      void this.replySafe(s.root_id, "ℹ️ 会话空闲超时已过期。重新发起请 /chat 创建新会话。");
      void this.cleanupSession(s).catch((e) =>
        this.deps.logger.warn("direct session expiry cleanup failed", {
          root_id: s.root_id,
          error: toTaskingError(e).message,
        }),
      );
    }
    return expired.length;
  }

  private renderProjectList(direct: DirectConfig): string {
    const names = Object.keys(direct.projects);
    const lines: string[] = ["可用项目:"];
    if (names.length === 0) {
      lines.push("（未配置 — 可用 /chat /绝对路径 <消息> 直接在目录创建会话）");
    } else {
      for (const name of names) {
        lines.push(`  ${name} → ${direct.projects[name]?.path ?? ""}`);
      }
      lines.push("用法: /chat <项目名> <消息>");
    }
    lines.push("或: /chat /绝对路径 <消息> 在任意目录创建会话");
    return lines.join("\n");
  }

  private resolveTarget(
    target: string,
    isPath: boolean,
    direct: DirectConfig,
  ): { path: string } | { error: string } {
    let candidate: string;
    if (isPath) {
      candidate = target;
    } else {
      const entry = direct.projects[target.toLowerCase()];
      if (!entry) {
        return { error: `⚠️ 未找到项目 "${target}"。\n${this.renderProjectList(direct)}` };
      }
      candidate = entry.path;
    }
    if (!existsSync(candidate)) {
      return { error: `⚠️ 路径不存在: ${candidate}` };
    }
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      return { error: `⚠️ 无法解析路径: ${candidate}` };
    }
    if (
      isPath &&
      direct.path_roots.length > 0 &&
      !direct.path_roots.some((root) => real === root || real.startsWith(`${root}/`))
    ) {
      return {
        error: `⚠️ ${target} 不在允许的路径范围内（path_roots）。\n${this.renderProjectList(direct)}`,
      };
    }
    if (!statSync(real).isDirectory()) {
      return { error: `⚠️ 不是目录: ${candidate}` };
    }
    return { path: real };
  }

  private turnAutoPosture(session: DirectSession, rt: SessionRuntime): "on" | "once" | "off" {
    const posture = this.autoPostureOf(session, rt);
    if (posture === "on") return "on";
    return rt.autoOnce || rt.turnUsedOnce ? "once" : "off";
  }

  private resolveTurnAutoApprove(session: DirectSession, rt: SessionRuntime): boolean {
    const once = rt.autoOnce;
    rt.autoOnce = false;
    rt.turnUsedOnce = once;
    if (once || session.auto_approve_override === "on") return true;
    return this.resolveAutoApprove(session.project ?? "", false, this.deps.config().feishu.direct);
  }

  private resolveAutoApprove(target: string, isPath: boolean, direct: DirectConfig): boolean {
    if (!isPath) {
      const entry = direct.projects[target.toLowerCase()];
      if (entry && entry.auto_approve !== null) return entry.auto_approve;
    }
    return direct.auto_approve;
  }

  private runtimeFor(rootId: string): SessionRuntime {
    let rt = this.runtime.get(rootId);
    if (!rt) {
      rt = {
        queue: [],
        turnInFlight: false,
        abort: null,
        stopRequested: false,
        cardId: null,
        cardsAvailable: true,
        turn: null,
        turnStartedAt: 0,
        flushedTools: 0,
        autoOnce: false,
        turnUsedOnce: false,
        postureOpen: false,
        waitingApproval: false,
        waitingSince: null,
        heartbeatTimer: null,
        collect: null,
        collectTimer: null,
        fullDetail: [],
        fullDetailBytes: 0,
        fullDetailDropped: 0,
        flushTimer: null,
        flushInFlight: false,
        flushQueued: false,
        flushPromise: null,
      };
      this.runtime.set(rootId, rt);
    }
    return rt;
  }

  private enqueueTurn(rootId: string, message: string): void {
    const rt = this.runtimeFor(rootId);
    if (rt.turnInFlight) {
      rt.queue.push(message);
      if (this.cardsLive(rt)) {
        this.flushTurnCardSafe(rootId);
      } else {
        const mergeNote = rt.queue.length >= 2 ? translate("（多条排队消息将合并为一轮执行）") : "";
        void this.replySafe(rootId, `⏳ 已排队，当前任务完成后自动继续。${mergeNote}`);
      }
      return;
    }
    void this.runTurnLoop(rootId, message).catch((e) =>
      this.deps.logger.error("direct turn loop failed", {
        root_id: rootId,
        error: toTaskingError(e).message,
      }),
    );
  }

  private async runTurnLoop(
    rootId: string,
    firstMessage: string,
    retryFromTurn?: number,
  ): Promise<void> {
    const rt = this.runtimeFor(rootId);
    rt.turnInFlight = true;
    rt.stopRequested = false;
    try {
      let prompt = firstMessage;
      let retriedFrom = retryFromTurn;
      for (;;) {
        const session = this.deps.store.getDirectSession(rootId);
        if (!session || session.status === "done" || session.status === "expired") break;
        if (this.halted || rt.stopRequested) break;
        await this.sealTurnCard(rt);
        const max = this.deps.config().feishu.direct.max_concurrent;
        const busy = this.activeTurns >= max || this.dirSlotFor(session.path).busy;
        await this.startTurnCard(session, rt, busy, retriedFrom);
        if (busy && !this.cardsLive(rt)) {
          await this.replySafe(
            rootId,
            "⏳ 目标目录或并发额度正被占用，排队等待中，空闲后自动开始…",
          );
        }
        await this.acquireDir(session.path);
        try {
          await this.acquireSlot();
          try {
            if (this.halted || rt.stopRequested) break;
            await this.executeTurn(session, prompt, rt);
          } finally {
            this.releaseSlot();
          }
        } finally {
          this.releaseDir(session.path);
        }
        if (rt.queue.length === 0) break;
        prompt = rt.queue.join("\n---\n");
        rt.queue = [];
        retriedFrom = undefined;
      }
    } finally {
      rt.turnInFlight = false;
    }
  }

  private cardsLive(rt: SessionRuntime): boolean {
    return rt.cardsAvailable && rt.cardId !== null && rt.turn !== null;
  }

  private async startTurnCard(
    session: DirectSession,
    rt: SessionRuntime,
    busy: boolean,
    retryFromTurn: number | undefined,
  ): Promise<void> {
    const fresh = this.deps.store.getDirectSession(session.root_id) ?? session;
    await rt.flushPromise?.catch(() => {});
    const prev = rt.turn;
    if (prev !== null && prev.tools.length > rt.flushedTools) {
      const pending = prev.tools.slice(rt.flushedTools);
      rt.flushedTools = prev.tools.length;
      await this.replySafe(prev.rootId, truncate(toolTextLines(pending), 2000));
    }
    const state: TurnCardState = {
      rootId: session.root_id,
      sessionName: fresh.name ?? sessionName(fresh.path),
      sessionStatus: busy ? "queued" : fresh.status,
      turns: fresh.turns,
      totalTokens: fresh.total_tokens,
      queued: rt.queue.length,
      turn: fresh.turns + 1,
      phase: "running",
      toolCalls: 0,
      durationSec: 0,
      turnTokens: 0,
      texts: [],
      tools: [],
    };
    if (retryFromTurn !== undefined) state.retryFromTurn = retryFromTurn;
    rt.turn = state;
    rt.turnUsedOnce = false;
    rt.turnStartedAt = 0;
    rt.flushedTools = 0;
    rt.fullDetail = [];
    rt.fullDetailBytes = 0;
    rt.fullDetailDropped = 0;
    const detailed = this.deps.config().feishu.direct.verbosity === "detailed";
    const replyCard = this.deps.feishu.replyCardInThread;
    rt.cardsAvailable = true;
    if (!detailed || !replyCard) {
      rt.cardsAvailable = false;
      return;
    }
    try {
      const created = await replyCard.call(this.deps.feishu, session.root_id, buildTurnCard(state));
      rt.cardId = created.message_id;
      this.deps.store.updateDirectSession(session.root_id, { card_message_id: created.message_id });
      if (created.thread_id) {
        this.deps.store.updateDirectSession(session.root_id, { thread_id: created.thread_id });
      }
    } catch (e) {
      rt.cardsAvailable = false;
      rt.cardId = null;
      this.deps.logger.warn("direct card create failed; falling back to text", {
        root_id: session.root_id,
        error: toTaskingError(e).message,
      });
    }
  }

  private async sealTurnCard(rt: SessionRuntime): Promise<void> {
    if (!rt.turn || rt.cardId === null) return;
    const updateCard = this.deps.feishu.updateCard;
    const cardId = rt.cardId;
    const turn = rt.turn;
    const renderedTools = turn.tools.length;
    const sealed: TurnCardState = { ...rt.turn, sealed: true };
    rt.cardId = null;
    if (!updateCard) return;
    try {
      await updateCard.call(this.deps.feishu, cardId, buildTurnCard(sealed));
      if (rt.turn === turn) rt.flushedTools = Math.max(rt.flushedTools, renderedTools);
    } catch (e) {
      this.deps.logger.warn("direct card seal failed", {
        root_id: rt.turn.rootId,
        error: toTaskingError(e).message,
      });
    }
  }

  private scheduleFlush(rootId: string): void {
    const rt = this.runtimeFor(rootId);
    if (!rt.turn) return;
    if (rt.flushTimer) return;
    rt.flushTimer = setTimeout(() => {
      rt.flushTimer = null;
      this.flushTurnCardSafe(rootId);
    }, CARD_UPDATE_INTERVAL_MS);
    rt.flushTimer.unref?.();
  }

  private flushSoon(rootId: string): void {
    const rt = this.runtimeFor(rootId);
    if (rt.flushTimer) {
      clearTimeout(rt.flushTimer);
      rt.flushTimer = null;
    }
    this.flushTurnCardSafe(rootId);
  }

  private flushTurnCardSafe(rootId: string): void {
    void this.flushTurnCard(rootId).catch((e) =>
      this.deps.logger.debug("direct card flush failed", {
        root_id: rootId,
        error: toTaskingError(e).message,
      }),
    );
  }

  private async flushTurnCard(rootId: string): Promise<void> {
    const rt = this.runtimeFor(rootId);
    if (rt.turn === null) return;
    if (rt.flushInFlight) {
      rt.flushQueued = true;
      return;
    }
    rt.flushInFlight = true;
    const flight = this.flushTurnCardInner(rootId);
    rt.flushPromise = flight;
    try {
      await flight;
    } finally {
      rt.flushPromise = null;
      rt.flushInFlight = false;
      if (rt.flushQueued) {
        rt.flushQueued = false;
        this.flushSoon(rootId);
      }
    }
  }

  private async flushTurnCardInner(rootId: string): Promise<void> {
    const rt = this.runtimeFor(rootId);
    const turn = rt.turn;
    if (!turn) return;
    if (rt.flushTimer) {
      clearTimeout(rt.flushTimer);
      rt.flushTimer = null;
    }
    const fresh = this.deps.store.getDirectSession(rootId);
    if (fresh) {
      turn.sessionName = fresh.name ?? sessionName(fresh.path);
      turn.autoPosture = this.turnAutoPosture(fresh, rt);
      turn.agentOverride = fresh.agent_override;
      turn.waitingRemainingMs = rt.waitingApproval
        ? rt.waitingSince !== null
          ? Math.max(
              0,
              this.deps.config().opencode.permission_timeout_ms - (Date.now() - rt.waitingSince),
            )
          : null
        : undefined;
      if (rt.turnStartedAt > 0) {
        turn.sessionStatus = fresh.status;
        turn.turns = fresh.turns;
        turn.totalTokens = fresh.total_tokens;
      }
    }
    turn.queued = rt.queue.length;
    if (turn.phase === "running" && rt.turnStartedAt > 0) {
      turn.durationSec = Math.max(1, Math.round((Date.now() - rt.turnStartedAt) / 1000));
    }
    const updateCard = this.deps.feishu.updateCard;
    if (rt.cardsAvailable && rt.cardId !== null && updateCard) {
      const renderedTools = turn.tools.length;
      const applySuccess = (): void => {
        if (rt.turn === turn) rt.flushedTools = Math.max(rt.flushedTools, renderedTools);
      };
      try {
        await updateCard.call(this.deps.feishu, rt.cardId, buildTurnCard(turn));
        applySuccess();
        return;
      } catch (e) {
        this.deps.logger.warn("direct card update failed", {
          root_id: rootId,
          error: toTaskingError(e).message,
        });
        if (!isRetryableCardError(e)) {
          rt.cardsAvailable = false;
        } else {
          const base = this.deps.cardRetryDelayMs ?? CARD_RETRY_DELAY_MS;
          const jitter = base <= 0 ? 0 : Math.floor(Math.random() * CARD_RETRY_JITTER_MS);
          await sleepUnrefed(base + jitter);
          if (rt.turn === turn && rt.cardId !== null) {
            try {
              await updateCard.call(this.deps.feishu, rt.cardId, buildTurnCard(turn));
              applySuccess();
              return;
            } catch (retryError) {
              this.deps.logger.warn("direct card update retry failed; falling back to text", {
                root_id: rootId,
                error: toTaskingError(retryError).message,
              });
              rt.cardsAvailable = false;
            }
          }
        }
      }
    }
    if (rt.turn !== turn) return;
    if (this.deps.config().feishu.direct.verbosity !== "detailed") return;
    const pending = turn.tools.slice(rt.flushedTools);
    rt.flushedTools = turn.tools.length;
    if (pending.length === 0) return;
    await this.replySafe(rootId, truncate(toolTextLines(pending), 2000));
  }

  private accumulateTool(rt: SessionRuntime, evt: TurnDriverEvent): void {
    const panel: TurnCardToolEvent = { tool: evt.tool ?? "tool" };
    if (evt.title !== undefined) panel.title = evt.title;
    if (evt.status !== undefined) panel.status = evt.status;
    if (evt.exit !== undefined) panel.exit = evt.exit;
    if (evt.durationMs !== undefined) panel.durationMs = evt.durationMs;
    if (evt.input !== undefined) panel.input = evt.input;
    if (evt.output !== undefined) panel.output = evt.output;
    if (evt.error !== undefined) panel.error = evt.error;
    if (evt.truncated !== undefined) panel.truncated = evt.truncated;
    rt.fullDetail.push(panel);
    rt.fullDetailBytes += fullDetailBytes(panel);
    while (rt.fullDetailBytes > FULL_DETAIL_MAX_BYTES && rt.fullDetail.length > 1) {
      const dropped = rt.fullDetail.shift();
      if (dropped) rt.fullDetailBytes -= fullDetailBytes(dropped);
      rt.fullDetailDropped++;
    }
    rt.turn?.tools.push(panel);
  }

  private async sendCompletion(
    session: DirectSession,
    delivery: { answer: string; body: string; statsLine: string; note: string },
  ): Promise<void> {
    const verbosity = this.deps.config().feishu.direct.verbosity;
    const replyCard = this.deps.feishu.replyCardInThread;
    if (verbosity !== "detailed" || !replyCard) {
      await this.replySafe(session.root_id, delivery.body);
      return;
    }
    const card = buildCompletionCard({
      answer: delivery.answer,
      statsLine: delivery.statsLine,
      note: delivery.note,
    });
    if (JSON.stringify(card).length <= CARD_BUDGET_BYTES) {
      try {
        await replyCard.call(this.deps.feishu, session.root_id, card);
        return;
      } catch (e) {
        this.deps.logger.warn("direct completion card failed; falling back to text", {
          root_id: session.root_id,
          error: toTaskingError(e).message,
        });
      }
    }
    const markdown = `${delivery.answer}\n\n${[delivery.statsLine, delivery.note]
      .filter((part) => part !== "")
      .join("\n")}`.trim();
    if (markdown.length <= MAX_MESSAGE_CHARS) {
      await this.replySafe(session.root_id, markdown);
      return;
    }
    await this.deliverLongContent(
      session.root_id,
      markdown,
      `direct-answer-${session.turns}.md`,
      "回答过长，无法作为消息发送；请在 TUI 活动视图查看该会话的完整回答。",
      "（回答过长，文件上传不可用，已改为文本投递；完整内容亦可在 TUI 活动视图查看）",
    );
  }

  private async deliverLongContent(
    rootId: string,
    markdown: string,
    fileName: string,
    oversizeNote: string,
    unavailableNote: string,
  ): Promise<void> {
    const bytes = Buffer.from(markdown, "utf8");
    const upload = this.deps.feishu.uploadFile;
    const sendFile = this.deps.feishu.sendFileMessage;
    if (!upload || !sendFile) {
      this.deps.logger.warn("direct file upload unavailable; sending text", { root_id: rootId });
    }
    if (upload && sendFile) {
      try {
        const key = await upload.call(this.deps.feishu, bytes, fileName);
        if (key !== "") {
          await sendFile.call(this.deps.feishu, rootId, key);
          return;
        }
      } catch (e) {
        this.deps.logger.warn("direct file delivery failed; falling back to text", {
          root_id: rootId,
          error: toTaskingError(e).message,
        });
      }
    }
    if (bytes.length > FULL_TEXT_LIMIT_BYTES) {
      await this.replySafe(rootId, oversizeNote);
      return;
    }
    await this.replySafe(rootId, `${markdown}\n\n${unavailableNote}`);
  }

  private async sendFullDetail(session: DirectSession, rt: SessionRuntime): Promise<void> {
    if (rt.fullDetail.length === 0) {
      await this.replySafe(
        session.root_id,
        "该轮没有可导出的完整明细（可能因 daemon 重启，明细已不在内存中）。",
      );
      return;
    }
    const markdown = renderFullDetail(session, rt.turn, rt.fullDetail, rt.fullDetailDropped);
    await this.deliverLongContent(
      session.root_id,
      markdown,
      fullDetailFileName(rt.turn?.turn ?? 0),
      "完整输出过大，无法作为消息发送；请在 TUI 活动视图查看该会话的完整明细。",
      "（文件上传不可用，已改为文本投递；完整明细亦可在 TUI 活动视图查看）",
    );
  }

  private async finalizeTurnCard(
    rootId: string,
    phase: TurnCardPhase,
    stats: TurnStats,
    durationSec: number,
    dropFinalText = false,
  ): Promise<void> {
    const rt = this.runtimeFor(rootId);
    if (!rt.turn) return;
    rt.turn.toolCalls = stats.toolCalls;
    rt.turn.turnTokens = stats.totalTokens;
    if (dropFinalText) rt.turn.finalized = true;
    await this.finalizeCardPhase(rootId, phase, durationSec);
  }

  private beginInterrupt(session: DirectSession, rt: SessionRuntime): number {
    const queued = rt.queue.length;
    rt.queue = [];
    rt.stopRequested = true;
    rt.abort?.abort();
    this.deps.store.markDirectSessionStatus(session.root_id, "idle");
    return queued;
  }

  private async announceInterrupt(
    rootId: string,
    queued: number,
    operator?: string,
  ): Promise<void> {
    const who = operator ? translate(`（操作人：${operator}）`) : "";
    await this.replySafe(
      rootId,
      queued > 0
        ? `🛑 已中断当前任务${who}，并清空 ${queued} 条排队消息。可直接回复重新继续。`
        : `🛑 已中断当前任务${who}。可直接回复重新继续。`,
    );
  }

  private async sealCurrentCard(rootId: string): Promise<void> {
    const rt = this.runtimeFor(rootId);
    if (!rt.turn) return;
    rt.turn.sealed = true;
    await this.flushTurnCard(rootId);
  }

  private stopHeartbeat(rt: SessionRuntime): void {
    if (rt.heartbeatTimer) {
      clearInterval(rt.heartbeatTimer);
      rt.heartbeatTimer = null;
    }
  }

  private async finalizeCardPhase(
    rootId: string,
    phase: TurnCardPhase,
    durationSec?: number,
  ): Promise<void> {
    const rt = this.runtimeFor(rootId);
    if (!rt.turn) return;
    rt.turn.phase = phase;
    if (durationSec !== undefined) rt.turn.durationSec = durationSec;
    await this.flushTurnCard(rootId);
  }

  private async acquireSlot(): Promise<void> {
    const max = this.deps.config().feishu.direct.max_concurrent;
    if (this.activeTurns < max) {
      this.activeTurns++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeTurns = Math.max(0, this.activeTurns - 1);
  }

  private async executeTurn(
    session: DirectSession,
    prompt: string,
    rt: SessionRuntime,
  ): Promise<void> {
    const config = this.deps.config();
    const sessionId = session.session_id;
    const isFirstTurn = sessionId === null;
    const autoApprove = this.resolveTurnAutoApprove(session, rt);
    this.deps.logger.info("direct turn starting", {
      root_id: session.root_id,
      dir: session.path,
      agent: session.agent_override ?? config.opencode.agent,
      model: session.model_override ?? config.opencode.model ?? null,
      auto_approve: autoApprove,
      continuation: !isFirstTurn,
      session_id: sessionId ?? undefined,
      poll_interval_ms: config.opencode.poll_interval_ms,
      message: truncate(prompt, 60),
    });
    this.deps.store.updateDirectSession(session.root_id, { status: "running" });
    this.deps.store.updateDirectSession(session.root_id, { last_prompt: prompt });
    rt.stopRequested = false;

    rt.turnStartedAt = Date.now();
    const startedAt = rt.turnStartedAt;
    this.stopHeartbeat(rt);
    rt.heartbeatTimer = setInterval(() => {
      this.flushTurnCardSafe(session.root_id);
    }, CARD_HEARTBEAT_MS);
    rt.heartbeatTimer.unref?.();
    const turnNo = session.turns + 1;
    this.deps.store.addDirectSessionUsage(
      session.root_id,
      { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      1,
    );
    const stats: TurnStats = {
      toolCalls: 0,
      permissionRejections: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      lastText: "",
    };
    const abort = new AbortController();
    rt.abort = abort;

    const onEvent = (evt: TurnDriverEvent): void => {
      if (evt.type === "tool_use") {
        stats.toolCalls++;
        if (
          evt.status === "error" &&
          typeof evt.error === "string" &&
          /permission/i.test(evt.error)
        ) {
          stats.permissionRejections++;
        }
        this.accumulateTool(rt, evt);
        if (rt.turn) rt.turn.toolCalls = stats.toolCalls;
        const panel = rt.fullDetail[rt.fullDetail.length - 1];
        if (panel !== undefined && isFailed(panel)) this.flushSoon(session.root_id);
        else this.scheduleFlush(session.root_id);
      }
      if (evt.type === "text" && typeof evt.text === "string" && evt.text.trim() !== "") {
        stats.lastText = evt.text;
        if (rt.turn) rt.turn.texts.push(evt.text);
        this.scheduleFlush(session.root_id);
      }
      if (this.deps.activity) {
        const activity: ActivityEvent = { ts: Date.now(), turn: turnNo, type: evt.type };
        if (evt.text !== undefined) activity.text = evt.text;
        if (evt.tool !== undefined) activity.tool = evt.tool;
        if (evt.usage !== undefined) {
          activity.tokens = {
            input: evt.usage.input_tokens,
            output: evt.usage.output_tokens,
            total: evt.usage.total_tokens,
          };
        }
        if (evt.title !== undefined) activity.title = evt.title;
        if (evt.input !== undefined) activity.input = evt.input;
        if (evt.output !== undefined) activity.output = evt.output;
        if (evt.error !== undefined) activity.error = evt.error;
        if (evt.exit !== undefined) activity.exit = evt.exit;
        if (evt.status !== undefined) activity.status = evt.status;
        if (evt.durationMs !== undefined) activity.durationMs = evt.durationMs;
        if (evt.truncated !== undefined) activity.truncated = evt.truncated;
        this.deps.activity(`direct:${session.root_id}`, activity);
      }
    };

    const turnDriver =
      this.deps.turnDriver ?? defaultDriverFor(this.deps.apiExec ?? defaultApiExec());
    let result: Awaited<ReturnType<DirectTurnDriver>>;
    try {
      result = await turnDriver({
        command: config.opencode.command,
        serverUrl: config.opencode.server_url,
        directory: session.path,
        prompt,
        sessionId,
        autoApprove,
        postureOpen: rt.postureOpen,
        agent: session.agent_override ?? config.opencode.agent,
        model: session.model_override ?? config.opencode.model,
        variant: config.opencode.variant,
        pollIntervalMs: config.opencode.poll_interval_ms,
        permissionTimeoutMs: config.opencode.permission_timeout_ms,
        turnTimeoutMs: config.opencode.turn_timeout_ms,
        inactivityTimeoutMs: config.opencode.inactivity_timeout_ms,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        onEvent,
        onPendingPermissions: (pending) => this.handlePendingPermissions(session.root_id, pending),
        onPermissionReply: (requestID) => this.approvals.markExpired(requestID),
        onWaitingForApproval: (waiting) => {
          rt.waitingApproval = waiting;
          rt.waitingSince = waiting ? Date.now() : null;
        },
        signal: abort.signal,
      });
    } catch (e) {
      rt.abort = null;
      rt.queue = [];
      this.deps.store.markDirectSessionStatus(session.root_id, "idle");
      this.deps.logger.error("direct turn spawn failed", {
        root_id: session.root_id,
        error: toTaskingError(e).message,
      });
      await this.finalizeTurnCard(session.root_id, "failed", stats, 0);
      await this.replySafe(
        session.root_id,
        `⚠️ 本轮未能启动（${toTaskingError(e).message}）。请重发消息重试。`,
      );
      return;
    } finally {
      rt.abort = null;
      this.stopHeartbeat(rt);
    }

    const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const fresh = this.deps.store.getDirectSession(session.root_id);
    if (!fresh || fresh.status === "done" || fresh.status === "expired") return;
    rt.postureOpen = result.postureOpened;

    const usage = result.usage;
    if (usage) {
      stats.inputTokens = usage.input_tokens;
      stats.outputTokens = usage.output_tokens;
      stats.totalTokens = usage.total_tokens;
      this.aggregate.inputTokens += usage.input_tokens;
      this.aggregate.outputTokens += usage.output_tokens;
      this.aggregate.totalTokens += usage.total_tokens;
      this.deps.store.addDirectSessionUsage(session.root_id, usage, 0);
    }
    if (result.sessionId) {
      this.deps.store.updateDirectSession(session.root_id, { session_id: result.sessionId });
    }
    this.approvals.cancelAll(result.sessionId);

    if (result.status === "interrupted" || rt.stopRequested) {
      this.deps.store.markDirectSessionStatus(session.root_id, "idle");
      await this.finalizeTurnCard(session.root_id, "interrupted", stats, durationSec);
      return;
    }
    if (result.status === "timed_out") {
      const reason = result.error?.includes("inactivity_timeout")
        ? translate("无输出超时")
        : translate("整体超时");
      this.deps.store.markDirectSessionStatus(session.root_id, "idle");
      await this.finalizeTurnCard(session.root_id, "failed", stats, durationSec);
      await this.replySafe(
        session.root_id,
        `⚠️ 本轮${reason}被中止（${durationSec}s）。可用更小的任务描述重试。`,
      );
      return;
    }
    if (result.status === "failed" || result.status === "error") {
      this.deps.store.markDirectSessionStatus(session.root_id, "idle");
      await this.finalizeTurnCard(session.root_id, "failed", stats, durationSec, true);
      await this.replySafe(
        session.root_id,
        `⚠️ 本轮未完成（${result.error ?? result.status}，${durationSec}s）。${stats.lastText ? `\n\n${truncate(stats.lastText)}` : ""}`.trim(),
      );
      return;
    }

    this.deps.store.markDirectSessionStatus(session.root_id, "idle");
    await this.finalizeTurnCard(session.root_id, "completed", stats, durationSec, true);
    const verbosity = config.feishu.direct.verbosity;
    const statsLine =
      verbosity === "quiet"
        ? ""
        : `\n\n⏱ ${durationSec}s · 🔧 ${stats.toolCalls} · ≈${formatTokens(stats.totalTokens)} tokens`;
    const rejectionNote =
      stats.permissionRejections > 0
        ? translate(
            `\n⚠️ ${stats.permissionRejections} 个操作被权限拒绝（可在项目 .opencode 配置放行，或对该项目开 auto_approve）`,
          )
        : "";
    const answer = stats.lastText ? stats.lastText : translate("（本轮无文本回复）");
    const body = stats.lastText
      ? `${truncate(stats.lastText)}${statsLine}${rejectionNote}`
      : `（本轮无文本回复）${statsLine}${rejectionNote}`;
    await this.sendCompletion(session, {
      answer,
      body,
      statsLine: statsLine.trim(),
      note: rejectionNote.trim(),
    });
  }

  private dirSlotFor(dir: string): { busy: boolean; waiters: Array<() => void> } {
    let s = this.dirSlots.get(dir);
    if (!s) {
      s = { busy: false, waiters: [] };
      this.dirSlots.set(dir, s);
    }
    return s;
  }

  private async acquireDir(dir: string): Promise<void> {
    const s = this.dirSlotFor(dir);
    if (!s.busy) {
      s.busy = true;
      return;
    }
    await new Promise<void>((resolve) => s.waiters.push(resolve));
  }

  private releaseDir(dir: string): void {
    const s = this.dirSlotFor(dir);
    const next = s.waiters.shift();
    if (next) {
      next();
      return;
    }
    s.busy = false;
  }

  private async composePromptWithAttachments(
    session: DirectSession,
    m: FeishuPolledMessage,
    text: string,
  ): Promise<string | null> {
    const attachments = m.attachments ?? [];
    if (attachments.length === 0) return text;
    const download = this.deps.feishu.downloadMessageResource;
    const lines: string[] = [];
    for (const [index, attachment] of attachments.entries()) {
      if (!download) {
        lines.push(`[附件不可用] ${attachment.name}（当前未接下载能力）`);
        continue;
      }
      try {
        const resource = await download.call(
          this.deps.feishu,
          m.message_id,
          attachment.key,
          attachment.kind,
        );
        if (resource.data.byteLength > MAX_ATTACHMENT_BYTES) {
          await this.replySafe(
            session.root_id,
            `⚠️ 附件 ${attachment.name} 超过 20MB，已跳过；可放到工作目录后把路径发给我。`,
          );
          continue;
        }
        lines.push(
          `[附件] ${this.writeInboxFile(session.root_id, m.message_id, index, attachment, resource.data, resource.contentType)}`,
        );
      } catch (e) {
        await this.replySafe(
          session.root_id,
          `⚠️ 附件 ${attachment.name} 下载失败：${toTaskingError(e).message}`,
        );
      }
    }
    if (lines.length === 0) return text === "" ? null : text;
    const head = text === "" ? "（用户发来附件，请读取下列文件后回答）" : text;
    return `${head}\n${lines.join("\n")}`;
  }

  private writeInboxFile(
    rootId: string,
    messageId: string,
    index: number,
    attachment: FeishuAttachment,
    data: Uint8Array,
    contentType: string | null,
  ): string {
    const dir = join(this.deps.config().workspace.root, "direct-inbox", rootId);
    mkdirSync(dir, { recursive: true });
    const named = extname(attachment.name) !== "" ? attachment.name : "";
    const ext = named === "" ? extensionFor(contentType, attachment.kind) : extname(named);
    const safe = named === "" ? "" : `-${basename(named).replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const file = join(dir, `${messageId}-${index}${safe === "" ? ext : safe}`);
    writeFileSync(file, Buffer.from(data));
    return file;
  }

  private async executeCollect(session: DirectSession): Promise<void> {
    const rt = this.runtimeFor(session.root_id);
    if (rt.collect === null) {
      rt.collect = [];
      this.armCollectTimer(session.root_id);
    }
    await this.replyInfoCard(
      session,
      this.collectCard(rt, session.root_id),
      "📥 已进入多消息收集模式：接下来的消息（含图片/文件）都会先收集，不立即执行。发完用 /send 合并提交为一轮；/cancel 丢弃；10 分钟无新消息会自动提交。",
    );
  }

  private async executeSend(session: DirectSession): Promise<void> {
    const rt = this.runtimeFor(session.root_id);
    const buffered = rt.collect;
    if (buffered === null) {
      await this.replyInfoCard(
        session,
        this.collectCard(rt, session.root_id),
        "当前不在收集模式。用 /collect 开始收集多条消息。",
      );
      return;
    }
    this.clearCollect(session.root_id);
    if (buffered.length === 0) {
      await this.replySafe(session.root_id, "收集模式已关闭：没有待提交内容。");
      return;
    }
    await this.replySafe(session.root_id, `🚀 已提交 ${buffered.length} 条，合并为一轮执行。`);
    this.enqueueTurn(session.root_id, buffered.join("\n---\n"));
  }

  private async executeCancel(session: DirectSession): Promise<void> {
    const rt = this.runtimeFor(session.root_id);
    const dropped = rt.collect;
    if (dropped === null) {
      await this.replyInfoCard(
        session,
        this.collectCard(rt, session.root_id),
        "当前不在收集模式。",
      );
      return;
    }
    this.clearCollect(session.root_id);
    await this.replySafe(
      session.root_id,
      dropped.length === 0
        ? "已退出收集模式。"
        : `🗑 已退出收集模式，丢弃 ${dropped.length} 条未提交消息。`,
    );
  }

  private armCollectTimer(rootId: string): void {
    const rt = this.runtimeFor(rootId);
    if (rt.collectTimer) clearTimeout(rt.collectTimer);
    rt.collectTimer = setTimeout(() => {
      rt.collectTimer = null;
      void this.flushCollectOnTimeout(rootId);
    }, COLLECT_IDLE_TIMEOUT_MS);
    rt.collectTimer.unref?.();
  }

  private clearCollect(rootId: string): void {
    const rt = this.runtimeFor(rootId);
    rt.collect = null;
    if (rt.collectTimer) {
      clearTimeout(rt.collectTimer);
      rt.collectTimer = null;
    }
  }

  private async flushCollectOnTimeout(rootId: string): Promise<void> {
    const rt = this.runtimeFor(rootId);
    if (rt.collect === null) return;
    const buffered = rt.collect;
    this.clearCollect(rootId);
    if (buffered.length === 0) return;
    await this.replySafe(rootId, `⏰ 收集超时，已自动提交 ${buffered.length} 条为一轮。`);
    this.enqueueTurn(rootId, buffered.join("\n---\n"));
  }

  private async executeName(session: DirectSession, text: string): Promise<void> {
    const name = text.slice("/name".length).trim().replace(/\s+/g, " ");
    if (name === "") {
      await this.replySafe(
        session.root_id,
        `当前会话名：${session.name ?? translate("（未设置）")}\n用法：/name <文本>（同时用于卡片头部与 TUI 区块）`,
      );
      return;
    }
    const trimmed = name.slice(0, 80);
    this.deps.store.updateDirectSession(session.root_id, { name: trimmed });
    await this.replySafe(session.root_id, `已将会话名改为「${trimmed}」。`);
  }

  private async executeNew(session: DirectSession): Promise<void> {
    this.deps.store.updateDirectSession(session.root_id, { session_id: null, last_prompt: null });
    await this.cleanupSession(session);
    await this.replySafe(
      session.root_id,
      "🆕 已开启新会话：上下文已清空（话题、目录与名称不变），旧 opencode 会话已删除。",
    );
  }

  private async executeAuto(session: DirectSession, text: string): Promise<void> {
    const rt = this.runtimeFor(session.root_id);
    const arg = text.slice("/auto".length).trim().toLowerCase();
    if (arg === "") {
      await this.replyInfoCard(
        session,
        this.autoCard(session, rt),
        this.renderAutoStatus(session, rt),
      );
      return;
    }
    const result = this.applyAutoArg(session, rt, arg);
    await this.replySafe(session.root_id, result.text);
  }

  private renderAutoStatus(session: DirectSession, rt: SessionRuntime): string {
    const postureNow = this.autoPostureOf(session, rt);
    const current =
      postureNow === "on"
        ? "🔓 本会话放开"
        : postureNow === "once"
          ? "⚡ 仅下一轮放开"
          : "🔒 默认（不传 --auto）";
    return [
      `当前权限姿态：${current}`,
      this.autoSourceLabel(session),
      "用法：/auto on｜/auto once｜/auto off｜/auto reset",
    ].join("\n");
  }

  private autoSourceLabel(session: DirectSession): string {
    const direct = this.deps.config().feishu.direct;
    const entry = session.project === null ? null : direct.projects[session.project];
    const projectValue = entry?.auto_approve ?? null;
    const source =
      projectValue !== null ? translate(`项目条目「${session.project}」`) : translate("全局配置");
    const effective = this.resolveAutoApprove(session.project ?? "", false, direct);
    return `（会话未覆盖时按${source}：${effective ? translate("放开") : translate("默认")}）`;
  }

  private async executeAgent(session: DirectSession, text: string): Promise<void> {
    const config = this.deps.config();
    const arg = text.slice("/agent".length).trim();
    if (arg === "") {
      const catalog = config.opencode.agents ?? [];
      const lines = [
        `当前 agent：${session.agent_override ?? config.opencode.agent}${
          session.agent_override === null ? translate("（配置默认）") : translate("（会话覆盖）")
        }`,
      ];
      if (catalog.length > 0) lines.push(`可用：${catalog.join(", ")}`);
      lines.push("用法：/agent <name>｜/agent reset");
      await this.replyInfoCard(
        session,
        buildInfoCard({ title: "🧠 Agent", lines }),
        lines.join("\n"),
      );
      return;
    }
    if (arg === "reset") {
      this.deps.store.updateDirectSession(session.root_id, { agent_override: null });
      await this.replySafe(
        session.root_id,
        `已恢复配置默认 agent：${config.opencode.agent}（下一轮生效）。`,
      );
      return;
    }
    const name = arg.split(/\s+/)[0] ?? "";
    const catalog = config.opencode.agents ?? [];
    if (catalog.length > 0 && !catalog.includes(name)) {
      await this.replySafe(session.root_id, `⚠️ 未知 agent "${name}"。可用：${catalog.join(", ")}`);
      return;
    }
    this.deps.store.updateDirectSession(session.root_id, { agent_override: name });
    await this.replySafe(
      session.root_id,
      `已切换 agent 为 ${name}（下一轮生效）。/agent reset 恢复默认。`,
    );
  }

  private async executeModel(session: DirectSession, text: string): Promise<void> {
    const config = this.deps.config();
    const arg = text.slice("/model".length).trim();
    if (arg === "") {
      const lines = [
        `当前 model：${session.model_override ?? config.opencode.model ?? translate("（未设置）")}${
          session.model_override === null ? translate("（配置默认）") : translate("（会话覆盖）")
        }`,
        "用法：/model <name>｜/model reset",
      ];
      await this.replyInfoCard(
        session,
        buildInfoCard({ title: "🤖 Model", lines }),
        lines.join("\n"),
      );
      return;
    }
    if (arg === "reset") {
      this.deps.store.updateDirectSession(session.root_id, { model_override: null });
      await this.replySafe(
        session.root_id,
        `已恢复配置默认 model：${config.opencode.model ?? translate("（未设置）")}（下一轮生效）。`,
      );
      return;
    }
    this.deps.store.updateDirectSession(session.root_id, { model_override: arg });
    await this.replySafe(
      session.root_id,
      `已切换 model 为 ${arg}（下一轮生效）。/model reset 恢复默认。`,
    );
  }

  private async replyStatus(session: DirectSession): Promise<void> {
    const config = this.deps.config();
    const rt = this.runtimeFor(session.root_id);
    const postureNow = this.autoPostureOf(session, rt);
    const posture =
      postureNow === "on"
        ? translate("🔓 本会话放开")
        : postureNow === "once"
          ? translate("⚡ 仅下一轮放开")
          : translate("🔒 默认");
    const idleSec = Math.max(0, Math.round((Date.now() - session.updated_at) / 1000));
    const answer = [
      "**会话状态**",
      `- 目录：\`${session.path}\``,
      `- session：${session.session_id ?? translate("（未开始）")}`,
      `- agent：${session.agent_override ?? config.opencode.agent}${
        session.agent_override === null ? "" : translate("（会话覆盖）")
      }`,
      `- model：${session.model_override ?? config.opencode.model ?? translate("（未设置）")}${
        session.agent_override === null ? "" : translate("（会话覆盖）")
      }`,
      `- 权限姿态：${posture}`,
      `- turns：${session.turns} · tokens：≈${formatTokens(session.total_tokens)}`,
      `- 排队：${rt.queue.length}${rt.turnInFlight ? translate(" · 运行中") : ""} · 距上次活动：${idleSec}s`,
      ...(rt.collect === null ? [] : [`- 收集模式：📥 ${rt.collect.length} 条待提交`]),
    ].join("\n");
    const replyCard = this.deps.feishu.replyCardInThread;
    if (replyCard) {
      try {
        await replyCard.call(
          this.deps.feishu,
          session.root_id,
          buildCompletionCard({ answer, statsLine: "", note: "" }),
        );
        return;
      } catch (e) {
        this.deps.logger.warn("direct status card failed; falling back to text", {
          root_id: session.root_id,
          error: toTaskingError(e).message,
        });
      }
    }
    await this.replySafe(session.root_id, answer);
  }

  private async executeDone(session: DirectSession, operator?: string): Promise<void> {
    const rt = this.runtimeFor(session.root_id);
    const queued = rt.queue.length;
    rt.queue = [];
    if (rt.abort) {
      rt.stopRequested = true;
      rt.abort.abort();
    }
    this.deps.store.markDirectSessionStatus(session.root_id, "done");
    await this.sealCurrentCard(session.root_id);
    const statsLine =
      session.turns > 0
        ? translate(
            `（本次运行统计：${session.turns} turn${session.turns === 1 ? "" : "s"} · ≈${formatTokens(session.total_tokens)} tokens）`,
          )
        : "";
    const who = operator ? translate(`（操作人：${operator}）`) : "";
    const discardNote = queued > 0 ? translate(`（已丢弃 ${queued} 条排队消息）`) : "";
    await this.replySafe(
      session.root_id,
      `✅ 会话已结束。${statsLine}${who}${discardNote}重新发起请 /chat <项目|路径> <消息>`,
    );
    await this.cleanupSession(session);
  }

  private async executeStop(session: DirectSession, operator?: string): Promise<void> {
    const rt = this.runtimeFor(session.root_id);
    const queued = rt.queue.length;
    rt.queue = [];
    if (rt.turnInFlight && rt.abort) {
      this.beginInterrupt(session, rt);
      await this.finalizeCardPhase(session.root_id, "interrupted");
      await this.announceInterrupt(session.root_id, queued, operator);
      return;
    }
    if (queued > 0) {
      this.deps.store.markDirectSessionStatus(session.root_id, "idle");
      await this.replySafe(session.root_id, `🛑 已清空 ${queued} 条排队消息（当前无运行中任务）。`);
      return;
    }
    await this.replySafe(session.root_id, "ℹ️ 当前没有运行中的任务。");
  }

  async sweepThreads(): Promise<void> {
    if (!this.running) return;
    const listFn = this.deps.feishu.listThreadReplies;
    if (!listFn) return;
    const active = this.deps.store.listActiveDirectSessions();
    for (const s of active) {
      if (!this.running) return;
      if (!s.thread_id) continue;
      let messages: FeishuPolledMessage[];
      try {
        messages = await listFn.call(this.deps.feishu, s.thread_id, s.last_msg_id);
      } catch (e) {
        this.deps.logger.debug("direct sweep thread fetch failed", {
          root_id: s.root_id,
          error: toTaskingError(e).message,
        });
        continue;
      }
      for (const m of messages) {
        if (!this.running) return;
        if (m.root_id !== s.root_id) continue;
        if (m.message_id === s.root_id) continue;
        await this.handleThreadMessage(m);
      }
    }
  }

  private async replySafe(rootId: string, text: string): Promise<void> {
    try {
      const r = await this.deps.feishu.replyInThread(rootId, text);
      if (r.thread_id) {
        this.deps.store.updateDirectSession(rootId, { thread_id: r.thread_id });
      }
    } catch (e) {
      this.deps.logger.warn("direct reply failed", {
        root_id: rootId,
        error: toTaskingError(e).message,
      });
    }
  }
}

function isRetryableCardError(e: unknown): boolean {
  if (!(e instanceof TaskingError)) return true;
  if (e.category === "feishu_api_request") return true;
  if (e.category !== "feishu_api_status") return false;
  const status = (e.details as { status?: unknown } | undefined)?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

function toolTextLines(tools: TurnCardToolEvent[]): string {
  return tools
    .map((t) => {
      const summary = toolSummary(t);
      const exit = t.exit !== undefined && t.exit !== 0 ? ` (exit ${t.exit})` : "";
      return `🔧 ${t.tool}${summary === "" ? "" : ` · ${summary}`}${exit}`;
    })
    .join("\n");
}

function sleepUnrefed(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function fullDetailBytes(detail: TurnCardToolEvent): number {
  return (
    Buffer.byteLength(detail.output ?? "", "utf8") +
    Buffer.byteLength(detail.title ?? "", "utf8") +
    Buffer.byteLength(detail.input === undefined ? "" : JSON.stringify(detail.input), "utf8")
  );
}

function fullDetailFileName(turn: number): string {
  return `direct-turn-${turn}.md`;
}

function renderFullDetail(
  session: DirectSession,
  turn: TurnCardState | null,
  details: TurnCardToolEvent[],
  dropped: number,
): string {
  const lines: string[] = [
    `# ${session.name ?? session.path} · Turn ${turn?.turn ?? "?"}`,
    "",
    `- directory: \`${session.path}\``,
    `- tools: ${turn?.toolCalls ?? details.length}`,
  ];
  if (dropped > 0) lines.push(`- ${dropped} 个更早的工具调用明细因体积过大未包含`);
  for (const [index, detail] of details.entries()) {
    const failed = detail.exit !== undefined && detail.exit !== 0;
    const heading = `## ${index + 1}. ${failed ? "✗" : "🔧"} ${detail.tool}${
      detail.title === undefined ? "" : ` · ${detail.title}`
    }`;
    lines.push("", heading);
    const status = detail.status ?? "completed";
    const exit = detail.exit !== undefined ? ` (exit ${detail.exit})` : "";
    const duration = detail.durationMs !== undefined ? ` · ${detail.durationMs}ms` : "";
    lines.push(`Status: ${status}${exit}${duration}`);
    if (typeof detail.input?.command === "string") {
      lines.push("", "```bash", detail.input.command, "```");
    } else if (detail.input !== undefined) {
      lines.push("", "```json", JSON.stringify(detail.input, null, 2), "```");
    }
    if (detail.output !== undefined) {
      lines.push("", "```", detail.output.trim() === "" ? "(no output)" : detail.output, "```");
    }
  }
  return lines.join("\n");
}

function extensionFor(contentType: string | null, kind: "image" | "file"): string {
  const type = (contentType ?? "").split(";")[0]?.trim() ?? "";
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/zip": ".zip",
  };
  return map[type] ?? (kind === "image" ? ".png" : ".bin");
}

function sessionName(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 80);
}

function truncate(text: string, max = MAX_MESSAGE_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断）`;
}

function renderChatHelp(scope: "intake" | "thread"): string {
  if (scope === "intake") {
    return [
      "直连会话用法:",
      "/chat <项目名|绝对路径> <消息>  在指定目录创建 opencode 会话",
      "/chat                             列出可用项目",
      "会话创建后：在本话题内直接回复即续聊；/stop 中断当前任务；/done 结束会话",
    ].join("\n");
  }
  return [
    "直连会话用法:",
    "直接回复本话题 → 继续与 agent 对话（排队串行执行）",
    "直接发图片/文件 → 下载到工作区并把路径交给 agent",
    "/collect → 进入多消息收集模式（发完用 /send 提交为一轮，/cancel 丢弃）",
    "/auto [on|once|off] → 查看/切换本会话权限姿态（下一轮生效）",
    "/name <文本> → 给本会话改名（卡片头部与 TUI 显示）",
    "/agent <name> → 切换本会话 agent（/agent reset 恢复）",
    "/model <name> → 切换本会话 model（/model reset 恢复）",
    "/new → 清空上下文开启新会话",
    "/status → 查看会话状态",
    "/stop → 中断当前任务（含清空排队消息）",
    "/done → 结束会话",
    "新建其他会话 → 在群里 /chat <项目|路径> <消息>",
  ].join("\n");
}

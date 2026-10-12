import type { FeishuCardAction } from "../adapters/feishu/events.js";
import {
  type FeishuPolledMessage,
  type FeishuSource,
  isReadableText,
  toSecondsStr,
} from "../adapters/feishu/source.js";
import type { JiraComment, JiraTracker } from "../adapters/jira/tracker.js";
import { isTerminalState, jiraBrowseUrl, wrapDescription } from "../adapters/jira/tracker.js";
import type { EffectiveConfig } from "../config/config-types.js";
import type { Logger } from "../observability/logger.js";
import { resolveAgent } from "../shared/agent-resolver.js";
import { toTaskingError } from "../shared/errors.js";
import { type CardActionReply, type InfoCardButton, buildInfoCard } from "../shared/info-card.js";
import type { Task } from "../shared/types.js";
import { translate } from "../translate/locale.js";
import type { Binding, BindingStore } from "./binding-store.js";
import {
  type ParsedAgent,
  type ParsedIssue,
  type ParsedState,
  THREAD_ACK_FAIL_TEXT,
  THREAD_ACK_TEXT,
  buildBridgedCommentBody,
  hasSentinel,
  helpLinesFor,
  helpTextFor,
  intakeAckTextFor,
  intakeCommandsFor,
  isCommand,
  isHelp,
  parseAgent,
  parseChat,
  parseIssue,
  parseState,
  renderForwardedComment,
  threadCommandsFor,
  threadHelpLinesFor,
  threadHelpTextFor,
} from "./commands.js";

type HelpContext = "intake" | "thread";

export interface SchedulerPort {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  readonly state: {
    readonly running: Map<string, { task: { identifier: string; title: string } }>;
  };
}

const BRIDGE_CARD_ACTION_DEDUP_MS = 2 * 60 * 1000;
const MEMBER_CACHE_TTL_MS = 60 * 60 * 1000;
const BRIDGE_WRITE_ACTIONS = new Set(["tr_confirm", "full", "state_summon", "agent_set"]);
const BRIDGE_JIRA_CARD_ACTIONS = new Set([
  "agent_set",
  "state_summon",
  "state_refresh",
  "state_open",
  "tr",
  "tr_confirm",
  "tr_cancel",
  "full",
]);
const COMMENT_CARD_BUDGET_BYTES = 24 * 1024;

export function isJiraNotFound(e: unknown): boolean {
  const err = toTaskingError(e);
  if (err.category !== "jira_api_status") return false;
  const status = (err.details as { status?: unknown } | null | undefined)?.status;
  return status === 404;
}

export interface DirectSessionPort {
  handleIntakeMessage(msg: FeishuPolledMessage): Promise<boolean>;
  handleThreadMessage(msg: FeishuPolledMessage): Promise<boolean>;
  sweepThreads?(): Promise<void>;
}

export interface CommentBridgeDeps {
  tracker: JiraTracker | null;
  feishu: FeishuSource;
  bindings: BindingStore;
  config: () => EffectiveConfig;
  logger: Logger;
  requestRefresh?: () => boolean;
  scheduler?: SchedulerPort;
  direct?: DirectSessionPort;
  retryDelaysMs?: number[];
}

interface QueueItem {
  msg: FeishuPolledMessage;
  attempt: number;
  done?: () => void;
}

export class CommentBridge {
  private readonly deps: CommentBridgeDeps;

  private get jiraTracker(): JiraTracker | null {
    return this.deps.tracker;
  }
  private static readonly DEFAULT_RETRY_DELAYS_MS = [30000, 120000, 600000];
  private running = false;
  private stopped = false;
  private readonly processed = new Set<string>();
  private readonly queue: QueueItem[] = [];
  private consuming = false;
  private forwardTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly retryTimers = new Set<NodeJS.Timeout>();
  private readonly terminalHintedRoots = new Set<string>();
  private readonly cardActionSeen = new Map<string, number>();
  private readonly memberCache = new Map<string, { at: number; names: Map<string, string> }>();

  constructor(deps: CommentBridgeDeps) {
    this.deps = deps;
  }

  async handleCardAction(action: FeishuCardAction): Promise<CardActionReply | undefined> {
    const value = (action.value ?? {}) as {
      action?: unknown;
      issue_key?: unknown;
      issue_id?: unknown;
      comment_id?: unknown;
      transition_id?: unknown;
      transition_name?: unknown;
      agent?: unknown;
    };
    const name = typeof value.action === "string" ? value.action : "";
    if (name === "") return undefined;
    if (BRIDGE_JIRA_CARD_ACTIONS.has(name) && this.jiraTracker === null) {
      return { toast: { type: "warning", content: "该操作需要 Jira 任务源" } };
    }
    if (BRIDGE_WRITE_ACTIONS.has(name) && !this.claimCardAction(action)) {
      return { toast: { type: "info", content: "该操作已处理" } };
    }
    this.deps.logger.debug("bridge card action received", {
      action: name,
      operator: action.operatorOpenId ?? null,
      message_id: action.messageId,
    });
    if (name === "agent_set") {
      const b = await this.bindingFromValue(value);
      const agent = typeof value.agent === "string" ? value.agent : "";
      if (b === null) return { toast: { type: "error", content: "任务不存在" } };
      const parsed: ParsedAgent =
        agent === "" ? { kind: "reset", name: null } : { kind: "switch", name: agent };
      this.deferAction(async () => {
        await this.executeAgentSwitch(parsed, b, b.root_id, this.deps.config());
        const config = this.deps.config();
        const lines = await this.renderAgentList(b, config);
        try {
          await this.deps.feishu.updateCard(action.messageId, this.agentListCard(b, config, lines));
        } catch (e) {
          this.deps.logger.debug("agent card refresh failed", {
            issue: b.issue_key,
            error: toTaskingError(e).message,
          });
        }
      });
      return {
        toast: {
          type: "info",
          content: agent === "" ? "正在恢复默认 agent…" : `正在切换 ${agent}…`,
        },
      };
    }
    if (name === "state_summon") {
      const b = await this.bindingFromValue(value);
      if (b === null) return { toast: { type: "error", content: "任务不存在" } };
      this.deferAction(async () => {
        const info = await this.fetchState(b.issue_id);
        await this.publishStateCard(b, info.state, info.assignee);
      });
      return { toast: { type: "info", content: "已发送状态卡" } };
    }
    if (name === "state_refresh") {
      const b = await this.bindingFromValue(value);
      if (b === null) return { toast: { type: "error", content: "任务不存在" } };
      const info = await this.fetchState(b.issue_id);
      return {
        toast: { type: "success", content: "已刷新" },
        card: this.stateCard(b, info.state, info.assignee),
      };
    }
    if (name === "state_open") {
      const tracker = this.jiraTracker;
      if (tracker === null) return undefined;
      const b = await this.bindingFromValue(value);
      if (b === null) return { toast: { type: "error", content: "任务不存在" } };
      const info = await this.fetchState(b.issue_id);
      try {
        const transitions = await tracker.fetchTransitions(b.issue_key);
        if (transitions.length === 0) {
          return {
            toast: { type: "info", content: "当前没有可用转换" },
            card: this.stateCard(b, info.state, info.assignee),
          };
        }
        return {
          toast: { type: "info", content: "请选择目标状态" },
          card: this.transitionPickCard(b, info, transitions),
        };
      } catch (e) {
        return { toast: { type: "error", content: `查询失败：${toTaskingError(e).message}` } };
      }
    }
    if (name === "tr_cancel") {
      const b = await this.bindingFromValue(value);
      if (b === null) return { toast: { type: "error", content: "任务不存在" } };
      const info = await this.fetchState(b.issue_id);
      return {
        toast: { type: "info", content: "已取消" },
        card: this.stateCard(b, info.state, info.assignee),
      };
    }
    if (name === "tr") {
      const b = await this.bindingFromValue(value);
      const transitionId = typeof value.transition_id === "string" ? value.transition_id : "";
      const transitionName = typeof value.transition_name === "string" ? value.transition_name : "";
      if (b === null || transitionId === "") return undefined;
      const info = await this.fetchState(b.issue_id);
      return {
        toast: { type: "warning", content: "请确认" },
        card: this.transitionConfirmCard(b, info, { id: transitionId, toName: transitionName }),
      };
    }
    if (name === "tr_confirm") {
      const issueId = typeof value.issue_id === "string" ? value.issue_id : "";
      const transitionId = typeof value.transition_id === "string" ? value.transition_id : "";
      const transitionName = typeof value.transition_name === "string" ? value.transition_name : "";
      if (issueId === "" || transitionId === "") return undefined;
      this.deferAction(() => this.applyTransition(issueId, transitionId, transitionName, action));
      return { toast: { type: "info", content: "正在转换…" } };
    }
    if (name === "full") {
      const issueId = typeof value.issue_id === "string" ? value.issue_id : "";
      const commentId = typeof value.comment_id === "string" ? value.comment_id : "";
      if (issueId === "" || commentId === "") return undefined;
      this.deferAction(() => this.deliverFullComment(issueId, commentId));
      return { toast: { type: "info", content: "正在整理完整内容…" } };
    }
    return { toast: { type: "warning", content: "未知操作" } };
  }

  private async bindingFromValue(value: {
    issue_id?: unknown;
  }): Promise<Binding | null> {
    const issueId = typeof value.issue_id === "string" ? value.issue_id : "";
    if (issueId === "") return null;
    return this.deps.bindings.getBinding(issueId);
  }

  private async fetchState(issueId: string): Promise<{ state: string; assignee: string | null }> {
    const tracker = this.jiraTracker;
    if (tracker === null) return { state: "", assignee: null };
    try {
      const tasks = await tracker.fetchIssueStatesByIds([issueId]);
      const task = tasks[0];
      return { state: task?.state ?? "", assignee: task?.assignee ?? null };
    } catch (e) {
      this.deps.logger.debug("state card state fetch failed", {
        issue_id: issueId,
        error: toTaskingError(e).message,
      });
      return { state: "", assignee: null };
    }
  }

  private stateCardLines(state: string, assignee: string | null): string[] {
    return [
      `状态：${state === "" ? translate("（未知）") : state}`,
      `负责人：${assignee === null || assignee === "" ? translate("（未分配）") : assignee}`,
    ];
  }

  private stateButtons(b: Binding): InfoCardButton[] {
    const buttons: InfoCardButton[] = [
      { label: "🔀 转状态", action: "state_open", value: { issue_id: b.issue_id } },
      { label: "🔄 刷新", action: "state_refresh", value: { issue_id: b.issue_id } },
    ];
    const url = jiraBrowseUrl(this.deps.config().tracker.endpoint, b.issue_key);
    if (url !== null) buttons.push({ label: "打开 Jira", url });
    return buttons;
  }

  private stateCard(b: Binding, state: string, assignee: string | null): unknown {
    return buildInfoCard({
      title: `📋 ${b.issue_key}`,
      lines: this.stateCardLines(state, assignee),
      buttons: this.stateButtons(b),
      rootId: b.root_id,
      kind: "bridge",
    });
  }

  private transitionPickCard(
    b: Binding,
    info: { state: string; assignee: string | null },
    transitions: Array<{ id: string; toName: string }>,
  ): unknown {
    const buttons: InfoCardButton[] = transitions.map((t) => ({
      label: t.toName,
      action: "tr",
      value: { issue_id: b.issue_id, transition_id: t.id, transition_name: t.toName },
    }));
    buttons.push({ label: "✖ 取消", action: "tr_cancel", value: { issue_id: b.issue_id } });
    return buildInfoCard({
      title: `📋 ${b.issue_key}`,
      lines: [...this.stateCardLines(info.state, info.assignee), "", "选择目标状态："],
      buttons,
      rootId: b.root_id,
      kind: "bridge",
    });
  }

  private transitionConfirmCard(
    b: Binding,
    info: { state: string; assignee: string | null },
    choice: { id: string; toName: string },
  ): unknown {
    return buildInfoCard({
      title: `📋 ${b.issue_key}`,
      lines: [
        ...this.stateCardLines(info.state, info.assignee),
        "",
        `确认转为「${choice.toName}」？`,
      ],
      buttons: [
        {
          label: "✅ 确认",
          action: "tr_confirm",
          type: "primary",
          value: {
            issue_id: b.issue_id,
            transition_id: choice.id,
            transition_name: choice.toName,
          },
        },
        { label: "✖ 取消", action: "tr_cancel", value: { issue_id: b.issue_id } },
      ],
      rootId: b.root_id,
      kind: "bridge",
    });
  }

  private async applyTransition(
    issueId: string,
    transitionId: string,
    transitionName: string,
    action: FeishuCardAction,
  ): Promise<void> {
    const tracker = this.jiraTracker;
    if (tracker === null) return;
    const b = this.deps.bindings.getBinding(issueId);
    if (b === null) return;
    const config = this.deps.config();
    try {
      await tracker.transitionIssue(b.issue_key, transitionId);
    } catch (e) {
      const info = await this.fetchState(b.issue_id);
      await this.patchStateCard(b, info.state, info.assignee);
      await this.deps.feishu.replyInThread(b.root_id, `⚠️ 转状态失败：${toTaskingError(e).message}`);
      return;
    }
    this.deps.requestRefresh?.();
    const isTerminal = isTerminalState(transitionName, config.tracker.terminal_states);
    if (isTerminal) this.deps.bindings.markTerminal(b.issue_id);
    const info = await this.fetchState(b.issue_id);
    const state = info.state === "" ? transitionName : info.state;
    const fresh = this.deps.bindings.getBinding(issueId) ?? b;
    const card = this.stateCard(fresh, state, info.assignee);
    try {
      await this.deps.feishu.updateCard(action.messageId, card);
    } catch (e) {
      this.deps.logger.debug("clicked state card refresh failed", {
        issue: b.issue_key,
        error: toTaskingError(e).message,
      });
    }
    if (fresh.card_message_id !== action.messageId) {
      await this.patchStateCard(fresh, state, info.assignee);
    }
    const who = await this.operatorLabel(action);
    await this.deps.feishu.replyInThread(
      b.root_id,
      `✅ 已转 ${transitionName}${isTerminal ? translate("（完结）") : ""}（操作人：${who}）`,
    );
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
    if (chatId === "") return null;
    try {
      const members = await this.deps.feishu.listChatMembers(chatId);
      const names = new Map(members.map((m) => [m.open_id, m.name]));
      this.memberCache.set(chatId, { at: Date.now(), names });
      return names;
    } catch (e) {
      this.deps.logger.debug("bridge member lookup failed", {
        chat_id: chatId,
        error: toTaskingError(e).message,
      });
      return this.memberCache.get(chatId)?.names ?? null;
    }
  }

  private async patchStateCard(b: Binding, state: string, assignee: string | null): Promise<void> {
    const tracked = this.deps.bindings.getBinding(b.issue_id) ?? b;
    if (tracked.card_message_id === null) {
      await this.publishStateCard(b, state, assignee);
      return;
    }
    try {
      await this.deps.feishu.updateCard(
        tracked.card_message_id,
        this.stateCard(tracked, state, assignee),
      );
    } catch (e) {
      this.deps.logger.warn("state card patch failed; republishing", {
        issue: b.issue_key,
        error: toTaskingError(e).message,
      });
      await this.publishStateCard(b, state, assignee);
    }
  }

  private async publishStateCard(
    b: Binding,
    state: string,
    assignee: string | null,
  ): Promise<void> {
    const tracked = this.deps.bindings.getBinding(b.issue_id) ?? b;
    if (tracked.card_message_id !== null) {
      try {
        await this.deps.feishu.deleteMessage(tracked.card_message_id);
      } catch (e) {
        this.deps.logger.debug("old state card delete failed", {
          issue: b.issue_key,
          error: toTaskingError(e).message,
        });
      }
    }
    try {
      const r = await this.deps.feishu.replyCardInThread(
        b.root_id,
        this.stateCard(b, state, assignee),
      );
      this.deps.bindings.setBindingCardId(b.issue_id, r.message_id);
    } catch (e) {
      this.deps.logger.warn("state card publish failed", {
        issue: b.issue_key,
        error: toTaskingError(e).message,
      });
    }
  }

  private deferAction(work: () => Promise<void>): void {
    setImmediate(() => {
      void work().catch((e) =>
        this.deps.logger.warn("bridge card action failed", {
          error: toTaskingError(e).message,
        }),
      );
    });
  }

  private truncateCommentForCard(text: string): { text: string; truncated: boolean } {
    const budget = COMMENT_CARD_BUDGET_BYTES - 1024;
    if (Buffer.byteLength(text, "utf8") <= budget) return { text, truncated: false };
    let end = text.length;
    while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > budget) {
      end = Math.floor(end * 0.9);
    }
    return { text: text.slice(0, end), truncated: true };
  }

  private buildCommentCard(
    b: Binding,
    comment: JiraComment,
    isAgent: boolean,
    config: EffectiveConfig,
    text: string,
    truncated: boolean,
  ): unknown {
    const prefix = isAgent ? "🤖 agent" : `💬 ${comment.authorName ?? "someone"} (Jira)`;
    const body = truncated ? `${text}\n\n…（已截断，点「📄 完整输出」收全文文件）` : text;
    const buttons: InfoCardButton[] = [];
    if (truncated) {
      buttons.push({
        label: "📄 完整输出",
        action: "full",
        value: { issue_id: b.issue_id, comment_id: comment.id },
      });
    }
    buttons.push({
      label: "📋 状态",
      action: "state_summon",
      value: { issue_id: b.issue_id },
    });
    const url = jiraBrowseUrl(config.tracker.endpoint, b.issue_key);
    if (url !== null) buttons.push({ label: "打开 Jira", url });
    return buildInfoCard({
      title: `${b.issue_key} · ${prefix}`,
      lines: [body],
      buttons,
      rootId: b.root_id,
      kind: "bridge",
    });
  }

  private async deliverFullComment(issueId: string, commentId: string): Promise<void> {
    const tracker = this.jiraTracker;
    if (tracker === null) return;
    const b = this.deps.bindings.getBinding(issueId);
    if (b === null) return;
    try {
      const comments = await tracker.fetchComments(b.issue_key, null);
      const comment = comments.find((c) => c.id === commentId);
      if (comment === undefined) {
        throw new Error(`comment ${commentId} not found on ${b.issue_key}`);
      }
      const fileName = `jira-${b.issue_key}-comment-${commentId}.md`;
      const key = await this.deps.feishu.uploadFile(Buffer.from(comment.text, "utf8"), fileName);
      await this.deps.feishu.sendFileMessage(b.root_id, key);
    } catch (e) {
      this.deps.logger.warn("full comment delivery failed", {
        issue: b.issue_key,
        comment: commentId,
        error: toTaskingError(e).message,
      });
      await this.deps.feishu
        .replyInThread(b.root_id, `⚠️ 完整输出失败：${toTaskingError(e).message}`)
        .catch(() => {});
    }
  }

  private claimCardAction(action: FeishuCardAction): boolean {
    const key = `${action.messageId}:${action.operatorOpenId ?? ""}:${JSON.stringify(action.value ?? null)}`;
    const now = Date.now();
    for (const [seen, ts] of this.cardActionSeen) {
      if (now - ts > BRIDGE_CARD_ACTION_DEDUP_MS) this.cardActionSeen.delete(seen);
    }
    if (this.cardActionSeen.has(key)) return false;
    this.cardActionSeen.set(key, now);
    return true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    if (this.deps.scheduler) {
      this.deps.scheduler.on("dispatch", (...args: unknown[]) => {
        const taskId = String(args[0] ?? "");
        void this.onDispatch(taskId).catch((e) =>
          this.deps.logger.error("bridge onDispatch failed", {
            error: toTaskingError(e).message,
          }),
        );
      });
      this.deps.scheduler.on("terminate", (...args: unknown[]) => {
        const taskId = String(args[0] ?? "");
        const reason = String(args[1] ?? "");
        void this.onTerminate(taskId, reason).catch((e) =>
          this.deps.logger.error("bridge onTerminate failed", {
            error: toTaskingError(e).message,
          }),
        );
      });
    }
    this.deps.logger.info("comment bridge started");
    this.scheduleForward(0);
    this.scheduleSweep(0);
  }

  stop(): void {
    this.running = false;
    this.stopped = true;
    if (this.forwardTimer) {
      clearTimeout(this.forwardTimer);
      this.forwardTimer = null;
    }
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const t of this.retryTimers) clearTimeout(t);
    this.retryTimers.clear();
    this.deps.logger.info("comment bridge stopped");
  }

  private scheduleForward(delayMs: number): void {
    if (!this.running) return;
    this.forwardTimer = setTimeout(() => {
      this.forwardTick()
        .catch((e) =>
          this.deps.logger.error("comment bridge forward tick failed", {
            error: toTaskingError(e).message,
          }),
        )
        .finally(() => {
          if (this.running) {
            this.scheduleForward(this.deps.config().feishu.forward_interval_ms);
          }
        });
    }, delayMs);
  }

  private async forwardTick(): Promise<void> {
    if (this.jiraTracker === null) return;
    const config = this.deps.config();
    if (!config.feishu.enabled) return;
    for (const b of this.deps.bindings.listActive()) {
      if (!this.running) return;
      await this.forwardComments(b, config);
    }
  }

  /**
   * Sweep (兜底清扫): loss backstop re-pulling bound threads and intake-group
   * messages from the durable cursors. Triggered at start, on event-channel
   * (re)connect, and on the sweep_interval_ms timer — not a processing retry.
   */
  private scheduleSweep(delayMs: number): void {
    if (!this.running) return;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      void this.sweepNow().catch((e) =>
        this.deps.logger.error("comment bridge sweep failed", {
          error: toTaskingError(e).message,
        }),
      );
    }, delayMs);
  }

  async sweepNow(): Promise<void> {
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    const config = this.deps.config();
    if (config.feishu.enabled && this.running) {
      for (const b of this.deps.bindings.listActive()) {
        if (!this.running) return;
        await this.bridgeMessages(b, config);
      }
      if (!this.running) return;
      await this.discoverIntake(config);
      if (!this.running) return;
      await this.deps.direct?.sweepThreads?.();
    }
    if (this.running) {
      this.scheduleSweep(config.feishu.sweep_interval_ms);
    }
  }

  async whenIdle(): Promise<void> {
    while (this.consuming || this.queue.length > 0) {
      await new Promise((r) => setImmediate(r));
    }
  }

  async ingestMessage(msg: FeishuPolledMessage): Promise<void> {
    const config = this.deps.config();
    if (!config.feishu.enabled) return;
    const intakeChat = config.feishu.intake_chat_id ?? "";
    if (msg.chat_id !== "" && intakeChat !== "" && msg.chat_id !== intakeChat) {
      this.deps.logger.debug("ingest dropped: outside intake chat", {
        msg_id: msg.message_id,
        chat_id: msg.chat_id,
      });
      return;
    }
    const isIntakeRoot = msg.root_id === null;
    if (this.processed.has(msg.message_id)) {
      await this.whenIdle();
      return;
    }
    if (isIntakeRoot && this.deps.bindings.isIntakeSeen(msg.message_id)) {
      this.deps.logger.debug("intake root redelivered; suppressed by durable seen-id", {
        msg_id: msg.message_id,
      });
      await this.whenIdle();
      return;
    }
    this.processed.add(msg.message_id);
    await new Promise<void>((resolve) => {
      this.queue.push({ msg, attempt: 0, done: resolve });
      void this.drainQueue();
    });
    if (isIntakeRoot) this.deps.bindings.markIntakeSeen(msg.message_id);
  }

  private async drainQueue(): Promise<void> {
    if (this.consuming) return;
    this.consuming = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        try {
          await this.processItem(item);
        } catch (e) {
          this.deps.logger.debug("queue item processing failed", {
            error: toTaskingError(e).message,
          });
        } finally {
          item.done?.();
        }
      }
    } finally {
      this.consuming = false;
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    const config = this.deps.config();
    const m = item.msg;
    if (m.root_id === null) {
      await this.processIntakeMessage(m, config);
      return;
    }
    if (this.deps.direct) {
      const handled = await this.deps.direct.handleThreadMessage(m);
      if (handled) return;
    }
    const b = this.deps.bindings.getActiveByRootId(m.root_id);
    if (!b) {
      const terminal = this.deps.bindings.getByRootId(m.root_id);
      if (terminal) {
        this.deps.logger.debug("thread message dropped: binding is terminal", {
          msg_id: m.message_id,
          issue: terminal.issue_key,
        });
        if (!this.terminalHintedRoots.has(m.root_id)) {
          this.terminalHintedRoots.add(m.root_id);
          try {
            await this.deps.feishu.replyInThread(
              m.message_id,
              `ℹ️ 任务 ${terminal.issue_key} 已完结，此话题已停用。如需继续，请在话题里发 /state 恢复到活跃状态，或重新 /issue 创建新任务。`,
            );
          } catch (e) {
            this.deps.logger.debug("terminal hint reply failed", {
              msg_id: m.message_id,
              error: toTaskingError(e).message,
            });
          }
        }
        return;
      }
      this.deps.logger.debug("thread message dropped: no active binding for root", {
        msg_id: m.message_id,
        root_id: m.root_id,
      });
      return;
    }
    try {
      await this.processThreadMessage(m, b, config);
    } catch (e) {
      const err = toTaskingError(e);
      if (isJiraNotFound(err)) {
        this.deps.logger.info("binding cleaned: jira issue not found (404)", {
          issue: b.issue_key,
        });
        this.deps.bindings.markTerminal(b.issue_id);
        return;
      }
      const delays = this.deps.retryDelaysMs ?? CommentBridge.DEFAULT_RETRY_DELAYS_MS;
      if (item.attempt < delays.length) {
        const delay = delays[item.attempt] ?? 0;
        this.deps.logger.warn("thread bridge failed; scheduling retry", {
          issue: b.issue_key,
          msg_id: m.message_id,
          attempt: item.attempt + 1,
          delay_ms: delay,
          error: err.message,
        });
        const t = setTimeout(() => {
          this.retryTimers.delete(t);
          this.queue.push({ msg: m, attempt: item.attempt + 1 });
          void this.drainQueue();
        }, delay);
        this.retryTimers.add(t);
        return;
      }
      this.deps.logger.warn("thread bridge failed permanently", {
        issue: b.issue_key,
        msg_id: m.message_id,
        error: err.message,
      });
      this.advanceCursor(b, m);
      await this.sendThreadAck(m, THREAD_ACK_FAIL_TEXT);
    }
  }

  private async processThreadMessage(
    m: FeishuPolledMessage,
    b: Binding,
    config: EffectiveConfig,
  ): Promise<void> {
    if (m.message_id === b.root_id) return;
    if (!isReadableText(m.msg_type) || m.sender_type === "app" || isCommand(m.text)) {
      if (isCommand(m.text) && m.sender_type !== "app") {
        await this.handleInThreadCommand(m.text, b, config);
      }
      this.advanceCursor(b, m);
      return;
    }
    if (m.text.trim() === "") {
      this.deps.logger.debug("thread message dropped: empty text", { msg_id: m.message_id });
      this.advanceCursor(b, m);
      return;
    }
    const tracker = this.jiraTracker;
    if (tracker === null) return;
    const body = buildBridgedCommentBody(m.sender_name ?? "user", m.text);
    await tracker.postComment(b.issue_key, body);
    this.advanceCursor(b, m);
    await this.sendThreadAck(m, THREAD_ACK_TEXT.replace("{issue_key}", b.issue_key));
  }

  private advanceCursor(b: Binding, m: FeishuPolledMessage): void {
    const cur = this.deps.bindings.getBinding(b.issue_id)?.last_feishu_msg_id;
    const curSec = toSecondsStr(cur ?? "");
    if (curSec !== "" && Number(m.create_time) <= Number(curSec)) return;
    this.deps.bindings.advanceFeishuCursor(b.issue_id, m.create_time);
  }

  private async processIntakeMessage(
    m: FeishuPolledMessage,
    config: EffectiveConfig,
  ): Promise<void> {
    if (m.root_id !== null) return;
    if (!isReadableText(m.msg_type) || m.sender_type === "app") {
      this.deps.logger.debug("intake message dropped: not readable text or app sender", {
        msg_id: m.message_id,
        msg_type: m.msg_type,
        sender_type: m.sender_type,
      });
      return;
    }
    if (m.text.trim() === "") {
      this.deps.logger.debug("intake message dropped: empty text", { msg_id: m.message_id });
      return;
    }
    try {
      if (isHelp(m.text)) {
        await this.replyFlatCard(m.message_id, this.helpCard("intake"), this.helpText("intake"));
        return;
      }
      if (parseState(m.text)) {
        if (this.jiraTracker === null) {
          await this.replyUnknownCommand(m.message_id);
          return;
        }
        await this.deps.feishu.replyFlat(
          m.message_id,
          "/state 是话题命令，请在 issue 话题内发哦～",
        );
        return;
      }
      if (parseChat(m.text)) {
        if (this.deps.direct) {
          const handled = await this.deps.direct.handleIntakeMessage(m);
          if (!handled) {
            await this.replyUnknownCommand(m.message_id);
          }
        } else {
          await this.replyUnknownCommand(m.message_id);
        }
        return;
      }
      const agentCmd = parseAgent(m.text);
      if (agentCmd) {
        await this.executeAgent(agentCmd, null, m.message_id, config);
        return;
      }
      const parsed = parseIssue(m.text);
      if (!parsed) {
        if (isCommand(m.text)) {
          await this.replyUnknownCommand(m.message_id);
        } else {
          await this.deps.feishu.replyFlat(
            m.message_id,
            intakeAckTextFor(this.jiraTracker !== null),
          );
        }
        return;
      }
      if (this.deps.bindings.hasRootId(m.message_id)) return;
      if (this.jiraTracker === null) {
        await this.replyUnknownCommand(m.message_id);
        return;
      }
      await this.executeIssue(parsed, m.message_id, config);
    } catch (e) {
      const err = toTaskingError(e);
      const recalled =
        err.category === "feishu_api_status" &&
        (err.details as { status?: unknown } | null | undefined)?.status === 400;
      if (recalled) {
        this.deps.logger.debug("intake message skipped (likely recalled)", {
          msg_id: m.message_id,
        });
      } else {
        this.deps.logger.warn("intake message skipped", {
          msg_id: m.message_id,
          error: err.message,
        });
      }
    }
  }

  private isAgentAuthor(authorName: string | null, config: EffectiveConfig): boolean {
    if (authorName === null) return false;
    const apiUser = config.tracker.api_user;
    return apiUser !== null && authorName === apiUser;
  }

  async forwardComments(b: Binding, config: EffectiveConfig): Promise<void> {
    const tracker = this.jiraTracker;
    if (tracker === null) return;
    let comments: JiraComment[];
    try {
      comments = await tracker.fetchComments(b.issue_key, b.last_jira_comment_id);
    } catch (e) {
      const err = toTaskingError(e);
      if (isJiraNotFound(err)) {
        this.deps.logger.info("binding cleaned: jira issue not found (404)", {
          issue: b.issue_key,
        });
        this.deps.bindings.markTerminal(b.issue_id);
        await this.patchStateCard(b, "已完结", null);
        return;
      }
      this.deps.logger.debug(`forwardComments fetch failed: ${err.message}`, {
        issue: b.issue_key,
      });
      return;
    }
    const newComments = comments.filter((c) => !hasSentinel(c.text));
    if (newComments.length > 0) {
      this.deps.logger.info(
        `jira → feishu: ${newComments.length} comment(s) from ${b.issue_key}`,
        {},
      );
    }
    for (const c of comments) {
      if (hasSentinel(c.text)) {
        this.deps.bindings.advanceJiraCursor(b.issue_id, c.id);
        continue;
      }
      const isAgent = this.isAgentAuthor(c.authorName, config);
      const rendered = renderForwardedComment(c.authorName, c.text, isAgent);
      const { text: mirrorText, truncated } = this.truncateCommentForCard(c.text);
      const card = this.buildCommentCard(b, c, isAgent, config, mirrorText, truncated);
      try {
        const r = await this.sendCommentCard(b.root_id, card, rendered);
        if (r.thread_id && r.thread_id !== b.thread_id) {
          this.deps.bindings.upsertBinding({
            issue_id: b.issue_id,
            issue_key: b.issue_key,
            chat_id: b.chat_id,
            root_id: b.root_id,
            thread_id: r.thread_id,
          });
          b.thread_id = r.thread_id;
        }
        this.deps.bindings.advanceJiraCursor(b.issue_id, c.id);
      } catch (e) {
        const err = toTaskingError(e);
        if (err.category === "feishu_cooldown") {
          this.deps.logger.debug("forward skipped: feishu cooling down", {
            issue: b.issue_key,
          });
        } else {
          this.deps.logger.warn("forward reply failed; cursor held for retry", {
            issue: b.issue_key,
            error: err.message,
          });
        }
      }
    }
  }

  async bridgeMessages(b: Binding, config: EffectiveConfig): Promise<void> {
    if (!b.thread_id) {
      this.deps.logger.debug("sweep skipped: no thread_id yet", {
        issue: b.issue_key,
      });
      return;
    }
    const since = toSecondsStr(b.last_feishu_msg_id ?? "");
    let messages: FeishuPolledMessage[];
    try {
      messages = await this.deps.feishu.listThreadReplies(b.thread_id, b.last_feishu_msg_id);
    } catch (e) {
      this.deps.logger.debug(`sweep thread fetch failed: ${toTaskingError(e).message}`, {
        issue: b.issue_key,
      });
      return;
    }
    let newCount = 0;
    for (const m of messages) {
      if (since !== "" && Number(m.create_time) <= Number(since)) continue;
      if (m.root_id === null) continue;
      if (m.message_id === b.root_id) continue;
      newCount++;
      await this.ingestMessage(m);
    }
    if (newCount > 0) {
      this.deps.logger.info(`feishu → jira: ${newCount} msg(s) from ${b.issue_key} topic`, {});
    }
  }

  private async sendThreadAck(m: FeishuPolledMessage, text: string): Promise<void> {
    try {
      await this.deps.feishu.replyInThread(m.message_id, text);
    } catch (e) {
      this.deps.logger.warn("thread ack reply failed", {
        msg_id: m.message_id,
        error: toTaskingError(e).message,
      });
    }
  }

  private helpCard(context: HelpContext): unknown {
    return buildInfoCard({ title: "📖 tasking 命令", lines: this.helpLines(context) });
  }

  private helpLines(context: HelpContext): string[] {
    return context === "thread"
      ? threadHelpLinesFor(this.jiraTracker !== null)
      : helpLinesFor(this.jiraTracker !== null);
  }

  private helpText(context: HelpContext): string {
    return context === "thread"
      ? threadHelpTextFor(this.jiraTracker !== null)
      : helpTextFor(this.jiraTracker !== null);
  }

  private unknownCommandText(): string {
    return `未知命令。可用：${intakeCommandsFor(this.jiraTracker !== null).join("、")}`;
  }

  private async replyUnknownCommand(msgId: string): Promise<void> {
    await this.deps.feishu.replyFlat(msgId, this.unknownCommandText());
  }

  private async replyFlatCard(rootId: string, card: unknown, fallbackText: string): Promise<void> {
    try {
      await this.deps.feishu.replyCardFlat(rootId, card);
      return;
    } catch (e) {
      this.deps.logger.warn("bridge flat card failed; falling back to text", {
        root_id: rootId,
        error: toTaskingError(e).message,
      });
    }
    await this.deps.feishu.replyFlat(rootId, fallbackText);
  }

  private async sendCommentCard(
    rootId: string,
    card: unknown,
    fallbackText: string,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }> {
    try {
      return await this.deps.feishu.replyCardInThread(rootId, card);
    } catch (e) {
      this.deps.logger.warn("comment card failed; falling back to text", {
        root_id: rootId,
        error: toTaskingError(e).message,
      });
      return this.deps.feishu.replyInThread(rootId, fallbackText);
    }
  }

  private async replyThreadCard(
    rootId: string,
    card: unknown,
    fallbackText: string,
  ): Promise<void> {
    try {
      await this.deps.feishu.replyCardInThread(rootId, card);
      return;
    } catch (e) {
      this.deps.logger.warn("bridge thread card failed; falling back to text", {
        root_id: rootId,
        error: toTaskingError(e).message,
      });
    }
    await this.deps.feishu.replyFlat(rootId, fallbackText);
  }

  private async handleInThreadCommand(
    text: string,
    b: Binding,
    config: EffectiveConfig,
  ): Promise<void> {
    if (isHelp(text)) {
      await this.replyThreadCard(b.root_id, this.helpCard("thread"), this.helpText("thread"));
      return;
    }
    if (text.trim().startsWith("/issue")) {
      await this.deps.feishu.replyFlat(b.root_id, "/issue 是群聊命令，请在群里发哦～");
      return;
    }
    if (parseChat(text)) {
      await this.deps.feishu.replyFlat(b.root_id, "/chat 是群聊命令，请在群里发哦～");
      return;
    }
    const agent = parseAgent(text);
    if (agent) {
      await this.executeAgent(agent, b, b.root_id, config);
      return;
    }
    const state = parseState(text);
    if (state) {
      await this.executeState(state, b, config);
      return;
    }
    await this.deps.feishu.replyFlat(
      b.root_id,
      `未知命令。话题内可用：${threadCommandsFor(this.jiraTracker !== null).join("、")}`,
    );
  }

  async discoverIntake(config: EffectiveConfig): Promise<void> {
    const intakeChat = config.feishu.intake_chat_id;
    if (!intakeChat) return;
    const since = toSecondsStr(this.deps.bindings.getMeta("intake_cursor") ?? "");
    let messages: FeishuPolledMessage[];
    if (since === "") {
      await this.probeIntakeCursor(intakeChat);
      return;
    }
    try {
      messages = await this.deps.feishu.listMessages(intakeChat, since);
    } catch (e) {
      this.deps.logger.debug(`sweep intake fetch failed: ${toTaskingError(e).message}`);
      return;
    }
    if (this.stopped) return;
    let maxTime = since;
    let newCount = 0;
    for (const m of messages) {
      if (m.root_id !== null) continue;
      if (!isReadableText(m.msg_type) || m.sender_type === "app") continue;
      if (m.text.trim() === "") continue;
      if (since !== "" && Number(m.create_time) <= Number(since)) continue;
      newCount++;
      if (m.create_time > maxTime) maxTime = m.create_time;
      await this.ingestMessage(m);
    }
    if (newCount > 0) {
      this.deps.logger.info(`feishu intake: ${newCount} new message(s) in ${intakeChat}`, {});
    }
    if (maxTime !== since) {
      this.deps.bindings.setMeta("intake_cursor", maxTime);
    }
  }

  private async probeIntakeCursor(intakeChat: string): Promise<void> {
    const nowSec = String(Math.floor(Date.now() / 1000));
    const windowStart = String(Math.max(0, Number(nowSec) - 120));
    let messages: FeishuPolledMessage[];
    try {
      messages = await this.deps.feishu.listMessages(intakeChat, windowStart);
    } catch (e) {
      this.deps.logger.debug(`intake cursor probe failed: ${toTaskingError(e).message}`);
      return;
    }
    let maxTime = windowStart;
    for (const m of messages) {
      if (m.create_time > maxTime) maxTime = m.create_time;
    }
    this.deps.bindings.setMeta("intake_cursor", maxTime);
    this.deps.logger.info("intake cursor initialized via cold-start probe", {
      cursor: maxTime,
    });
  }

  async freshStartReset(): Promise<boolean> {
    const config = this.deps.config();
    this.deps.bindings.deleteMeta("intake_cursor");
    const active = this.deps.bindings.listActive();
    if (active.length === 0) return true;
    const tracker = this.jiraTracker;
    if (tracker === null) return true;
    let refreshed: Task[];
    try {
      refreshed = await tracker.fetchIssueStatesByIds(active.map((b) => b.issue_id));
    } catch (e) {
      this.deps.logger.warn(
        "fresh-start reconcile skipped (tracker unreachable), keeping bindings",
        {
          error: toTaskingError(e).message,
        },
      );
      return false;
    }
    const statesById = new Map(refreshed.map((t) => [t.id, t.state]));
    for (const b of active) {
      const state = statesById.get(b.issue_id);
      if (state === undefined || isTerminalState(state, config.tracker.terminal_states)) {
        this.deps.bindings.markTerminal(b.issue_id);
      }
    }
    return true;
  }

  async executeIssue(parsed: ParsedIssue, msgId: string, config: EffectiveConfig): Promise<void> {
    const tracker = this.jiraTracker;
    if (tracker === null) {
      await this.replyUnknownCommand(msgId);
      return;
    }
    const intakeChat = config.feishu.intake_chat_id;
    if (!intakeChat || !config.feishu.create_issue_type) return;
    if (parsed.kind === "discover") {
      let types: string[] = [];
      try {
        types = await tracker.fetchIssueTypes();
      } catch {
        types = [];
      }
      const list = types.length > 0 ? types.map((t, i) => `${i + 1}) ${t}`).join("、") : "(无)";
      const fallback = `可用 issueType: ${list}\n默认: ${config.feishu.create_issue_type}`;
      await this.replyFlatCard(
        msgId,
        buildInfoCard({
          title: "🗂 Issue Types",
          lines: [`可用：${list}`, `默认：${config.feishu.create_issue_type}`],
        }),
        fallback,
      );
      return;
    }
    let type = parsed.typeOverride ?? config.feishu.create_issue_type;
    if (parsed.typeOverride !== null && /^\d+$/.test(parsed.typeOverride)) {
      try {
        const types = await tracker.fetchIssueTypes();
        const idx = Number(parsed.typeOverride) - 1;
        const picked = types[idx];
        if (picked) {
          type = picked;
        } else {
          await this.deps.feishu.replyFlat(msgId, `无此 issueType 编号: ${parsed.typeOverride}`);
          return;
        }
      } catch {}
    }
    const labels = [...config.tracker.required_labels];
    if (parsed.agentOverride) {
      labels.push(`agent:${parsed.agentOverride.toLowerCase()}`);
    }
    const fields: Record<string, unknown> = {
      project: { key: config.tracker.project_key },
      summary: parsed.title,
      description: wrapDescription(parsed.description, tracker.isApiV3()),
      issuetype: { name: type },
      labels,
    };
    if (config.tracker.assignee) {
      try {
        const isCloud = tracker.isApiV3();
        if (config.tracker.assignee === "me") {
          const me = await tracker.fetchMyself();
          if (isCloud && me.accountId) {
            fields.assignee = { accountId: me.accountId };
          } else if (me.name) {
            fields.assignee = { name: me.name };
          }
        } else if (isCloud) {
          fields.assignee = { accountId: config.tracker.assignee };
        } else {
          fields.assignee = { name: config.tracker.assignee };
        }
      } catch {
        if (config.tracker.assignee !== "me") {
          fields.assignee = tracker.isApiV3()
            ? { accountId: config.tracker.assignee }
            : { name: config.tracker.assignee };
        }
      }
    }
    let created: { key: string; id: string };
    try {
      created = await tracker.createIssue(fields);
    } catch (e) {
      await this.deps.feishu.replyFlat(msgId, `创建失败: ${toTaskingError(e).message}`);
      return;
    }
    let ackText = `✅ 已创建 ${created.key}`;
    if (parsed.agentOverride) {
      const name = parsed.agentOverride;
      const warned =
        config.opencode.agents.length > 0 &&
        !config.opencode.agents.some((a) => a.toLowerCase() === name.toLowerCase());
      if (warned) {
        ackText += `\n⚠️ agent ${name} 不在配置目录 [${config.opencode.agents.join(", ")}] 中，派发时将回退默认`;
      }
    }
    const ack = await this.deps.feishu.replyInThread(msgId, ackText);
    this.deps.bindings.upsertBinding({
      issue_id: created.id,
      issue_key: created.key,
      chat_id: intakeChat,
      root_id: ack.root_id ?? msgId,
      thread_id: ack.thread_id,
    });
    await this.ensureActiveState(created.id, created.key, config);
    const binding = this.deps.bindings.getBinding(created.id);
    if (binding !== null) {
      const info = await this.fetchState(created.id);
      await this.publishStateCard(binding, info.state, info.assignee);
    }
  }

  private async ensureActiveState(
    issueId: string,
    issueKey: string,
    config: EffectiveConfig,
  ): Promise<void> {
    const tracker = this.jiraTracker;
    if (tracker === null) return;
    try {
      const states = await tracker.fetchIssueStatesByIds([issueId]);
      const cur = states[0]?.state ?? "";
      const isActive = config.tracker.active_states.some(
        (s) => s.toLowerCase() === cur.toLowerCase(),
      );
      if (isActive || cur === "") return;
      const transitions = await tracker.fetchTransitions(issueKey);
      const target = transitions.find((t) =>
        config.tracker.active_states.some((s) => s.toLowerCase() === t.toName.toLowerCase()),
      );
      if (target) {
        await tracker.transitionIssue(issueKey, target.id);
      }
    } catch (e) {
      this.deps.logger.debug("ensure active state failed", {
        issue: issueKey,
        error: toTaskingError(e).message,
      });
    }
  }

  async executeState(parsed: ParsedState, b: Binding, config: EffectiveConfig): Promise<void> {
    const tracker = this.jiraTracker;
    if (tracker === null) {
      await this.deps.feishu.replyFlat(b.root_id, "⚠️ /state 需要 Jira 任务源（当前未配置）");
      return;
    }
    let transitions: Array<{ id: string; name: string; toName: string }>;
    try {
      transitions = await tracker.fetchTransitions(b.issue_key);
    } catch (e) {
      await this.deps.feishu.replyFlat(b.root_id, `查询失败: ${toTaskingError(e).message}`);
      return;
    }
    if (parsed.kind === "list" || parsed.target === null) {
      const info = await this.fetchState(b.issue_id);
      await this.publishStateCard(b, info.state, info.assignee);
      return;
    }
    const target = parsed.target;
    let chosen: { id: string; name: string; toName: string } | null = null;
    if (/^\d+$/.test(target)) {
      const idx = Number(target) - 1;
      chosen = transitions[idx] ?? null;
    } else {
      chosen = transitions.find((t) => t.toName.toLowerCase() === target.toLowerCase()) ?? null;
    }
    if (!chosen) {
      const lines = transitions.map((t, i) => `${i + 1}) ${t.toName}`);
      await this.deps.feishu.replyFlat(b.root_id, `未匹配，可用:\n${lines.join("\n")}`);
      return;
    }
    try {
      await tracker.transitionIssue(b.issue_key, chosen.id);
    } catch (e) {
      await this.deps.feishu.replyFlat(b.root_id, `转状态失败: ${toTaskingError(e).message}`);
      return;
    }
    this.deps.requestRefresh?.();
    const after = await this.fetchState(b.issue_id);
    await this.patchStateCard(b, after.state === "" ? chosen.toName : after.state, after.assignee);
    const chosenTransition = chosen;
    const isTerminal = config.tracker.terminal_states.some(
      (s) => s.toLowerCase() === chosenTransition.toName.toLowerCase(),
    );
    if (isTerminal) {
      this.deps.bindings.markTerminal(b.issue_id);
      await this.deps.feishu.replyFlat(b.root_id, `✅ 已转 ${chosenTransition.toName}（完结）`);
    } else {
      await this.deps.feishu.replyFlat(b.root_id, `✅ 已转 ${chosenTransition.toName}`);
    }
  }

  async executeAgent(
    parsed: ParsedAgent,
    b: Binding | null,
    replyTarget: string,
    config: EffectiveConfig,
  ): Promise<void> {
    if (parsed.kind === "list") {
      const lines = await this.renderAgentList(b, config);
      await this.replyFlatCard(replyTarget, this.agentListCard(b, config, lines), lines.join("\n"));
      return;
    }
    if (b === null) {
      await this.deps.feishu.replyFlat(replyTarget, "/agent <name> 需在任务话题内使用哦～");
      return;
    }
    await this.executeAgentSwitch(parsed, b, replyTarget, config);
  }

  private agentListCard(b: Binding | null, config: EffectiveConfig, lines: string[]): unknown {
    const buttons: InfoCardButton[] = [];
    if (b !== null) {
      for (const name of config.opencode.agents.slice(0, 8)) {
        buttons.push({
          label: name,
          action: "agent_set",
          value: { issue_id: b.issue_id, agent: name },
        });
      }
      buttons.push({
        label: "↩️ 默认",
        action: "agent_set",
        value: { issue_id: b.issue_id, agent: "" },
      });
    }
    return buildInfoCard({
      title: "🧠 Agent",
      lines,
      buttons,
      ...(b === null ? {} : { rootId: b.root_id, kind: "bridge" }),
    });
  }

  private async renderAgentList(b: Binding | null, config: EffectiveConfig): Promise<string[]> {
    const lines: string[] = [`默认 agent: ${config.opencode.agent}`];
    if (config.opencode.agents.length > 0) {
      lines.push(`目录: ${config.opencode.agents.join(", ")}`);
    } else {
      lines.push("目录: 未配置（任意 agent:<name> 标签直通）");
    }
    const tracker = this.jiraTracker;
    if (b !== null && tracker !== null) {
      try {
        const refreshed = await tracker.fetchIssueStatesByIds([b.issue_id]);
        const task = refreshed.find((t) => t.id === b.issue_id);
        if (task) {
          const resolved = resolveAgent(task, config);
          lines.push(
            `当前 agent: ${resolved.agent}${resolved.warned ? translate("（未在目录中，已回退默认）") : ""}`,
          );
        }
      } catch (e) {
        this.deps.logger.debug("agent list current fetch failed", {
          issue: b.issue_key,
          error: toTaskingError(e).message,
        });
      }
    }
    return lines;
  }

  private async executeAgentSwitch(
    parsed: ParsedAgent,
    b: Binding,
    replyTarget: string,
    config: EffectiveConfig,
  ): Promise<void> {
    const tracker = this.jiraTracker;
    if (tracker === null) {
      await this.deps.feishu.replyFlat(replyTarget, "⚠️ /agent 切换需要 Jira 任务源（当前未配置）");
      return;
    }
    let labels: string[];
    try {
      const refreshed = await tracker.fetchIssueStatesByIds([b.issue_id]);
      const task = refreshed.find((t) => t.id === b.issue_id);
      labels = task?.labels ?? [];
    } catch (e) {
      await this.deps.feishu.replyFlat(replyTarget, `查询失败: ${toTaskingError(e).message}`);
      return;
    }
    const next = labels.filter((l) => !l.startsWith("agent:"));
    let ack: string;
    if (parsed.kind === "reset") {
      ack = `✅ 已清除 agent 标签，回退默认 ${config.opencode.agent}`;
    } else {
      const name = parsed.name ?? "";
      const label = `agent:${name.toLowerCase()}`;
      next.push(label);
      const warned =
        config.opencode.agents.length > 0 &&
        !config.opencode.agents.some((a) => a.toLowerCase() === name.toLowerCase());
      ack = warned
        ? `✅ 已切 ${label}（下一 turn 生效）\n⚠️ ${name} 不在配置目录中，派发时将回退默认`
        : `✅ 已切 ${label}（下一 turn 生效）`;
    }
    try {
      await tracker.updateIssue(b.issue_key, { labels: next });
    } catch (e) {
      await this.deps.feishu.replyFlat(replyTarget, `切换失败: ${toTaskingError(e).message}`);
      return;
    }
    this.deps.requestRefresh?.();
    await this.deps.feishu.replyFlat(replyTarget, ack);
  }

  private async onDispatch(taskId: string): Promise<void> {
    const config = this.deps.config();
    if (!config.feishu.enabled) return;
    const existing = this.deps.bindings.getBinding(taskId);
    if (existing) {
      if (existing.status === "terminal") {
        this.deps.bindings.markActive(taskId);
      }
      return;
    }
    const entry = this.deps.scheduler?.state.running.get(taskId);
    const issueKey = entry?.task.identifier ?? taskId;
    const intakeChat = config.feishu.intake_chat_id;
    if (!intakeChat) return;
    const title = entry?.task.title ?? issueKey;
    let rootId = "";
    try {
      rootId = await this.deps.feishu.postMessage(intakeChat, `📋 ${issueKey} · ${title} 已开始`);
    } catch (e) {
      this.deps.logger.warn("onDispatch postMessage failed", {
        issue: issueKey,
        error: toTaskingError(e).message,
      });
      return;
    }
    let threadId: string | null = null;
    try {
      const r = await this.deps.feishu.replyInThread(rootId, "💬 可在此话题回复");
      threadId = r.thread_id;
    } catch (e) {
      this.deps.logger.warn("onDispatch replyInThread failed", {
        issue: issueKey,
        error: toTaskingError(e).message,
      });
    }
    this.deps.bindings.upsertBinding({
      issue_id: taskId,
      issue_key: issueKey,
      chat_id: intakeChat,
      root_id: rootId,
      thread_id: threadId,
    });
  }

  private async onTerminate(taskId: string, reason: string): Promise<void> {
    const config = this.deps.config();
    if (!config.feishu.enabled) return;
    if (reason !== "terminal") return;
    const b = this.deps.bindings.getBinding(taskId);
    if (!b || b.status === "terminal") return;
    try {
      await this.deps.feishu.replyFlat(b.root_id, `✅ 已完结 ${b.issue_key}`);
    } catch (e) {
      this.deps.logger.warn("onTerminate ack failed", {
        issue: b.issue_key,
        error: toTaskingError(e).message,
      });
    }
    this.deps.bindings.markTerminal(taskId);
  }
}

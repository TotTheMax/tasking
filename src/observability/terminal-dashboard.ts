import type {
  OrchestratorRuntimeState,
  RuntimeDirectSession,
  RuntimeSnapshot,
} from "../shared/types.js";
import { setLocale, translate } from "../translate/locale.js";
import type { ActivityEvent, ActivityStore } from "./activity-store.js";
import { CONFIG_SECTIONS } from "./config-view.js";
import type { ConfigView } from "./config-view.js";
import type { LogEntry, LogRingBuffer } from "./log-buffer.js";
import type { LogLevel } from "./logger.js";
import type { Logger } from "./logger.js";
import { buildSnapshot } from "./snapshot.js";
import type { SnapshotExtras } from "./snapshot.js";
import { truncateToWidth, wrapToWidth } from "./wrap.js";

function syncLocaleFromConfig(view: ConfigView): void {
  setLocale(view.config.interface_language === "en" ? "en" : "zh");
}

const SPARKLINE_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GRAPH_COLUMNS = 24;
const GRAPH_WINDOW_MS = 10 * 60 * 1000;
const BAR_WIDTH = 10;
const DETAIL_OUTPUT_MAX_LINES = 100;
const DESCRIPTION_FOLD_LINES = 6;

function capTailLines(text: string, max: number): { lines: string[]; dropped: number } {
  const parts = text.split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length <= max) return { lines: parts, dropped: 0 };
  return { lines: parts.slice(-max), dropped: parts.length - max };
}

function logFieldText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function logFieldPriority(key: string, value: unknown): number {
  if (key === "auto_approve") return 2;
  return typeof value === "string" && value.length > 20 ? 1 : 0;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

const ENTER_ALT = "\x1b[?1049h";
const EXIT_ALT = "\x1b[?1049l";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const CURSOR_HOME = "\x1b[H";
const CLEAR_LINE = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const MAGENTA = "\x1b[35m";

export interface TerminalDashboardOptions {
  state?: () => OrchestratorRuntimeState;
  fetchSnapshot?: () => Promise<RuntimeSnapshot>;
  logger: Logger;
  renderFn?: (content: string) => void;
  intervalMs?: number;
  dashboardUrl?: string | null;
  onQuit?: () => void;
  logBuffer?: LogRingBuffer;
  configView?: () => ConfigView;
  fetchConfig?: () => Promise<ConfigView>;
  activityStore?: ActivityStore;
  fetchActivity?: (taskId: string) => Promise<ActivityEvent[]>;
  directSessions?: () => RuntimeDirectSession[];
  directTotals?: () => { input_tokens: number; output_tokens: number; total_tokens: number };
  terminalWidth?: () => number;
}

interface TokenSample {
  timestamp: number;
  total: number;
}

type TuiMode =
  | "overview"
  | "detail-running"
  | "detail-retry"
  | "detail-direct"
  | "logs"
  | "config"
  | "activity"
  | "activity-detail";
type Focus = "running" | "backoff" | "direct";

export class TerminalDashboard {
  private readonly opts: TerminalDashboardOptions;
  private timer: NodeJS.Timeout | null = null;
  private tokenSamples: TokenSample[] = [];
  private lastRenderedContent: string | null = null;
  private lastRenderedAt = 0;
  private readonly intervalMs: number;
  private readonly renderFn: (content: string) => void;
  private altScreenActive = false;
  private stdinActive = false;
  private mode: TuiMode = "overview";
  private focus: Focus = "running";
  private selectedIndex = 0;
  private selectedId: string | null = null;
  private detailId: string | null = null;
  private descExpanded = false;
  private escBuffer = "";
  private escTimer: NodeJS.Timeout | null = null;
  private lastSnapshot: RuntimeSnapshot | null = null;
  private lastConfigView: ConfigView | null = null;
  private configScrollOffset = 0;
  private logFollow = true;
  private logPinnedTop: LogEntry | null = null;
  private logLevelFilter: LogLevel = "info";
  private searchActive = false;
  private searchQuery = "";
  private searchFilterOnly = false;
  private spinnerFrame = 0;
  private activityFollow = true;
  private activityAnchoredStart: number | null = null;
  private activityCursor = 0;
  private activityDetailScroll = 0;
  private activityReturnMode: TuiMode = "detail-running";
  private lastActivityEvents: ActivityEvent[] = [];
  private lastActivityForId: string | null = null;
  private readonly terminalWidthFn: () => number;
  private renderInFlight = false;
  private renderQueued = false;
  private static readonly MIN_RERENDER_MS = 200;
  private static readonly ESC_TIMEOUT_MS = 50;
  private static readonly LOG_VIEWPORT = 30;
  private static readonly CONFIG_VIEWPORT = 30;
  private static readonly ACTIVITY_VIEWPORT = 30;
  private static readonly ACTIVITY_EVENT_WIDTH_PAD = 13;
  private static readonly ACTIVITY_DETAIL_WIDTH_PAD = 4;

  constructor(opts: TerminalDashboardOptions) {
    this.opts = opts;
    this.intervalMs = opts.intervalMs ?? 1000;
    this.renderFn = opts.renderFn ?? ((content: string) => process.stderr.write(content));
    this.terminalWidthFn = opts.terminalWidth ?? (() => process.stdout.columns ?? 80);
  }

  start(intervalMs?: number): void {
    const ms = intervalMs ?? this.intervalMs;
    this.renderFn(`${ENTER_ALT}${CLEAR_SCREEN}${HIDE_CURSOR}`);
    this.altScreenActive = true;
    this.setupStdin();
    this.doRender();
    this.timer = setInterval(() => this.doRender(), ms);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.teardownStdin();
    if (this.altScreenActive) {
      this.renderFn(`${SHOW_CURSOR}${EXIT_ALT}`);
      this.altScreenActive = false;
    }
  }

  forceRender(): void {
    this.doRender();
  }

  handleKey(key: string): void {
    if (key === "\x1b") {
      this.escBuffer = "\x1b";
      if (this.escTimer) clearTimeout(this.escTimer);
      this.escTimer = setTimeout(() => {
        this.processKey(this.escBuffer);
        this.escBuffer = "";
        this.escTimer = null;
      }, TerminalDashboard.ESC_TIMEOUT_MS);
      return;
    }
    if (this.escBuffer) {
      this.escBuffer += key;
      if (this.escBuffer.length >= 3) {
        if (this.escTimer) {
          clearTimeout(this.escTimer);
          this.escTimer = null;
        }
        this.processKey(this.escBuffer);
        this.escBuffer = "";
        return;
      }
      return;
    }
    this.processKey(key);
  }

  private processKey(key: string): void {
    if (this.searchActive) {
      this.handleSearchInput(key);
      return;
    }
    switch (key) {
      case "\x03":
        process.kill(process.pid, "SIGINT");
        return;
      case "\x1b[A":
      case "\x1bOA":
      case "k":
        if (this.mode === "overview") this.moveSelection(-1);
        else if (this.mode === "logs") this.scrollLogs(-1);
        else if (this.mode === "config") this.scrollConfig(-1);
        else if (this.mode === "activity") this.moveActivityCursor(-1);
        else if (this.mode === "activity-detail") this.scrollActivityDetail(-1);
        break;
      case "\x1b[B":
      case "\x1bOB":
      case "j":
        if (this.mode === "overview") this.moveSelection(1);
        else if (this.mode === "logs") this.scrollLogs(1);
        else if (this.mode === "config") this.scrollConfig(1);
        else if (this.mode === "activity") this.moveActivityCursor(1);
        else if (this.mode === "activity-detail") this.scrollActivityDetail(1);
        break;
      case "\t":
      case "\x1b[D":
      case "\x1bOD":
      case "\x1b[C":
      case "\x1bOC":
      case "h":
      case "l":
        if (this.mode === "overview") this.toggleFocus();
        break;
      case "\r":
      case "\n":
        if (this.mode === "overview") this.enterDetail();
        else if (this.mode === "activity") this.enterActivityDetail();
        break;
      case "a":
        if (this.mode === "detail-running" || this.mode === "detail-direct") this.enterActivity();
        break;
      case "e":
        if (this.mode === "detail-running") {
          this.descExpanded = !this.descExpanded;
        }
        break;
      case "L":
        if (this.mode === "overview" && this.opts.logBuffer) this.enterLogs();
        break;
      case "c":
        if (this.mode === "overview" && this.hasConfigSource()) this.enterConfig();
        break;
      case "f":
      case " ":
        if (this.mode === "logs") {
          this.toggleLogFollow();
        } else if (this.mode === "activity") {
          this.toggleActivityFollow();
        }
        break;
      case "1":
        if (this.mode === "logs") {
          this.logLevelFilter = "debug";
        }
        break;
      case "2":
        if (this.mode === "logs") {
          this.logLevelFilter = "info";
        }
        break;
      case "3":
        if (this.mode === "logs") {
          this.logLevelFilter = "warn";
        }
        break;
      case "4":
        if (this.mode === "logs") {
          this.logLevelFilter = "error";
        }
        break;
      case "F":
        if (this.mode === "logs" && this.searchQuery) {
          this.searchFilterOnly = !this.searchFilterOnly;
        }
        break;
      case "n":
        if (this.mode === "logs" && this.searchQuery) this.jumpMatch(1);
        break;
      case "N":
        if (this.mode === "logs" && this.searchQuery) this.jumpMatch(-1);
        break;
      case "/":
        if (this.mode === "logs") {
          this.searchActive = true;
          this.searchQuery = "";
        }
        break;
      case "\x1b":
      case "q":
        if (this.mode === "activity-detail") this.exitActivityDetail();
        else if (this.mode === "logs") this.exitLogs();
        else if (this.mode === "config") this.exitConfig();
        else if (this.mode === "activity") this.exitActivity();
        else if (this.mode !== "overview") this.exitDetail();
        else this.opts.onQuit?.();
        break;
      default:
        return;
    }
    this.lastRenderedContent = null;
    this.doRender();
  }

  private handleSearchInput(key: string): void {
    if (key === "\x1b") {
      this.searchActive = false;
      this.searchQuery = "";
    } else if (key === "\r" || key === "\n") {
      this.searchActive = false;
      if (this.searchQuery) this.jumpMatch(1);
    } else if (key === "\x7f" || key === "\b") {
      this.searchQuery = this.searchQuery.slice(0, -1);
      if (!this.searchQuery) this.searchActive = false;
    } else if (key.length === 1 && key >= " " && key <= "~") {
      this.searchQuery += key;
    }
    this.lastRenderedContent = null;
    this.doRender();
  }

  private moveSelection(dir: number): void {
    const items = this.getFocusedItems();
    if (items.length === 0) return;
    const current = this.indexOfSelected(items);
    const next = Math.max(0, Math.min(items.length - 1, current + dir));
    this.selectedIndex = next;
    this.selectedId = items[next]?.id ?? null;
  }

  private indexOfSelected(items: { id: string }[]): number {
    if (this.selectedId !== null) {
      const idx = items.findIndex((item) => item.id === this.selectedId);
      if (idx !== -1) return idx;
    }
    return Math.min(this.selectedIndex, Math.max(items.length - 1, 0));
  }

  private directItems(): RuntimeDirectSession[] {
    return this.lastSnapshot?.direct ?? [];
  }

  private availableFocuses(): Focus[] {
    return this.directItems().length > 0
      ? ["running", "backoff", "direct"]
      : ["running", "backoff"];
  }

  private toggleFocus(): void {
    const order = this.availableFocuses();
    const idx = order.indexOf(this.focus);
    this.focus = order[(idx + 1) % order.length] ?? "running";
    this.selectedIndex = 0;
    this.selectedId = null;
  }

  private enterDetail(): void {
    const items = this.getFocusedItems();
    if (items.length === 0) return;
    const idx = this.indexOfSelected(items);
    const item = items[idx];
    if (!item) return;
    this.detailId = item.id;
    this.mode =
      this.focus === "running"
        ? "detail-running"
        : this.focus === "direct"
          ? "detail-direct"
          : "detail-retry";
    this.descExpanded = false;
  }

  private exitDetail(): void {
    this.mode = "overview";
    this.detailId = null;
  }

  private enterLogs(): void {
    this.mode = "logs";
    this.logFollow = true;
    this.logPinnedTop = null;
    this.searchQuery = "";
    this.searchActive = false;
    this.searchFilterOnly = false;
  }

  private exitLogs(): void {
    this.mode = "overview";
    this.searchQuery = "";
    this.searchActive = false;
    this.searchFilterOnly = false;
  }

  private hasConfigSource(): boolean {
    return Boolean(this.opts.configView || this.opts.fetchConfig);
  }

  private enterConfig(): void {
    this.mode = "config";
    this.configScrollOffset = 0;
  }

  private exitConfig(): void {
    this.mode = "overview";
    this.configScrollOffset = 0;
  }

  private enterActivity(): void {
    this.activityReturnMode = this.mode === "detail-direct" ? "detail-direct" : "detail-running";
    this.mode = "activity";
    this.activityFollow = true;
    this.activityAnchoredStart = null;
  }

  private exitActivity(): void {
    this.mode = this.activityReturnMode;
    this.activityAnchoredStart = null;
  }

  private enterActivityDetail(): void {
    const entries = this.getActivityEntries();
    if (entries.length === 0) return;
    this.mode = "activity-detail";
    this.activityDetailScroll = 0;
  }

  private exitActivityDetail(): void {
    this.mode = "activity";
    this.activityDetailScroll = 0;
  }

  private moveActivityCursor(dir: number): void {
    const total = this.getActivityEntries().length;
    if (total === 0) return;
    const wasFollowing = this.activityFollow;
    this.activityFollow = false;
    const current =
      wasFollowing || this.activityCursor < 0
        ? total - 1
        : Math.max(0, Math.min(this.activityCursor, total - 1));
    const next = Math.max(0, Math.min(total - 1, current + dir));
    this.activityCursor = next;
    this.ensureActivityCursorVisible();
  }

  private ensureActivityCursorVisible(): void {
    const total = this.getActivityEntries().length;
    const viewport = TerminalDashboard.ACTIVITY_VIEWPORT;
    const maxStart = Math.max(0, total - viewport);
    let start = this.activityAnchoredStart ?? 0;
    if (this.activityCursor < start) start = this.activityCursor;
    if (this.activityCursor > start + viewport - 1) start = this.activityCursor - viewport + 1;
    this.activityAnchoredStart = Math.max(0, Math.min(maxStart, start));
  }

  private scrollActivityDetail(dir: number): void {
    const body = this.getActivityDetailBody();
    const maxScroll = Math.max(0, body.length - TerminalDashboard.ACTIVITY_VIEWPORT);
    this.activityDetailScroll = Math.max(0, Math.min(maxScroll, this.activityDetailScroll + dir));
  }

  private getActivityEntries(): ActivityEvent[] {
    if (this.opts.fetchActivity) {
      return this.lastActivityForId === this.detailId ? this.lastActivityEvents : [];
    }
    if (this.opts.activityStore && this.detailId) {
      return this.opts.activityStore.recent(this.detailId, 500);
    }
    return [];
  }

  private getActivityMeta(): {
    identifier: string;
    agent: string | null;
    model: string | null;
    variant: string | null;
    turn: number;
    tokens: number;
  } | null {
    if (this.opts.state && this.detailId) {
      const entry = this.opts.state().running.get(this.detailId);
      if (entry) {
        return {
          identifier: entry.task_identifier,
          agent: entry.agent,
          model: entry.model,
          variant: entry.variant,
          turn: entry.turn_count,
          tokens: entry.total_tokens,
        };
      }
    }
    const snap = this.lastSnapshot;
    if (snap && this.detailId) {
      const row = snap.running.find((e) => e.task_id === this.detailId);
      if (row) {
        return {
          identifier: row.task_identifier,
          agent: row.agent,
          model: row.model,
          variant: row.variant,
          turn: row.turn_count,
          tokens: row.tokens.total_tokens,
        };
      }
      const direct = (snap.direct ?? []).find((d) => d.id === this.detailId);
      if (direct) {
        return {
          identifier: direct.name ?? direct.project ?? direct.path,
          agent: direct.agent,
          model: direct.model,
          variant: direct.variant,
          turn: direct.turns,
          tokens: direct.total_tokens,
        };
      }
    }
    return null;
  }

  private scrollConfig(dir: number): void {
    const view = this.lastConfigView;
    if (!view) return;
    const viewport = TerminalDashboard.CONFIG_VIEWPORT;
    const maxStart = Math.max(0, this.configLineCount() - viewport);
    this.configScrollOffset = Math.max(0, Math.min(maxStart, this.configScrollOffset + dir));
  }

  private configLineCount(): number {
    const view = this.lastConfigView;
    return view ? this.buildConfigLines(view).length : 0;
  }
  private scrollLogs(dir: number): void {
    const wasFollowing = this.logFollow;
    this.logFollow = false;
    const entries = this.getLogEntries();
    const total = entries.length;
    const maxStart = this.logMaxStart(total);
    const currentStart = wasFollowing ? maxStart : this.logPinnedStart(entries, maxStart);
    const next = Math.max(0, Math.min(maxStart, currentStart + dir));
    this.logPinnedTop = entries[next] ?? null;
  }

  private toggleLogFollow(): void {
    if (this.logFollow) {
      const entries = this.getLogEntries();
      if (entries.length === 0) return;
      this.logPinnedTop = entries[this.logMaxStart(entries.length)] ?? null;
      this.logFollow = false;
    } else {
      this.logFollow = true;
      this.logPinnedTop = null;
    }
  }

  private toggleActivityFollow(): void {
    if (this.activityFollow) {
      const entries = this.getActivityEntries();
      if (entries.length === 0) return;
      this.activityAnchoredStart = Math.max(
        0,
        entries.length - TerminalDashboard.ACTIVITY_VIEWPORT,
      );
      this.activityFollow = false;
    } else {
      this.activityFollow = true;
      this.activityAnchoredStart = null;
    }
  }

  private logMaxStart(total: number): number {
    return Math.max(0, total - TerminalDashboard.LOG_VIEWPORT);
  }

  private logPinnedStart(entries: LogEntry[], maxStart: number): number {
    const pinned = this.logPinnedTop;
    if (pinned) {
      const idx = entries.indexOf(pinned);
      if (idx !== -1) return Math.min(idx, maxStart);
    }
    this.logPinnedTop = entries[0] ?? null;
    return 0;
  }

  private jumpMatch(dir: number): void {
    const entries = this.getLogEntries();
    if (entries.length === 0 || !this.searchQuery) return;
    const query = this.searchQuery.toLowerCase();
    const matches: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i]?.msg.toLowerCase().includes(query)) matches.push(i);
    }
    if (matches.length === 0) return;
    const maxStart = this.logMaxStart(entries.length);
    const currentTop = this.logFollow ? maxStart : this.logPinnedStart(entries, maxStart);
    let next: number | undefined;
    if (dir > 0) {
      next = matches.find((m) => m > currentTop);
      if (next === undefined) next = matches[0];
    } else {
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        if (m !== undefined && m < currentTop) {
          next = m;
          break;
        }
      }
      if (next === undefined) next = matches[matches.length - 1];
    }
    if (next !== undefined) {
      this.logFollow = false;
      this.logPinnedTop = entries[Math.max(0, Math.min(maxStart, next))] ?? null;
    }
  }
  private getLogEntries() {
    if (!this.opts.logBuffer) return [];
    const all = this.opts.logBuffer.recent(200);
    const levelPriority: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const minPriority = levelPriority[this.logLevelFilter];
    const filtered = all.filter((e) => levelPriority[e.level] >= minPriority);
    if (this.searchFilterOnly && this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      return filtered.filter((e) => e.msg.toLowerCase().includes(q));
    }
    return filtered;
  }

  private getFocusedItems(): { id: string }[] {
    const snap = this.lastSnapshot;
    if (!snap) return [];
    if (this.focus === "running") {
      return snap.running.map((e) => ({ id: e.task_id }));
    }
    if (this.focus === "direct") {
      return (snap.direct ?? []).map((d) => ({ id: d.id }));
    }
    return snap.retrying.map((e) => ({ id: e.task_id }));
  }

  private setupStdin(): void {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", this.onStdinData);
      this.stdinActive = true;
    }
  }

  private teardownStdin(): void {
    if (this.stdinActive) {
      process.stdin.removeListener("data", this.onStdinData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      this.stdinActive = false;
    }
  }

  private readonly onStdinData = (data: Buffer): void => {
    this.handleKey(data.toString());
  };

  private doRender(): void {
    if (this.opts.fetchSnapshot) {
      if (this.renderInFlight) {
        this.renderQueued = true;
        return;
      }
      this.renderInFlight = true;
      void this.renderAsync().finally(() => {
        this.renderInFlight = false;
        if (this.renderQueued) {
          this.renderQueued = false;
          this.doRender();
        }
      });
    } else {
      this.renderSync();
    }
  }

  private snapshotExtras(): SnapshotExtras {
    return {
      direct: this.opts.directSessions?.() ?? [],
      directTotals: this.opts.directTotals?.(),
    };
  }

  private renderSync(): void {
    if (!this.opts.state) return;
    try {
      const snap = buildSnapshot(this.opts.state(), this.snapshotExtras());
      if (this.mode === "config") {
        const configView = this.opts.configView ? this.opts.configView() : null;
        if (configView) {
          syncLocaleFromConfig(configView);
          this.lastConfigView = configView;
        }
      }
      this.renderSnapshot(snap);
    } catch (e) {
      this.opts.logger.warn("tui render failed", { error: String(e) });
    }
  }

  private async getSnapshot(): Promise<RuntimeSnapshot> {
    if (this.opts.fetchSnapshot) {
      return await this.opts.fetchSnapshot();
    }
    if (this.opts.state) {
      return buildSnapshot(this.opts.state(), this.snapshotExtras());
    }
    return this.emptySnapshot();
  }

  private async getConfigView(): Promise<ConfigView | null> {
    if (this.opts.fetchConfig) {
      const view = await this.opts.fetchConfig();
      if (view) syncLocaleFromConfig(view);
      return view;
    }
    if (this.opts.configView) {
      const view = this.opts.configView();
      syncLocaleFromConfig(view);
      return view;
    }
    return null;
  }

  private async renderAsync(): Promise<void> {
    try {
      const snap = await this.getSnapshot();
      const configView = this.mode === "config" ? await this.getConfigView() : null;
      if (configView) this.lastConfigView = configView;
      if (
        (this.mode === "activity" || this.mode === "activity-detail") &&
        this.detailId &&
        this.opts.fetchActivity
      ) {
        try {
          this.lastActivityEvents = await this.opts.fetchActivity(this.detailId);
          this.lastActivityForId = this.detailId;
        } catch (e) {
          this.opts.logger.warn("tui activity fetch failed", { error: String(e) });
        }
      }
      this.renderSnapshot(snap);
    } catch (e) {
      this.opts.logger.warn("tui render failed", { error: String(e) });
    }
  }

  private renderSnapshot(snap: RuntimeSnapshot): void {
    this.lastSnapshot = snap;
    this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
    const now = Date.now();
    const currentTotal = snap.totals.total_tokens;
    this.tokenSamples = this.updateSamples(this.tokenSamples, now, currentTotal);
    const tps = this.computeTps(this.tokenSamples, now, currentTotal);

    if (this.mode === "overview") {
      if (this.focus === "direct" && this.directItems().length === 0) {
        this.focus = "running";
        this.selectedIndex = 0;
        this.selectedId = null;
      }
      const items = this.getFocusedItems();
      if (items.length === 0) {
        this.selectedIndex = 0;
        this.selectedId = null;
      } else {
        const idx = this.indexOfSelected(items);
        this.selectedIndex = idx;
        this.selectedId = items[idx]?.id ?? null;
      }
    }

    const content =
      this.mode === "overview"
        ? this.formatOverview(snap, tps, now)
        : this.mode === "logs"
          ? this.formatLogs()
          : this.mode === "config"
            ? this.formatConfig()
            : this.mode === "activity"
              ? this.formatActivity()
              : this.mode === "activity-detail"
                ? this.formatActivityDetail()
                : this.formatDetail(now);
    if (
      content === this.lastRenderedContent &&
      now - this.lastRenderedAt < TerminalDashboard.MIN_RERENDER_MS
    ) {
      return;
    }
    this.renderFn(content);
    this.lastRenderedContent = content;
    this.lastRenderedAt = now;
  }

  private formatOverview(snap: RuntimeSnapshot, tps: number, now: number): string {
    const lines: string[] = [];
    const agentCount = snap.counts.running;
    const maxAgents = snap.max_concurrent_agents;
    const runtime = this.formatRuntime(snap.totals.seconds_running);
    const tokens = snap.totals;
    const url = this.opts.dashboardUrl ?? null;

    lines.push(`${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}·${RESET} ${DIM}${runtime}${RESET}`);
    if (url) {
      lines.push(`${GRAY}│  ${DIM}Dashboard:  ${url}${RESET}`);
    }
    lines.push(`│  Agents: ${this.progressBar(agentCount, maxAgents)}`);
    lines.push(
      `│  ${DIM}Tokens: ${RESET}in ${this.formatCount(tokens.input_tokens)} ${GRAY}|${RESET} out ${this.formatCount(tokens.output_tokens)} ${GRAY}|${RESET} total ${this.formatCount(tokens.total_tokens)}  ${GRAY}·${RESET}  Throughput: ${this.formatTps(tps)} tps`,
    );

    const runningFocused = this.focus === "running";
    lines.push(`${GRAY}│${RESET}`);
    const runHeader = runningFocused
      ? `${CYAN}├─ ${GREEN}●${RESET} Running ${BOLD}◄${RESET}`
      : `${CYAN}├─ ${GREEN}●${RESET} Running${RESET}`;
    lines.push(runHeader);
    if (snap.running.length === 0) {
      lines.push(`${GRAY}│  ${DIM}No active agents${RESET}`);
    } else {
      lines.push(
        `${GRAY}│  ${DIM}ID          STATE           AGE/TURN    TOKENS     SESSION      EVENT${RESET}`,
      );
      let i = 0;
      for (const entry of snap.running) {
        const ageSeconds = (now - entry.started_at) / 1000;
        const age = this.formatRuntime(ageSeconds);
        const ageColor = ageSeconds < 300 ? GREEN : ageSeconds < 1800 ? YELLOW : RED;
        const session = this.compactSession(entry.session_id);
        const event = entry.last_event ?? "none";
        const spinner = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length] ?? "⠋";
        const cursor =
          runningFocused && i === this.selectedIndex
            ? `${CYAN}${spinner}${RESET} `
            : `${GRAY} ${RESET} `;
        lines.push(
          `${GRAY}│${RESET} ${cursor}${this.pad(entry.task_identifier, 11)} ${this.pad(entry.state, 15)} ${ageColor}${this.pad(`${age}/${entry.turn_count}`, 11)}${RESET} ${this.pad(String(this.formatCount(entry.tokens.total_tokens)), 10)} ${this.pad(session, 11)} ${event}`,
        );
        i++;
      }
    }

    const backoffFocused = this.focus === "backoff";
    lines.push(`${GRAY}│${RESET}`);
    const backoffHeader = backoffFocused
      ? `${CYAN}├─ ${GRAY}●${RESET} Backoff queue ${BOLD}◄${RESET}`
      : `${CYAN}├─ ${GRAY}●${RESET} Backoff queue${RESET}`;
    lines.push(backoffHeader);
    if (snap.retrying.length === 0) {
      lines.push(`${GRAY}│  ${DIM}No queued retries${RESET}`);
    } else {
      let i = 0;
      for (const entry of snap.retrying) {
        const dueIn = Math.max(0, (entry.due_at - now) / 1000);
        const err = entry.error ? ` ${RED}error=${entry.error.slice(0, 50)}${RESET}` : "";
        const cursor =
          backoffFocused && i === this.selectedIndex ? `${YELLOW}↻${RESET} ` : `${GRAY} ${RESET} `;
        lines.push(
          `${GRAY}│${RESET} ${cursor}${entry.task_identifier} attempt=${entry.attempt} in ${dueIn.toFixed(1)}s${err}`,
        );
        i++;
      }
    }

    const direct = snap.direct ?? [];
    if (direct.length > 0) {
      const directFocused = this.focus === "direct";
      const runningCount = direct.filter((d) => d.status === "running").length;
      const countTag =
        runningCount > 0 ? `(${direct.length} · ${runningCount} running)` : `(${direct.length})`;
      lines.push(`${GRAY}│${RESET}`);
      const directHeader = directFocused
        ? `${CYAN}├─ ${MAGENTA}●${RESET} Direct sessions ${countTag} ${BOLD}◄${RESET}`
        : `${CYAN}├─ ${MAGENTA}●${RESET} Direct sessions ${countTag}${RESET}`;
      lines.push(directHeader);
      lines.push(`${GRAY}│  ${DIM}NAME             STATUS    AGE        TOKENS     QUEUE${RESET}`);
      let i = 0;
      for (const entry of direct) {
        const age =
          entry.updated_at > 0 ? this.formatRuntime((now - entry.updated_at) / 1000) : "n/a";
        const status = entry.status === "running" ? "running" : "idle";
        const statusColored =
          entry.status === "running"
            ? `${GREEN}${status.padEnd(9)}${RESET}`
            : `${YELLOW}${status.padEnd(9)}${RESET}`;
        const label = entry.name ?? entry.project ?? entry.path;
        const spinner = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length] ?? "⠋";
        const cursor =
          directFocused && i === this.selectedIndex
            ? `${CYAN}${spinner}${RESET} `
            : `${GRAY} ${RESET} `;
        lines.push(
          `${GRAY}│${RESET} ${cursor}${this.pad(label, 16)} ${statusColored} ${this.pad(age, 10)} ${this.pad(this.formatCount(entry.total_tokens), 10)} ${entry.queued}`,
        );
        i++;
      }
    }

    lines.push(`${GRAY}│${RESET}`);
    lines.push(`${CYAN}├─ Throughput (10min)${RESET}`);
    lines.push(`│  ${this.sparkline(this.tokenSamples, now, snap.totals.total_tokens)}`);

    if (this.opts.logBuffer) {
      lines.push(`${GRAY}│${RESET}`);
      const levelTag = this.logLevelFilter === "debug" ? "Logs" : `Logs [${this.logLevelFilter}]`;
      lines.push(`${CYAN}├─ ${levelTag}${RESET}`);
      const entries = this.getLogEntries().slice(-10);
      if (entries.length === 0) {
        lines.push(`${GRAY}│  ${DIM}No recent logs${RESET}`);
      } else {
        for (const entry of entries) {
          const time = entry.ts.slice(11, 19);
          const color =
            entry.level === "error"
              ? RED
              : entry.level === "warn"
                ? YELLOW
                : entry.level === "debug"
                  ? GRAY
                  : "";
          const reset = color ? RESET : "";
          const msg = this.logLineText(entry, Math.max(60, this.terminalWidthFn() - 26));
          lines.push(
            `${GRAY}│${RESET}  ${GRAY}${time}${RESET} ${color}${entry.level.toUpperCase().padEnd(5)}${reset} ${msg}`,
          );
        }
      }
    }

    lines.push(`${GRAY}│${RESET}`);
    const logHint = this.opts.logBuffer ? " · L logs" : "";
    const configHint = this.hasConfigSource() ? " · C config" : "";
    lines.push(
      `${GRAY}│  ${DIM}↑↓ navigate · ←/→ or Tab switch · Enter details${logHint}${configHint} · Esc/q back · Ctrl-C exit${RESET}`,
    );
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private compose(lines: string[]): string {
    const prefix = this.altScreenActive ? CURSOR_HOME : "";
    const body = lines.map((l) => `${l}${CLEAR_LINE}`).join("\n");
    return `${prefix}${body}\n${CLEAR_BELOW}`;
  }

  private formatDetail(now: number): string {
    if (this.mode === "detail-running") {
      return this.formatRunningDetail(now);
    }
    if (this.mode === "detail-direct") {
      return this.formatDirectDetail(now);
    }
    return this.formatRetryDetail(now);
  }

  private formatRunningDetail(now: number): string {
    if (this.opts.state) {
      return this.formatRunningDetailFromState(now);
    }
    return this.formatRunningDetailFromSnapshot(now);
  }

  private fieldLines(label: string, value: string): string[] {
    const labelColon = `${label}:`;
    const head = `│  ${DIM}${labelColon}${RESET}${" ".repeat(Math.max(0, 14 - labelColon.length))}`;
    const cont = `│${" ".repeat(16)}`;
    const wrapped = wrapToWidth(value, 34);
    if (wrapped.length === 0) return [head];
    return wrapped.map((line, i) => (i === 0 ? `${head}${line}` : `${cont}${line}`));
  }

  private logLineText(entry: LogEntry, maxChars: number): string {
    const fields = Object.entries(entry.fields ?? {});
    if (fields.length === 0) {
      return entry.msg.length > maxChars ? `${entry.msg.slice(0, maxChars)}…` : entry.msg;
    }
    const ordered = fields.sort(
      (a, b) => logFieldPriority(b[0], b[1]) - logFieldPriority(a[0], a[1]),
    );
    const suffix = ordered.map(([key, value]) => `${key}=${logFieldText(value)}`).join(" ");
    const text = `${entry.msg}  ${suffix}`;
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  }

  private pushDetailFields(lines: string[], fields: Array<[string, string]>): void {
    for (const [label, value] of fields) {
      for (const line of this.fieldLines(label, value)) {
        lines.push(line);
      }
    }
  }

  private formatRunningDetailFromState(now: number): string {
    const state = this.opts.state?.();
    if (!state) {
      this.exitDetail();
      return this.formatOverview(this.emptySnapshot(), 0, now);
    }
    const entry = this.detailId ? state.running.get(this.detailId) : null;
    if (!entry) {
      this.exitDetail();
      return this.formatOverview(buildSnapshot(state), 0, now);
    }
    const task = entry.task;
    const age = this.formatRuntime((now - entry.started_at) / 1000);
    const lines: string[] = [];

    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${BOLD}${task.identifier}${RESET}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    this.pushDetailFields(lines, [
      ["Title", task.title],
      ["State", task.state],
      ["Assignee", task.assignee ?? "n/a"],
      ["Priority", String(task.priority ?? "n/a")],
      ["Source", task.source],
      ...(task.url ? [["URL", task.url] as [string, string]] : []),
      ...(task.branch_name ? [["Branch", task.branch_name] as [string, string]] : []),
    ]);
    lines.push(`${GRAY}│${RESET}`);
    this.pushDetailFields(lines, [
      ["Workspace", entry.workspace_path],
      ["Session", entry.session_id ?? "n/a"],
      ["Agent", entry.agent ?? "n/a"],
      ["Model", entry.model ?? "n/a"],
      ...(entry.variant != null ? [["Variant", entry.variant] as [string, string]] : []),
      ["Started", `${age} ago`],
      ["Turn", String(entry.turn_count)],
      ["Last event", entry.last_event ?? "none"],
      ...(entry.waiting_approval ? [["Approval", "waiting for approval"] as [string, string]] : []),
    ]);
    if (entry.last_message) {
      this.pushDetailFields(lines, [["Last message", entry.last_message]]);
    }
    if (entry.retry_attempt !== null) {
      this.pushDetailFields(lines, [["Retry", `attempt ${entry.retry_attempt}`]]);
    }
    lines.push(`${GRAY}│${RESET}`);
    lines.push(
      `│  ${DIM}Tokens:${RESET}       in ${this.formatCount(entry.input_tokens)} ${GRAY}|${RESET} out ${this.formatCount(entry.output_tokens)} ${GRAY}|${RESET} total ${this.formatCount(entry.total_tokens)}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    if (task.labels.length > 0) {
      this.pushDetailFields(lines, [["Labels", task.labels.join(", ")]]);
    }
    if (task.blocked_by.length > 0) {
      const blockers = task.blocked_by.map((b) => b.identifier ?? b.id ?? "?").join(", ");
      this.pushDetailFields(lines, [["Blocked by", blockers]]);
    }
    let descTruncated = false;
    if (task.description) {
      lines.push(`${GRAY}│${RESET}`);
      lines.push(`│  ${DIM}Description:${RESET}`);
      const descLines = task.description.split("\n");
      while (descLines[descLines.length - 1] === "") {
        descLines.pop();
      }
      const descWrapped: string[] = [];
      for (const line of descLines) {
        for (const w of wrapToWidth(line, 48)) {
          descWrapped.push(w);
        }
      }
      descTruncated = descWrapped.length > DESCRIPTION_FOLD_LINES;
      const collapsed = descTruncated && !this.descExpanded;
      const shown = collapsed ? descWrapped.slice(0, DESCRIPTION_FOLD_LINES) : descWrapped;
      for (const line of shown) {
        lines.push(`${GRAY}│${RESET}  ${line}`);
      }
      if (collapsed) {
        lines.push(
          `${GRAY}│${RESET}  ${DIM}… (${descWrapped.length - DESCRIPTION_FOLD_LINES} more lines)${RESET}`,
        );
      }
    }

    lines.push(`${GRAY}│${RESET}`);
    const detailHints = ["Esc/q back", "a activity"];
    if (descTruncated) {
      detailHints.push(this.descExpanded ? "e collapse" : "e expand");
    }
    lines.push(`${GRAY}│  ${DIM}${detailHints.join(" · ")}${RESET}`);
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private approvalLabel(remainingMs: number | null | undefined): string {
    if (remainingMs == null) return "waiting for approval";
    const mins = Math.max(0, Math.round(remainingMs / 60000));
    return `waiting for approval (${mins}m left)`;
  }

  private formatRunningDetailFromSnapshot(now: number): string {
    const snap = this.lastSnapshot;
    if (!snap) {
      this.exitDetail();
      return this.formatOverview(this.emptySnapshot(), 0, now);
    }
    const entry = snap.running.find((e) => e.task_id === this.detailId);
    if (!entry) {
      this.exitDetail();
      return this.formatOverview(snap, 0, now);
    }
    const age = this.formatRuntime((now - entry.started_at) / 1000);
    const lines: string[] = [];

    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${BOLD}${entry.task_identifier}${RESET}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    this.pushDetailFields(lines, [
      ["State", entry.state],
      ["Workspace", entry.workspace_path],
      ["Session", entry.session_id ?? "n/a"],
      ["Agent", entry.agent ?? "n/a"],
      ["Model", entry.model ?? "n/a"],
      ...(entry.variant != null ? [["Variant", entry.variant] as [string, string]] : []),
      ["Started", `${age} ago`],
      ["Turn", String(entry.turn_count)],
      ["Last event", entry.last_event ?? "none"],
      ...(entry.waiting_approval
        ? [["Approval", this.approvalLabel(entry.waiting_remaining_ms)] as [string, string]]
        : []),
    ]);
    if (entry.last_message) {
      this.pushDetailFields(lines, [["Last message", entry.last_message]]);
    }
    lines.push(`${GRAY}│${RESET}`);
    lines.push(
      `│  ${DIM}Tokens:${RESET}       in ${this.formatCount(entry.tokens.input_tokens)} ${GRAY}|${RESET} out ${this.formatCount(entry.tokens.output_tokens)} ${GRAY}|${RESET} total ${this.formatCount(entry.tokens.total_tokens)}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    lines.push(`${GRAY}│  ${DIM}Esc/q back · a activity${RESET}`);
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private formatDirectDetail(now: number): string {
    const snap = this.lastSnapshot;
    const entry = snap?.direct?.find((d) => d.id === this.detailId);
    if (!snap || !entry) {
      this.exitDetail();
      return this.formatOverview(snap ?? this.emptySnapshot(), 0, now);
    }
    const age =
      entry.updated_at > 0 ? `${this.formatRuntime((now - entry.updated_at) / 1000)} ago` : "n/a";
    const lines: string[] = [];

    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${BOLD}${entry.name ?? entry.project ?? entry.path}${RESET} ${GRAY}(feishu direct)${RESET}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    this.pushDetailFields(lines, [
      ["Status", entry.status],
      ["Session", entry.session_id ?? "n/a"],
      ["Directory", entry.path],
      ["Agent", entry.agent ?? "n/a"],
      ["Model", entry.model ?? "n/a"],
      ...(entry.variant != null ? [["Variant", entry.variant] as [string, string]] : []),
      ["Turns", String(entry.turns)],
      ["Queued", String(entry.queued)],
      ["Updated", age],
      ...(entry.waiting_approval
        ? [["Approval", this.approvalLabel(entry.waiting_remaining_ms)] as [string, string]]
        : []),
    ]);
    lines.push(`${GRAY}│${RESET}`);
    lines.push(
      `│  ${DIM}Tokens:${RESET}       in ${this.formatCount(entry.input_tokens)} ${GRAY}|${RESET} out ${this.formatCount(entry.output_tokens)} ${GRAY}|${RESET} total ${this.formatCount(entry.total_tokens)}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    lines.push(`${GRAY}│  ${DIM}Esc/q back · a activity${RESET}`);
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private formatRetryDetail(now: number): string {
    if (this.opts.state) {
      return this.formatRetryDetailFromState(now);
    }
    return this.formatRetryDetailFromSnapshot(now);
  }

  private formatRetryDetailFromState(now: number): string {
    const state = this.opts.state?.();
    if (!state) {
      this.exitDetail();
      return this.formatOverview(this.emptySnapshot(), 0, now);
    }
    const entry = this.detailId ? state.retry_attempts.get(this.detailId) : null;
    if (!entry) {
      this.exitDetail();
      return this.formatOverview(buildSnapshot(state), 0, now);
    }
    const dueIn = Math.max(0, (entry.due_at_ms - now) / 1000);
    const lines: string[] = [];

    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${YELLOW}retry${RESET}: ${BOLD}${entry.identifier}${RESET}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    this.pushDetailFields(lines, [
      ["Identifier", entry.identifier],
      ["Attempt", String(entry.attempt)],
      ["Due in", `${dueIn.toFixed(1)}s`],
      ["Continuation", entry.continuation ? "yes" : "no"],
      ["Session", entry.session_id ?? "n/a"],
    ]);
    lines.push(`${GRAY}│${RESET}`);
    if (entry.error) {
      lines.push(`│  ${RED}${DIM}Error:${RESET}`);
      const errLines = entry.error.split("\n").slice(0, 8);
      for (const el of errLines) {
        for (const wrapped of wrapToWidth(el, 48)) {
          lines.push(`${GRAY}│${RESET}  ${RED}${wrapped}${RESET}`);
        }
      }
    } else {
      lines.push(`│  ${DIM}No error recorded${RESET}`);
    }

    lines.push(`${GRAY}│${RESET}`);
    lines.push(`${GRAY}│  ${DIM}Esc/q back${RESET}`);
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private formatRetryDetailFromSnapshot(now: number): string {
    const snap = this.lastSnapshot;
    if (!snap) {
      this.exitDetail();
      return this.formatOverview(this.emptySnapshot(), 0, now);
    }
    const entry = snap.retrying.find((e) => e.task_id === this.detailId);
    if (!entry) {
      this.exitDetail();
      return this.formatOverview(snap, 0, now);
    }
    const dueIn = Math.max(0, (entry.due_at - now) / 1000);
    const lines: string[] = [];

    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${YELLOW}retry${RESET}: ${BOLD}${entry.task_identifier}${RESET}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    this.pushDetailFields(lines, [
      ["Identifier", entry.task_identifier],
      ["Attempt", String(entry.attempt)],
      ["Due in", `${dueIn.toFixed(1)}s`],
    ]);
    lines.push(`${GRAY}│${RESET}`);
    if (entry.error) {
      lines.push(`│  ${RED}${DIM}Error:${RESET}`);
      const errLines = entry.error.split("\n").slice(0, 8);
      for (const el of errLines) {
        for (const wrapped of wrapToWidth(el, 48)) {
          lines.push(`${GRAY}│${RESET}  ${RED}${wrapped}${RESET}`);
        }
      }
    } else {
      lines.push(`│  ${DIM}No error recorded${RESET}`);
    }

    lines.push(`${GRAY}│${RESET}`);
    lines.push(`${GRAY}│  ${DIM}Esc/q back${RESET}`);
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private formatLogs(): string {
    const entries = this.getLogEntries();
    const total = entries.length;
    const viewport = TerminalDashboard.LOG_VIEWPORT;
    const maxStart = this.logMaxStart(total);
    let start: number;
    if (this.logFollow) {
      start = maxStart;
    } else {
      start = this.logPinnedStart(entries, maxStart);
    }
    const visible = entries.slice(start, start + viewport);
    const query = this.searchQuery.toLowerCase();

    const lines: string[] = [];
    const followTag = this.logFollow ? ` ${GREEN}[follow]${RESET}` : ` ${YELLOW}[paused]${RESET}`;
    const levelTag = ` ${CYAN}[${this.logLevelFilter}]${RESET}`;
    const searchTag = this.searchQuery
      ? ` ${CYAN}/${this.searchQuery}${RESET}${this.searchFilterOnly ? `${GRAY}(only)${RESET}` : ""}`
      : "";
    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${BOLD}Logs${RESET} ${GRAY}(${total} entries)${RESET}${followTag}${levelTag}${searchTag}`,
    );
    lines.push(`${GRAY}│${RESET}`);

    if (visible.length === 0) {
      lines.push(`${GRAY}│  ${DIM}No log entries${RESET}`);
    } else {
      for (const entry of visible) {
        const time = entry.ts.slice(11, 19);
        const color =
          entry.level === "error"
            ? RED
            : entry.level === "warn"
              ? YELLOW
              : entry.level === "debug"
                ? GRAY
                : "";
        const reset = color ? RESET : "";
        let msg = this.logLineText(entry, Math.max(60, this.terminalWidthFn() - 20));
        if (query && msg.toLowerCase().includes(query)) {
          msg = `${BOLD}${msg}${RESET}`;
        }
        lines.push(
          `${GRAY}│${RESET} ${GRAY}${time}${RESET} ${color}${entry.level.toUpperCase().padEnd(5)}${reset} ${msg}`,
        );
      }
    }

    lines.push(`${GRAY}│${RESET}`);
    if (this.searchActive) {
      lines.push(`${CYAN}│  /${this.searchQuery}█${RESET}`);
    }
    const scrollInfo = this.logFollow
      ? ""
      : ` ${GRAY}[${start}/${Math.max(0, total - viewport)}]${RESET}`;
    lines.push(
      `${GRAY}│  ${DIM}↑↓ scroll · Space/f pause · 1-4 level · / search · F filter-only · n/N match · Esc/q back${RESET}${scrollInfo}`,
    );
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private formatActivity(): string {
    const meta = this.getActivityMeta();
    const entries = this.getActivityEntries();
    const total = entries.length;
    const viewport = TerminalDashboard.ACTIVITY_VIEWPORT;
    let start: number;
    if (this.activityFollow) {
      start = Math.max(0, total - viewport);
      if (total > 0) this.activityCursor = total - 1;
    } else {
      const anchored = this.activityAnchoredStart ?? 0;
      start = Math.max(0, Math.min(anchored, Math.max(0, total - viewport)));
    }
    const visible = entries.slice(start, start + viewport);

    const lines: string[] = [];
    const ident = meta?.identifier ?? this.detailId ?? "?";
    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${BOLD}Activity${RESET} ${GRAY}·${RESET} ${BOLD}${ident}${RESET}`,
    );
    if (meta) {
      lines.push(`${GRAY}│${RESET}`);
      this.pushDetailFields(lines, [
        ["Agent", meta.agent ?? "n/a"],
        ["Model", meta.model ?? "n/a"],
        ...(meta.variant != null ? [["Variant", meta.variant] as [string, string]] : []),
        ["Turn", String(meta.turn)],
        ["Tokens", this.formatCount(meta.tokens)],
      ]);
    }
    lines.push(`${GRAY}│${RESET}`);

    if (visible.length === 0) {
      lines.push(`${GRAY}│  ${DIM}No activity events${RESET}`);
    } else {
      for (let i = 0; i < visible.length; i++) {
        const entry = visible[i];
        if (!entry) continue;
        const idx = start + i;
        const time = new Date(entry.ts).toISOString().slice(11, 19);
        const cursor = idx === this.activityCursor ? `${CYAN}❯${RESET} ` : `${GRAY} ${RESET} `;
        const prefix = `${GRAY}│${RESET} ${cursor}${GRAY}${time}${RESET} `;
        if (entry.type === "text" && entry.text !== undefined) {
          for (const wrapped of this.renderActivityText(entry.text)) {
            lines.push(`${prefix}${DIM}${wrapped}${RESET}`);
          }
        } else if (entry.type === "tool_use" && entry.tool !== undefined) {
          const failed = entry.exit !== undefined && entry.exit !== 0;
          const icon = failed ? "✗" : "🔧";
          const color = failed ? YELLOW : CYAN;
          const summary = truncateToWidth(this.toolCallSummary(entry), 35);
          lines.push(`${prefix}${color}${icon} ${summary}${RESET}`);
        } else if ((entry.type === "step_finish" || entry.type === "step_usage") && entry.tokens) {
          lines.push(`${prefix}${GRAY}◷ tokens +${this.formatCount(entry.tokens.total)}${RESET}`);
        } else if (entry.type === "step_start") {
          lines.push(`${prefix}${GRAY}▶ step${RESET}`);
        } else if (entry.type === "reasoning" && entry.text !== undefined) {
          for (const wrapped of this.renderActivityText(entry.text)) {
            lines.push(`${prefix}${GRAY}💭 ${wrapped}${RESET}`);
          }
        } else {
          lines.push(`${prefix}${GRAY}${entry.type}${RESET}`);
        }
      }
    }

    lines.push(`${GRAY}│${RESET}`);
    const followTag = this.activityFollow ? "" : ` ${YELLOW}[paused]${RESET}`;
    const scrollInfo = this.activityFollow
      ? ""
      : ` ${GRAY}[${start}/${Math.max(0, total - viewport)}]${RESET}`;
    lines.push(
      `${GRAY}│  ${DIM}↑↓ select · Space/f pause · Enter expand · Esc/q back${RESET}${followTag}${scrollInfo}`,
    );
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private formatActivityDetail(): string {
    const entries = this.getActivityEntries();
    const evt = entries[this.activityCursor];
    if (!evt) {
      this.exitActivityDetail();
      return this.formatActivity();
    }
    const ident = this.getActivityMeta()?.identifier ?? this.detailId ?? "?";
    const time = new Date(evt.ts).toISOString().slice(11, 19);
    const lines: string[] = [];
    lines.push(
      `${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${BOLD}Activity${RESET} ${GRAY}·${RESET} ${BOLD}${ident}${RESET} ${GRAY}·${RESET} ${BOLD}full text${RESET}`,
    );
    lines.push(`${GRAY}│${RESET}`);
    this.pushDetailFields(lines, [
      ["Time", time],
      ["Type", evt.type],
      ...(evt.tool !== undefined ? [["Tool", evt.tool] as [string, string]] : []),
      ...(evt.tokens
        ? [
            [
              "Tokens",
              `in ${this.formatCount(evt.tokens.input)} | out ${this.formatCount(evt.tokens.output)} | total ${this.formatCount(evt.tokens.total)}`,
            ] as [string, string],
          ]
        : []),
    ]);
    lines.push(`${GRAY}│${RESET}`);

    const body = this.getActivityDetailBody();
    const viewport = TerminalDashboard.ACTIVITY_VIEWPORT;
    const maxScroll = Math.max(0, body.length - viewport);
    this.activityDetailScroll = Math.max(0, Math.min(maxScroll, this.activityDetailScroll));
    const visible = body.slice(this.activityDetailScroll, this.activityDetailScroll + viewport);
    if (visible.length === 0) visible.push("");
    for (const line of visible) {
      lines.push(`${GRAY}│${RESET} ${line}`);
    }

    lines.push(`${GRAY}│${RESET}`);
    const scrollInfo =
      body.length > viewport ? ` ${GRAY}[${this.activityDetailScroll}/${maxScroll}]${RESET}` : "";
    lines.push(`${GRAY}│  ${DIM}↑↓ scroll · Esc/q back${RESET}${scrollInfo}`);
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private getActivityDetailBody(): string[] {
    const entries = this.getActivityEntries();
    const evt = entries[this.activityCursor];
    if (!evt) return [""];
    if (
      evt.type === "tool_use" &&
      (evt.tool !== undefined ||
        evt.input !== undefined ||
        evt.output !== undefined ||
        evt.exit !== undefined)
    ) {
      return this.buildToolDetailBody(evt);
    }
    if (evt.text === undefined) return [""];
    const width = Math.max(
      20,
      this.terminalWidthFn() - TerminalDashboard.ACTIVITY_DETAIL_WIDTH_PAD,
    );
    return wrapToWidth(evt.text, width);
  }

  private buildToolDetailBody(evt: ActivityEvent): string[] {
    const width = Math.max(
      20,
      this.terminalWidthFn() - TerminalDashboard.ACTIVITY_DETAIL_WIDTH_PAD,
    );
    const lines: string[] = [];
    const failed = evt.exit !== undefined && evt.exit !== 0;
    const statusLabel = evt.status ?? "completed";
    const exitLabel = evt.exit !== undefined ? ` (exit ${evt.exit})` : "";
    const statusLine = `${failed ? "Status: ✗" : "Status:"} ${statusLabel}${exitLabel}`;
    lines.push(failed ? `${YELLOW}${statusLine}${RESET}` : statusLine);
    if (evt.durationMs !== undefined) lines.push(`Duration: ${formatDuration(evt.durationMs)}`);
    if (evt.tool !== undefined) lines.push(`Tool: ${evt.tool}`);
    if (evt.input !== undefined) {
      lines.push("");
      const input = evt.input;
      if (typeof input.command === "string") {
        lines.push("Command:");
        for (const l of wrapToWidth(input.command, width)) lines.push(`  ${l}`);
      } else {
        lines.push("Args:");
        for (const l of wrapToWidth(JSON.stringify(input, null, 2), width)) lines.push(`  ${l}`);
      }
    }
    if (evt.output !== undefined) {
      lines.push("");
      lines.push("Output:");
      const capped = capTailLines(evt.output, DETAIL_OUTPUT_MAX_LINES);
      if (capped.dropped > 0) lines.push(`… (${capped.dropped} more lines)`);
      if (evt.output.trim() === "") {
        lines.push("  (no output)");
      } else {
        for (const l of capped.lines) {
          for (const w of wrapToWidth(l, width)) lines.push(`  ${w}`);
        }
      }
      if (evt.truncated) lines.push("… (opencode truncated)");
    }
    return lines;
  }

  private renderActivityText(text: string): string[] {
    const width = Math.max(20, this.terminalWidthFn() - TerminalDashboard.ACTIVITY_EVENT_WIDTH_PAD);
    const wrapped = wrapToWidth(text, width);
    if (wrapped.length <= 3) return wrapped;
    const shown = wrapped.slice(0, 3);
    const last = shown[2] ?? "";
    shown[2] = truncateToWidth(`${last}…`, width);
    return shown;
  }

  private toolCallSummary(entry: ActivityEvent): string {
    const tool = entry.tool ?? "";
    if (entry.title) return `${tool} · ${entry.title}`;
    if (entry.input) {
      if (typeof entry.input.command === "string") return `${tool} · ${entry.input.command}`;
      if (typeof entry.input.filePath === "string") return `${tool} · ${entry.input.filePath}`;
    }
    return tool;
  }

  private formatConfig(): string {
    const viewport = TerminalDashboard.CONFIG_VIEWPORT;
    const allLines = this.lastConfigView
      ? this.buildConfigLines(this.lastConfigView)
      : [`${GRAY}│  ${DIM}No config available${RESET}`];
    const total = allLines.length;
    const maxStart = Math.max(0, total - viewport);
    this.configScrollOffset = Math.max(0, Math.min(this.configScrollOffset, maxStart));
    const start = this.configScrollOffset;
    const visible = allLines.slice(start, start + viewport);
    const lines = [...visible];
    lines.push(`${GRAY}│${RESET}`);
    lines.push(
      `${GRAY}│  ${DIM}↑↓ scroll · Esc/q back${RESET} ${GRAY}[${start}/${maxStart}]${RESET}`,
    );
    lines.push(`${CYAN}╰──────────────────────────────────────────────────${RESET}`);
    return this.compose(lines);
  }

  private buildConfigLines(view: ConfigView): string[] {
    const lines: string[] = [];
    const r = view.runtime;
    lines.push(`${CYAN}${BOLD}╭─ tasking${RESET} ${GRAY}—${RESET} ${BOLD}Config${RESET}`);
    lines.push(`${GRAY}│${RESET}`);
    lines.push(`│  ${DIM}Workflow:${RESET}       ${r.workflow_path ?? "n/a"}`);
    lines.push(`│  ${DIM}Daemon pid:${RESET}     ${r.pid ?? "n/a"}`);
    if (r.started_at !== null) {
      const uptime = this.formatRuntime((Date.now() - r.started_at) / 1000);
      lines.push(
        `│  ${DIM}Started:${RESET}       ${this.formatDateTime(r.started_at)} (${uptime} ago)`,
      );
    }
    lines.push(`│  ${DIM}Workspace root:${RESET} ${r.workspace_root ?? "n/a"}`);
    lines.push(`│  ${DIM}Log file:${RESET}       ${r.log_path ?? "n/a"}`);
    lines.push(`│  ${DIM}Dashboard:${RESET}     ${r.host ?? "n/a"}:${r.port ?? "n/a"}`);
    lines.push(`${GRAY}│${RESET}`);
    for (const group of CONFIG_SECTIONS) {
      const groupData = view.config[group];
      if (groupData === undefined) continue;
      lines.push(`${CYAN}├─ ${BOLD}${group}${RESET}`);
      for (const [key, value] of Object.entries(groupData as Record<string, unknown>)) {
        lines.push(`│  ${GRAY}${this.pad(`${key}:`, 26)}${RESET} ${this.formatValue(value)}`);
      }
      lines.push(`${GRAY}│${RESET}`);
    }
    return lines;
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return translate("未配置");
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      return value.map((v) => this.formatValue(v)).join(", ");
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return "{}";
      return entries.map(([k, v]) => `${k}=${this.formatValue(v)}`).join("  ");
    }
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
  }

  private formatDateTime(ms: number): string {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  }

  private emptySnapshot(): RuntimeSnapshot {
    return {
      generated_at: Date.now(),
      max_concurrent_agents: 0,
      counts: { running: 0, retrying: 0 },
      running: [],
      retrying: [],
      direct: [],
      totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    };
  }

  private updateSamples(samples: TokenSample[], now: number, total: number): TokenSample[] {
    const updated = [{ timestamp: now, total }, ...samples];
    const minTs = now - GRAPH_WINDOW_MS;
    return updated.filter((s) => s.timestamp >= minTs).slice(0, 1000);
  }

  private computeTps(samples: TokenSample[], now: number, currentTotal: number): number {
    if (samples.length < 2) return 0;
    const first = samples[samples.length - 1];
    if (!first) return 0;
    const elapsedMs = now - first.timestamp;
    if (elapsedMs <= 0) return 0;
    const delta = Math.max(0, currentTotal - first.total);
    return delta / (elapsedMs / 1000);
  }

  private sparkline(samples: TokenSample[], now: number, currentTotal: number): string {
    if (samples.length < 2) return `${GRAY}${DIM}collecting data...${RESET}`;
    const bucketMs = Math.floor(GRAPH_WINDOW_MS / GRAPH_COLUMNS);
    const activeBucket = Math.floor(now / bucketMs) * bucketMs;
    const windowStart = activeBucket - (GRAPH_COLUMNS - 1) * bucketMs;
    const rates: number[] = [];
    for (let i = 0; i < GRAPH_COLUMNS; i++) {
      const bucketStart = windowStart + i * bucketMs;
      const bucketEnd = bucketStart + bucketMs;
      const bucketSamples = [{ timestamp: now, total: currentTotal }, ...samples].filter(
        (s) => s.timestamp >= bucketStart && s.timestamp < bucketEnd,
      );
      if (bucketSamples.length < 2) {
        rates.push(0);
      } else {
        const first = bucketSamples[bucketSamples.length - 1];
        const last = bucketSamples[0];
        if (!first || !last) {
          rates.push(0);
          continue;
        }
        const elapsed = last.timestamp - first.timestamp;
        const delta = Math.max(0, last.total - first.total);
        rates.push(elapsed > 0 ? delta / (elapsed / 1000) : 0);
      }
    }
    const maxRate = Math.max(...rates, 1);
    const allZero = rates.every((r) => r === 0);
    if (allZero) return `${GRAY}${DIM}idle (no tokens consumed)${RESET}`;
    const blocks = rates
      .map((r) => {
        const idx = maxRate <= 0 ? 0 : Math.round((r / maxRate) * (SPARKLINE_BLOCKS.length - 1));
        const block = SPARKLINE_BLOCKS[Math.min(idx, SPARKLINE_BLOCKS.length - 1)] ?? "▁";
        const intensity = idx / (SPARKLINE_BLOCKS.length - 1);
        const color = intensity > 0.6 ? GREEN : intensity > 0.3 ? CYAN : GRAY;
        return `${color}${block}`;
      })
      .join("");
    return `${blocks}${RESET}`;
  }

  private formatRuntime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  }

  private formatCount(value: number): string {
    return value.toLocaleString("en-US");
  }

  private formatTps(value: number): string {
    return Math.trunc(value).toLocaleString("en-US");
  }

  private compactSession(sessionId: string | null): string {
    if (!sessionId) return "n/a";
    if (sessionId.length > 10) {
      return `${sessionId.slice(0, 4)}...${sessionId.slice(-6)}`;
    }
    return sessionId;
  }

  private pad(value: string, width: number): string {
    const v = value.replace(/\n/g, " ").trim();
    if (v.length <= width) return v.padEnd(width);
    return `${v.slice(0, width - 1)}…`;
  }

  private progressBar(current: number, max: number): string {
    const ratio = max > 0 ? current / max : 0;
    const filled = Math.round(ratio * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    const color = ratio >= 0.9 ? RED : ratio >= 0.6 ? YELLOW : GREEN;
    return `${color}${"█".repeat(filled)}${GRAY}${"░".repeat(empty)}${RESET} ${current}/${max}`;
  }
}

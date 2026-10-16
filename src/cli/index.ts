#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { feishuApiBase } from "../adapters/feishu/probe.js";
import { FeishuSource } from "../adapters/feishu/source.js";
import { JiraTracker } from "../adapters/jira/tracker.js";
import { BindingStore } from "../bridge/binding-store.js";
import { CommentBridge } from "../bridge/comment-bridge.js";
import { loadDotenvIfPresent } from "../config/dotenv.js";
import { ConfigManager } from "../config/manager.js";
import { validateStartupConfig } from "../config/validator.js";
import { buildApprovalCard } from "../direct/card.js";
import { DirectSessionManager } from "../direct/manager.js";
import { defaultApiExec } from "../driver/api-client.js";
import { ApprovalCoordinator } from "../driver/approval.js";
import { replyPermission } from "../driver/session-ops.js";
import { collectWorkspaceSessionIds, sweepActiveSessions } from "../driver/sweep.js";
import { ActivityStore } from "../observability/activity-store.js";
import { type ConfigRuntimeInfo, buildConfigView } from "../observability/config-view.js";
import { HttpDashboard } from "../observability/http-dashboard.js";
import { LogRingBuffer } from "../observability/log-buffer.js";
import { ConsoleLogger, type Logger } from "../observability/logger.js";
import { TerminalDashboard } from "../observability/terminal-dashboard.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { TaskingError, toTaskingError } from "../shared/errors.js";
import {
  classifyOpencodeVersion,
  probeOpencodeAuth,
  probeOpencodeService,
  probeOpencodeVersion,
} from "../shared/opencode-version.js";
import { createInitialState } from "../shared/types.js";
import { setLocale, setTranslateWarnLogger, translate } from "../translate/locale.js";
import { runAttempt } from "../worker/runner.js";
import { deleteSession } from "../workspace/manager.js";
import {
  readDaemonInfo,
  removeDaemonInfo,
  resolveTuiTarget,
  writeDaemonInfo,
} from "./daemon-info.js";
import { Daemon } from "./daemon.js";
import { runDoctor } from "./doctor.js";
import { startEventChannel } from "./event-channel.js";
import { TOP_LEVEL_HELP, subcommandHelp } from "./help.js";
import { runInit } from "./init.js";
import { acquireInstanceLock, releaseInstanceLock } from "./instance-lock.js";
import { httpToConfigView, httpToSnapshot } from "./tui-helpers.js";
import { readTaskingVersion } from "./version.js";
import { resolveWorkflowPathOrReport } from "./workflow-path.js";

function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function printUnknownSubcommand(name: string): number {
  console.error(`unknown subcommand: ${name}`);
  console.error(TOP_LEVEL_HELP);
  return 1;
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const subcommand = args[0];

  if (subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(TOP_LEVEL_HELP);
    return 0;
  }

  if (subcommand === "--version" || subcommand === "-v") {
    process.stdout.write(`${readTaskingVersion()}\n`);
    return 0;
  }

  if (subcommand === "help") {
    const target = args[1];
    if (target === undefined || target === "--help" || target === "-h") {
      process.stdout.write(TOP_LEVEL_HELP);
      return 0;
    }
    const help = subcommandHelp(target);
    if (help !== undefined) {
      process.stdout.write(help);
      return 0;
    }
    return printUnknownSubcommand(target);
  }

  if (!subcommand) {
    console.error(TOP_LEVEL_HELP);
    return 1;
  }

  if (wantsHelp(args.slice(1))) {
    const help = subcommandHelp(subcommand);
    if (help !== undefined) {
      process.stdout.write(help);
      return 0;
    }
  }

  switch (subcommand) {
    case "init": {
      const { values: iv, positionals } = parseArgs({
        args: args.slice(1),
        options: {
          force: { type: "boolean" },
          "non-interactive": { type: "boolean" },
          workflow: { type: "string" },
          lang: { type: "string" },
          update: { type: "boolean" },
          restore: { type: "boolean" },
        },
        allowPositionals: true,
      });
      return runInit(process.cwd(), {
        force: iv.force ?? false,
        nonInteractive: iv["non-interactive"] ?? false,
        workflow: iv.workflow ?? undefined,
        lang: iv.lang ?? undefined,
        update: iv.update ?? false,
        restore: iv.restore ?? false,
        workflowPath: positionals[0],
      });
    }
    case "start":
      return runStart(args.slice(1));
    case "status":
      return runStatus(args.slice(1));
    case "logs":
      return runLogs(args.slice(1));
    case "stop":
      return runStop();
    case "tui":
      return runTui(args.slice(1));
    case "doctor": {
      let positionals: string[];
      try {
        ({ positionals } = parseArgs({
          args: args.slice(1),
          options: {},
          allowPositionals: true,
        }));
      } catch {
        console.error("doctor takes no options; usage: tasking doctor [workflow-path]");
        return 1;
      }
      return runDoctor(process.cwd(), process.stdout, {}, positionals[0]);
    }
    default:
      return printUnknownSubcommand(subcommand);
  }
}

async function runStart(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p" },
      tui: { type: "boolean", default: false },
      detach: { type: "boolean", default: false },
      fresh: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.detach && values.tui) {
    console.error("detach and tui are mutually exclusive");
    return 1;
  }

  if (values.detach) {
    const childArgs = process.argv.slice(1).filter((a) => a !== "--detach");
    const child = spawn(process.argv0, childArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.error(`daemon started (pid ${child.pid ?? "unknown"})`);
    return 0;
  }

  const resolvedPath = resolveWorkflowPathOrReport(process.cwd(), positionals[0], (message) =>
    console.error(message),
  );
  if (resolvedPath === null) return 1;
  const workflowPath = resolvedPath.path;

  if (!existsSync(workflowPath)) {
    console.error(`missing workflow file: ${workflowPath}`);
    return 1;
  }

  const ocVersion = probeOpencodeVersion();
  const ocGate = ocVersion === null ? null : classifyOpencodeVersion(ocVersion);
  if (ocVersion === null || ocGate?.hardFail) {
    console.error(
      ocVersion === null
        ? "未在 PATH 找到 opencode（tasking 0.7 需要 opencode >=2.0 <3）——安装见 https://opencode.ai"
        : ocGate?.message,
    );
    return 1;
  }
  if (ocGate?.status === "unvalidated") {
    console.error(ocGate.message);
  }
  {
    const service = probeOpencodeService();
    if (service.status === "unreachable") {
      console.error(
        `opencode 服务已注册但不可达（${service.url ?? ""}）——尝试 opencode service restart；daemon 将尝试自动拉起`,
      );
    }
    const auth = probeOpencodeAuth();
    if (!auth.ok) {
      console.error(
        `opencode 认证探测失败（${auth.detail}）——模型调用将失败，请运行 opencode auth login`,
      );
    }
  }

  loadDotenvIfPresent(dirname(workflowPath));

  const port = values.port ? Number.parseInt(values.port, 10) : undefined;
  const configMgr = ConfigManager.fromFile(workflowPath);
  setLocale(configMgr.current.interface_language);
  setTranslateWarnLogger((message) => logger.warn(message));
  configMgr.onReload((result) => {
    if (!result.error) setLocale(result.config.interface_language);
  });
  const portOverride = port;
  if (portOverride !== undefined) {
    configMgr.current.server.port = portOverride;
  }
  configMgr.onReload((result) => {
    if (portOverride !== undefined && !result.error) {
      result.config.server.port = portOverride;
    }
  });

  const loggingFile = configMgr.current.logging.file;
  const logPath = loggingFile.path
    ? resolve(loggingFile.path)
    : resolve(process.cwd(), "tasking.log");
  const logger = ConsoleLogger.withFileSink(
    {},
    {
      path: logPath,
      maxBytes: loggingFile.max_bytes,
      maxFiles: loggingFile.max_files,
    },
  );
  const logBuffer = new LogRingBuffer(5000);
  logBuffer.setMinLevel("debug");
  logger.addSink((line) => logBuffer.push(line));
  if (values.tui) {
    logger.suppressStderr();
  }

  for (const warning of configMgr.warnings) {
    logger.warn(warning);
  }
  configMgr.onReload((result) => {
    for (const warning of result.warnings) {
      logger.warn(warning);
    }
  });

  const jiraEnabled = configMgr.current.tracker.kind !== "none";
  let tracker: JiraTracker | null = null;
  let scheduler: Scheduler | null = null;
  let activityStore: ActivityStore = new ActivityStore();
  let feishuRef: FeishuSource | null = null;
  let bindingsRef: BindingStore | null = null;
  const sessionIssueIndex = new Map<string, string>();
  const jiraApprovalCards = new Map<
    string,
    { messageId: string; rootId: string; request: import("../driver/approval.js").ApprovalRequest }
  >();
  const jiraApprovals = new ApprovalCoordinator({
    replyPermission: async (sessionId, requestID, decision) => {
      const cfg = configMgr.current;
      await replyPermission(
        defaultApiExec(),
        { command: cfg.opencode.command, serverUrl: cfg.opencode.server_url },
        sessionId,
        requestID,
        decision,
      );
    },
    onCardRequested: (request) => {
      void (async () => {
        const issueId = sessionIssueIndex.get(request.sessionId) ?? null;
        const binding = issueId && bindingsRef ? bindingsRef.getBinding(issueId) : null;
        const replyCard = feishuRef?.replyCardInThread.bind(feishuRef);
        if (!binding || !replyCard) return;
        try {
          const card = buildApprovalCard({
            rootId: binding.root_id,
            turn: 0,
            requestID: request.requestID,
            action: request.action,
            resources: request.resources,
            save: request.save,
            kind: "bridge",
          });
          const res = await replyCard(binding.root_id, card);
          if (res.message_id) {
            jiraApprovalCards.set(request.requestID, {
              messageId: res.message_id,
              rootId: binding.root_id,
              request,
            });
          }
        } catch (e) {
          logger.warn("jira approval card send failed", {
            request_id: request.requestID,
            error: toTaskingError(e).message,
          });
        }
      })();
    },
    onCardResolved: (requestID, state, decision) => {
      void (async () => {
        if (state === "pending") return;
        const entry = jiraApprovalCards.get(requestID);
        if (!entry) return;
        const updateCard = feishuRef?.updateCard?.bind(feishuRef);
        if (!updateCard) return;
        const resolution =
          state === "replied" &&
          (decision === "once" || decision === "always" || decision === "reject")
            ? { state: "replied" as const, decision }
            : { state: state as "expired" | "cancelled" | "external" };
        try {
          await updateCard(
            entry.messageId,
            buildApprovalCard(
              {
                rootId: entry.rootId,
                turn: 0,
                requestID,
                action: entry.request.action,
                resources: entry.request.resources,
                save: entry.request.save,
              },
              resolution,
            ),
          );
        } catch (e) {
          logger.warn("jira approval card stamp failed", {
            request_id: requestID,
            error: toTaskingError(e).message,
          });
        }
      })();
    },
  });
  if (jiraEnabled) {
    tracker = new JiraTracker(configMgr.current.tracker);
    scheduler = new Scheduler({
      tracker,
      config: () => configMgr.current,
      logger,
      runAttemptFn: runAttempt,
      approvalEvents: (task, event) => {
        if (event.kind === "expired") {
          jiraApprovals.markExpired(event.requestID);
          return;
        }
        const bySession = new Map<string, typeof event.pending>();
        for (const p of event.pending) {
          sessionIssueIndex.set(p.sessionID, task.id);
          const list = bySession.get(p.sessionID) ?? [];
          list.push(p);
          bySession.set(p.sessionID, list);
        }
        for (const [sessionId, pending] of bySession) {
          jiraApprovals.ingest(sessionId, pending);
        }
      },
    });
    activityStore = scheduler.activityStore;
  }

  const trackerlessState = createInitialState(
    configMgr.current.polling.interval_ms,
    configMgr.current.agent.max_concurrent_agents,
  );
  const runtimeState = () => (scheduler !== null ? scheduler.state : trackerlessState);
  const requestRefreshFn = () => scheduler?.requestRefresh() ?? false;

  const sweepIds = new Set(collectWorkspaceSessionIds(configMgr.current.workspace.root));
  if (configMgr.current.feishu.enabled) {
    const sweepStore = new BindingStore(join(configMgr.current.workspace.root, "bindings.db"));
    try {
      for (const s of sweepStore.listDirectSessionsByStatus("running")) {
        if (s.session_id) sweepIds.add(s.session_id);
      }
    } finally {
      sweepStore.close();
    }
  }
  if (sweepIds.size > 0) {
    await sweepActiveSessions({
      exec: defaultApiExec(),
      base: {
        command: configMgr.current.opencode.command,
        serverUrl: configMgr.current.opencode.server_url,
      },
      sessionIds: [...sweepIds],
      logger,
    });
  }

  const daemon = new Daemon({
    configManager: configMgr,
    logger,
    onTick: async () => {
      if (scheduler !== null) {
        await scheduler.tick();
      }
    },
  });

  const code = await daemon.start();
  if (code !== 0) {
    if (values.tui) {
      const result = validateStartupConfig(configMgr.current);
      process.stdout.write(translate("\n  tasking 启动校验失败:\n"));
      for (const e of result.errors) {
        process.stdout.write(`    - ${translate(e.message)}\n`);
      }
      process.stdout.write(translate("  (详见 tasking.log)\n\n"));
    }
    return code;
  }

  let bridge: CommentBridge | null = null;
  let bindings: BindingStore | null = null;
  let directManager: DirectSessionManager | null = null;
  let eventChannel: ReturnType<typeof startEventChannel> = null;
  if (configMgr.current.feishu.enabled) {
    const feishuCfg = configMgr.current.feishu;
    const lock = acquireInstanceLock(
      feishuCfg.app_id ?? "",
      feishuCfg.intake_chat_id ?? "",
      workflowPath,
    );
    if (!lock.ok) {
      const held = lock.heldBy;
      process.stdout.write(
        translate(`
  tasking 启动失败：同一飞书应用/群已有实例在运行（pid ${held?.pid ?? "?"}，workflow: ${held?.workflow_path ?? "?"}）。
  飞书事件为集群路由，双实例会互相抢消息、重复建话题。
  请先 tasking stop 旧实例，或更换 app_id/intake_chat_id。

`),
      );
      logger.error("instance lock held by another live daemon", {
        held_pid: held?.pid,
        held_workflow: held?.workflow_path,
      });
      await daemon.stop();
      return 1;
    }
    const feishu = new FeishuSource(configMgr.current.feishu, logger);
    feishuRef = feishu;
    logger.info("feishu api base", {
      edition: configMgr.current.feishu.edition,
      base: feishuApiBase(configMgr.current.feishu.edition),
    });
    bindings = new BindingStore(join(configMgr.current.workspace.root, "bindings.db"));
    bindingsRef = bindings;
    if (configMgr.current.feishu.direct.enabled) {
      directManager = new DirectSessionManager({
        feishu,
        store: bindings,
        config: () => configMgr.current,
        logger,
        activity: (key, evt) => activityStore.record(key, evt),
        clearActivity: (key) => activityStore.clear(key),
        deleteSession: (sid) => deleteSession(sid, logger),
      });
      await directManager.recover();
      directManager.start();
      logger.info("direct session manager ready", {
        projects: Object.keys(configMgr.current.feishu.direct.projects).length,
      });
    }
    bridge = new CommentBridge({
      tracker,
      feishu,
      bindings,
      config: () => configMgr.current,
      logger,
      requestRefresh: requestRefreshFn,
      scheduler: scheduler ?? undefined,
      direct: directManager ?? undefined,
      approvals: {
        reply: (requestID, decision) => jiraApprovals.reply(requestID, decision),
      },
    });
    if (values.fresh) {
      const reconciled = await bridge.freshStartReset();
      logger.info(
        reconciled
          ? "feishu bridge started in fresh mode (intake cursor cleared, bindings reconciled)"
          : "feishu bridge started in fresh mode (intake cursor cleared; binding reconcile skipped)",
      );
    }
    bridge.start();
    eventChannel = startEventChannel({
      config: configMgr.current,
      bridge,
      direct: directManager ?? undefined,
      logger,
    });
    logger.info("feishu comment bridge ready");
  } else if (values.fresh) {
    process.stdout.write(
      translate("\n  --fresh 仅在 feishu.enabled 时生效（飞书桥未启用，忽略该选项）。\n\n"),
    );
  }

  if (scheduler !== null) {
    logger.info("starting terminal workspace cleanup");
    await scheduler.startupTerminalCleanup();
  }

  const effectivePort = port ?? configMgr.current.server.port ?? undefined;
  let dashboard: HttpDashboard | null = null;
  let dashboardUrl: string | null = null;
  let actualPort: number | null = null;
  const startedAt = Date.now();
  const runtimeInfo = (): ConfigRuntimeInfo => ({
    pid: process.pid,
    started_at: startedAt,
    workflow_path: workflowPath,
    workspace_root: configMgr.current.workspace.root,
    log_path: logPath,
    host: configMgr.current.server.host,
    port: actualPort,
  });
  const configView = () => buildConfigView(configMgr.current, runtimeInfo());
  if (effectivePort !== undefined) {
    dashboard = new HttpDashboard({
      port: effectivePort,
      host: configMgr.current.server.host,
      state: runtimeState,
      logger,
      requestRefresh: requestRefreshFn,
      configView,
      logBuffer,
      activityStore,
      directSessions: () => directManager?.listActive() ?? [],
      directTotals: () =>
        directManager?.aggregateTotals() ?? {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
    });
    actualPort = await dashboard.start();
    const host = configMgr.current.server.host;
    const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    dashboardUrl = `http://${displayHost}:${actualPort}`;
    logger.info("http dashboard ready", { url: dashboardUrl });
    if (!values.tui) {
      console.error(`\n  ➜  Dashboard:  ${dashboardUrl}\n`);
    }
  }

  writeDaemonInfo({
    pid: process.pid,
    port: actualPort,
    host: configMgr.current.server.host,
    started_at: startedAt,
    workflow_path: workflowPath,
    log_path: logPath,
  });

  let tui: TerminalDashboard | null = null;
  if (values.tui) {
    tui = new TerminalDashboard({
      state: runtimeState,
      logger,
      dashboardUrl,
      logBuffer,
      configView,
      activityStore,
      directSessions: () => directManager?.listActive() ?? [],
      directTotals: () =>
        directManager?.aggregateTotals() ?? {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
    });
    tui.start(1000);
  }

  const shutdown = async (sig: string) => {
    logger.info("received signal, shutting down", { signal: sig });
    if (scheduler !== null) scheduler.stop();
    if (bridge) bridge.stop();
    if (directManager) {
      directManager.stop();
      await Promise.race([
        directManager.whenIdle(),
        new Promise((resolve) => {
          const t = setTimeout(resolve, 5000);
          t.unref?.();
        }),
      ]);
    }
    eventChannel?.stop();
    releaseInstanceLock(
      configMgr.current.feishu.app_id ?? "",
      configMgr.current.feishu.intake_chat_id ?? "",
    );
    if (bindings) bindings.close();
    if (tui) tui.stop();
    if (dashboard) await dashboard.stop();
    await daemon.stop();
    removeDaemonInfo();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  return new Promise<number>(() => {
    // daemon runs until signal; resolves via process.exit
  });
}

async function runStatus(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const info = readDaemonInfo();
  if (!info) {
    console.error("daemon is not running");
    return 1;
  }

  try {
    process.kill(info.pid, 0);
  } catch {
    removeDaemonInfo();
    console.error("daemon is not running (stale metadata cleaned up)");
    return 1;
  }

  if (info.port === null) {
    console.log(`daemon running (pid ${info.pid}), HTTP dashboard not configured`);
    return 0;
  }

  const host = info.host ?? "127.0.0.1";
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${displayHost}:${info.port}/api/v1/state`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`daemon query failed: HTTP ${res.status}`);
      return 1;
    }
    data = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error(`daemon query failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return 0;
  }

  console.log(formatStatus(data, info.pid, `http://${displayHost}:${info.port}`));
  return 0;
}

function formatStatus(data: Record<string, unknown>, pid: number, baseUrl: string): string {
  const lines: string[] = [];
  lines.push(`Tasking Daemon (pid ${pid}, ${baseUrl})`);
  lines.push("");

  const counts = data.counts as { running: number; retrying: number } | undefined;
  const runningCount = counts?.running ?? 0;
  const retryCount = counts?.retrying ?? 0;

  lines.push(`Running: ${runningCount}`);
  if (runningCount > 0) {
    const running = (data.running as Array<Record<string, unknown>>) ?? [];
    for (const entry of running) {
      const id = String(entry.task_identifier ?? "");
      const state = String(entry.state ?? "");
      const turn = Number(entry.turn_count ?? 0);
      const startedAt = entry.started_at;
      const elapsed = typeof startedAt === "string" ? formatElapsed(startedAt) : "?";
      const tokens = entry.tokens as
        | { input_tokens: number; output_tokens: number; total_tokens: number }
        | undefined;
      const inT = tokens ? formatK(tokens.input_tokens) : "?";
      const outT = tokens ? formatK(tokens.output_tokens) : "?";
      lines.push(
        `  ${id.padEnd(12)} [${state}]  turn ${turn}  elapsed ${elapsed}  in:${inT}  out:${outT}`,
      );
    }
  }

  lines.push("");
  lines.push(`Retrying: ${retryCount}`);
  if (retryCount > 0) {
    const retrying = (data.retrying as Array<Record<string, unknown>>) ?? [];
    for (const entry of retrying) {
      const id = String(entry.task_identifier ?? "");
      const attempt = Number(entry.attempt ?? 0);
      const dueAt = entry.due_at;
      const dueIn = typeof dueAt === "string" ? formatDueIn(dueAt) : "?";
      const error = entry.error ? `  error: ${String(entry.error).slice(0, 60)}` : "";
      lines.push(`  ${id.padEnd(12)} attempt ${attempt}  due in ${dueIn}${error}`);
    }
  }

  const totals = (data.codex_totals ?? data.totals) as
    | { input_tokens: number; output_tokens: number; total_tokens: number; seconds_running: number }
    | undefined;
  if (totals) {
    lines.push("");
    lines.push(
      `Totals:  in:${formatK(totals.input_tokens)}  out:${formatK(totals.output_tokens)}  total:${formatK(totals.total_tokens)}  uptime: ${formatRuntime(totals.seconds_running)}`,
    );
  }

  return lines.join("\n");
}

function formatElapsed(isoStarted: string): string {
  const ms = Date.parse(isoStarted);
  if (Number.isNaN(ms)) return "?";
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  return formatRuntime(seconds);
}

function formatDueIn(isoDue: string): string {
  const ms = Date.parse(isoDue);
  if (Number.isNaN(ms)) return "?";
  const seconds = Math.max(0, (ms - Date.now()) / 1000);
  return formatRuntime(seconds);
}

function formatRuntime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function formatK(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

async function runLogs(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      lines: { type: "string", short: "n" },
      follow: { type: "boolean", default: false, short: "f" },
      level: { type: "string" },
    },
    allowPositionals: true,
  });

  const info = readDaemonInfo();
  const logFile = info?.log_path ?? resolve(process.cwd(), "tasking.log");
  if (!existsSync(logFile)) {
    console.error("no logs found");
    return 1;
  }

  const n = values.lines ? Number.parseInt(values.lines, 10) : 100;
  const level = values.level;
  const follow = values.follow;

  const content = readFileSync(logFile, "utf8");
  const allLines = content.split("\n");
  const lastN = allLines.slice(-n);
  const filtered = level ? lastN.filter((l) => passesLevelFilter(l, level)) : lastN;
  for (const line of filtered) {
    if (line) console.log(line);
  }

  if (!follow) return 0;

  let offset = statSync(logFile).size;
  let remainder = "";
  let fd = openSync(logFile, "r");
  const buf = Buffer.alloc(65536);
  const interval = setInterval(() => {
    try {
      let size = fstatSync(fd).size;
      if (size < offset) {
        closeSync(fd);
        fd = openSync(logFile, "r");
        offset = 0;
        remainder = "";
        size = fstatSync(fd).size;
      }
      if (size > offset) {
        const want = Math.min(buf.length, size - offset);
        const bytesRead = readSync(fd, buf, 0, want, offset);
        offset += bytesRead;
        remainder += buf.subarray(0, bytesRead).toString("utf8");
        const lines = remainder.split("\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          if (!level || passesLevelFilter(line, level)) {
            console.log(line);
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }, 500);

  return new Promise<number>((resolve) => {
    process.on("SIGINT", () => {
      clearInterval(interval);
      closeSync(fd);
      resolve(0);
    });
  });
}

function passesLevelFilter(line: string, level: string): boolean {
  try {
    const parsed = JSON.parse(line) as { level?: string };
    if (parsed && typeof parsed.level === "string") {
      return parsed.level === level;
    }
  } catch {
    // non-JSON, always pass
  }
  return true;
}

async function runStop(): Promise<number> {
  const info = readDaemonInfo();
  if (!info) {
    console.error("daemon is not running");
    return 1;
  }

  try {
    process.kill(info.pid, 0);
  } catch {
    removeDaemonInfo();
    console.error("daemon is not running (stale metadata cleaned up)");
    return 1;
  }

  process.kill(info.pid, "SIGTERM");
  console.error(`stopping daemon (pid ${info.pid})...`);

  const timeoutMs = 10000;
  const pollMs = 200;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    try {
      process.kill(info.pid, 0);
    } catch {
      removeDaemonInfo();
      console.error("daemon stopped");
      return 0;
    }
  }

  process.kill(info.pid, "SIGKILL");
  removeDaemonInfo();
  console.error("daemon force killed");
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTui(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p" },
    },
    allowPositionals: true,
  });
  const portRaw = values.port;
  const portOverride = portRaw !== undefined ? Number.parseInt(portRaw, 10) : undefined;
  if (portRaw !== undefined && (!/^\d+$/.test(portRaw.trim()) || Number.isNaN(portOverride))) {
    console.error(`invalid port: ${portRaw}`);
    return 1;
  }

  const info = readDaemonInfo();
  const { host, port } = resolveTuiTarget(portOverride, info);

  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${displayHost}:${port}/api/v1/state`;
  const dashboardUrl = `http://${displayHost}:${port}`;

  try {
    const probe = await fetch(url);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (e) {
    console.error(
      `cannot reach dashboard at ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
    console.error(`resolved port ${port} (--port <n> to override)`);
    return 1;
  }

  const logger = new ConsoleLogger();
  logger.suppressStderr();

  const logBuffer = new LogRingBuffer(5000);
  logBuffer.setMinLevel("debug");
  const logsUrl = `http://${displayHost}:${port}/api/v1/logs?lines=500`;
  const seenLogs = new Set<string>();
  const fetchLogs = async (): Promise<void> => {
    try {
      const res = await fetch(logsUrl);
      if (!res.ok) return;
      const json = (await res.json()) as {
        logs?: Array<{ ts: string; level: string; msg: string }>;
      };
      for (const entry of json.logs ?? []) {
        const level =
          entry.level === "debug" ||
          entry.level === "info" ||
          entry.level === "warn" ||
          entry.level === "error"
            ? entry.level
            : "info";
        const key = `${entry.ts}:${level}:${entry.msg}`;
        if (seenLogs.has(key)) continue;
        seenLogs.add(key);
        logBuffer.pushEntry({ ts: entry.ts, level, msg: entry.msg, fields: {} });
      }
    } catch {
      // dashboard temporarily unavailable; retry next tick
    }
  };
  void fetchLogs();
  const logsTimer = setInterval(() => void fetchLogs(), 1000);

  const tui = new TerminalDashboard({
    fetchSnapshot: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      return httpToSnapshot(json);
    },
    fetchConfig: async () => {
      const res = await fetch(`http://${displayHost}:${port}/api/v1/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      return httpToConfigView(json);
    },
    fetchActivity: async (taskId: string) => {
      const res = await fetch(
        `http://${displayHost}:${port}/api/v1/${encodeURIComponent(taskId)}/activity?limit=500`,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { activity?: Array<Record<string, unknown>> };
      return (json.activity ?? []) as never;
    },
    logger,
    dashboardUrl,
    logBuffer,
  });

  tui.start(1000);

  const quit = () => {
    tui.stop();
    clearInterval(logsTimer);
    process.exit(0);
  };
  process.on("SIGINT", quit);

  return new Promise<number>(() => {
    // blocks until SIGINT or q
  });
}

function isEntryScript(argv: string[]): boolean {
  const invoked = argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(invoked) === fileURLToPath(import.meta.url);
  }
}

if (isEntryScript(process.argv)) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((e) => {
      const err = e instanceof TaskingError ? e : new TaskingError("unknown", String(e));
      console.error(JSON.stringify({ level: "error", msg: err.message, category: err.category }));
      process.exit(1);
    });
}

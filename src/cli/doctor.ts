import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Writable } from "node:stream";
import {
  type ProbeItem,
  probeListChats,
  probeListMessages,
  probeTail,
} from "../adapters/feishu/probe.js";
import { fetchTenantTokenFor } from "../adapters/feishu/source.js";
import { JiraTracker } from "../adapters/jira/tracker.js";
import type { FeishuConfig, TrackerConfig } from "../config/config-types.js";
import { loadDotenvIfPresent } from "../config/dotenv.js";
import { ConfigManager } from "../config/manager.js";
import type { OpencodeModelsProbe } from "../driver/opencode-models.js";
import { probeOpencodeModels } from "../driver/opencode-models.js";
import { formatResolvedModel } from "../driver/session-ops.js";
import { getMcpServerScriptPath } from "../mcp/inject.js";
import {
  type OpencodeAuthProbe,
  type OpencodeServiceProbe,
  classifyOpencodeVersion,
  probeOpencodeAuth,
  probeOpencodeService,
  probeOpencodeVersion,
} from "../shared/opencode-version.js";
import { setLocale, translate } from "../translate/locale.js";
import { readTaskingVersion } from "./version.js";
import { resolveWorkflowPathOrReport } from "./workflow-path.js";

type DoctorStatus = "pass" | "fail" | "skip" | "info" | "warn";

interface DoctorItem {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorDeps {
  fetchImpl?: typeof fetch;
  opencodeVersion?: () => string | null;
  opencodeService?: () => OpencodeServiceProbe;
  opencodeAuth?: () => OpencodeAuthProbe;
  opencodeModels?: () => Promise<OpencodeModelsProbe>;
  mcpScriptPath?: () => string;
}

const ICONS: Record<DoctorStatus, string> = {
  pass: "✓",
  fail: "✗",
  skip: "−",
  info: "·",
  warn: "⚠",
};

function modelResolutionItem(
  configured: string | null,
  probe: OpencodeModelsProbe,
  command: string,
): DoctorItem {
  const listHint = translate(`完整列表可跑 ${command} api model.list`);
  if (probe.status === "unreachable") {
    return {
      name: "模型解析",
      status: "info",
      detail: `探测不可达（${probe.error ?? translate("未知原因")}），跳过；${listHint}`,
    };
  }
  if (configured !== null) {
    if (probe.available === undefined) {
      return {
        name: "模型解析",
        status: "info",
        detail: `已配置 ${configured}，可用列表探测失败，跳过校验；${listHint}`,
      };
    }
    const inList = probe.available.some((m) =>
      configured.includes("/") ? `${m.providerID}/${m.id}` === configured : m.id === configured,
    );
    if (inList) {
      return { name: "模型解析", status: "pass", detail: `已配置 ${configured}（在可用模型列表）` };
    }
    return {
      name: "模型解析",
      status: "fail",
      detail: `已配置 ${configured}，但不在可用模型列表——任务将在此模型上失败；${listHint}`,
    };
  }
  const resolved = probe.defaultModel ? formatResolvedModel(probe.defaultModel) : null;
  return {
    name: "模型解析",
    status: "warn",
    detail: resolved
      ? `未配置——服务端当前解析为 ${resolved}（随目录更新可能变化）；${listHint}`
      : `未配置且服务端未解析出默认模型；${listHint}`,
  };
}

function probeToItem(prefix: string, item: ProbeItem): DoctorItem {
  const status: DoctorStatus =
    item.status === "ok" ? "pass" : item.status === "missing" ? "fail" : "info";
  const detail = item.status === "ok" ? item.scope : (item.hint ?? item.scope);
  return { name: `${prefix}·${item.label}`, status, detail };
}

export async function runDoctor(
  cwd: string,
  output: Writable,
  deps: DoctorDeps = {},
  workflowPath?: string,
): Promise<number> {
  output.write(`tasking ${readTaskingVersion()}\n`);
  const opencodeVersion = deps.opencodeVersion ?? probeOpencodeVersion;
  const items: DoctorItem[] = [];
  let modelTarget: { configured: string | null; command: string; root: string } | undefined;

  const resolvedPath = resolveWorkflowPathOrReport(cwd, workflowPath, (message) =>
    output.write(`${message}\n`),
  );
  if (resolvedPath === null) return 1;
  const wfPath = resolvedPath.path;
  const wfLabel = resolvedPath.name;

  if (!existsSync(wfPath)) {
    items.push({
      name: wfLabel,
      status: "fail",
      detail: `未找到（${wfPath}）——先运行 tasking init`,
    });
  } else {
    let feishu: FeishuConfig | null = null;
    let tracker: TrackerConfig | null = null;
    try {
      loadDotenvIfPresent(dirname(wfPath));
      const cfg = ConfigManager.fromFile(wfPath).current;
      setLocale(cfg.interface_language);
      modelTarget = {
        configured: cfg.opencode.model ?? null,
        command: cfg.opencode.command,
        root: cfg.workspace.root,
      };
      items.push({
        name: wfLabel,
        status: "pass",
        detail: `解析成功（tracker: ${cfg.tracker.kind}）`,
      });
      if (cfg.feishu.enabled) {
        feishu = cfg.feishu;
      } else {
        items.push({ name: "飞书", status: "skip", detail: "未启用（feishu.enabled: false）" });
      }
      if (cfg.tracker.kind === "jira") {
        tracker = cfg.tracker;
      } else {
        items.push({ name: "Jira", status: "skip", detail: "未配置（tracker.kind 非 jira）" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      items.push({ name: wfLabel, status: "fail", detail: `解析失败：${msg}` });
      items.push({ name: "飞书", status: "skip", detail: "配置解析失败，跳过" });
      items.push({ name: "Jira", status: "skip", detail: "配置解析失败，跳过" });
    }

    if (feishu) {
      const appId = feishu.app_id ?? "";
      const tokenResult = await fetchTenantTokenFor(
        appId,
        feishu.app_secret ?? "",
        deps.fetchImpl,
        feishu.edition,
      );
      if (!tokenResult.ok) {
        items.push({ name: "飞书凭据", status: "fail", detail: tokenResult.reason });
      } else {
        items.push({ name: "飞书凭据", status: "pass", detail: appId });
        const { item: chatsItem, chats } = await probeListChats(
          tokenResult.token,
          deps.fetchImpl,
          appId,
          feishu.edition,
        );
        items.push(probeToItem("飞书", chatsItem));
        if (feishu.intake_chat_id) {
          if (chats === null) {
            items.push({
              name: "intake 群可达",
              status: "info",
              detail: "列群探针未通过，无法核验 intake 群（先解决上方 ✗ 项）",
            });
          } else if (chats.some((c) => c.chat_id === feishu.intake_chat_id)) {
            items.push({
              name: "intake 群可达",
              status: "pass",
              detail: feishu.intake_chat_id,
            });
          } else {
            items.push({
              name: "intake 群可达",
              status: "fail",
              detail: `机器人所在群列表不含 ${feishu.intake_chat_id}——确认机器人已入群（或 intake_chat_id 是否正确）`,
            });
          }
          if (chats !== null) {
            items.push(
              probeToItem(
                "飞书",
                await probeListMessages(
                  tokenResult.token,
                  feishu.intake_chat_id,
                  deps.fetchImpl,
                  appId,
                  feishu.edition,
                ),
              ),
            );
          }
        } else {
          items.push({ name: "intake 群可达", status: "fail", detail: "intake_chat_id 未配置" });
        }
        for (const item of await probeTail(
          tokenResult.token,
          appId,
          null,
          deps.fetchImpl,
          feishu.edition,
        )) {
          items.push(probeToItem("飞书", item));
        }
      }
    }

    if (tracker) {
      const mcpScript = deps.mcpScriptPath?.() ?? getMcpServerScriptPath();
      if (existsSync(mcpScript)) {
        items.push({ name: "Jira MCP 脚本", status: "pass", detail: mcpScript });
      } else {
        items.push({
          name: "Jira MCP 脚本",
          status: "fail",
          detail: `未找到（${mcpScript}）——agent 无法使用 Jira MCP 工具；先 npm run build`,
        });
      }
      try {
        const jira = new JiraTracker(tracker, deps.fetchImpl);
        const info = await jira.fetchServerInfo({ timeoutMs: 5000 });
        const version = typeof info.version === "string" ? info.version : "unknown";
        items.push({ name: "Jira 连接", status: "pass", detail: `连接成功（v${version}）` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        items.push({ name: "Jira 连接", status: "fail", detail: msg });
      }
    }
  }

  const ocVersion = opencodeVersion();
  if (ocVersion === null) {
    items.push({
      name: "opencode",
      status: "fail",
      detail: "未在 PATH 找到 opencode——安装见 https://opencode.ai",
    });
  } else {
    const gate = classifyOpencodeVersion(ocVersion);
    items.push({
      name: "opencode 版本",
      status: gate.hardFail ? "fail" : "pass",
      detail: gate.message ?? `在 PATH（${gate.normalized ?? ocVersion}）`,
    });
    if (!gate.hardFail) {
      const service = (deps.opencodeService ?? probeOpencodeService)();
      if (service.status === "running") {
        items.push({ name: "opencode 服务", status: "pass", detail: service.url ?? "" });
      } else if (service.status === "unreachable") {
        items.push({
          name: "opencode 服务",
          status: "fail",
          detail: `服务已注册但不可达（${service.url ?? ""}）——尝试 opencode service restart`,
        });
      } else {
        items.push({
          name: "opencode 服务",
          status: "info",
          detail: "后台服务未运行——daemon 启动时会自动拉起",
        });
      }
      const auth = (deps.opencodeAuth ?? probeOpencodeAuth)();
      items.push({
        name: "opencode 认证",
        status: auth.ok ? "pass" : "fail",
        detail: auth.ok ? auth.detail : `${auth.detail}——模型调用将失败`,
      });
      if (modelTarget !== undefined) {
        const target = modelTarget;
        const probe = await (
          deps.opencodeModels ?? (() => probeOpencodeModels(target.command, target.root ?? cwd))
        )();
        items.push(modelResolutionItem(target.configured, probe, target.command));
      }
    }
  }

  output.write(translate("tasking doctor — 全链路只读体检\n\n"));
  for (const item of items) {
    output.write(
      `${ICONS[item.status]} ${translate(item.name)}${translate("：")}${translate(item.detail)}\n`,
    );
  }
  const passed = items.filter((i) => i.status === "pass").length;
  const failed = items.filter((i) => i.status === "fail").length;
  const warned = items.filter((i) => i.status === "warn").length;
  const skipped = items.filter((i) => i.status === "skip").length;
  const summary = translate(
    `汇总: ${passed} 通过 / ${failed} 失败 / ${warned} 警告 / ${skipped} 跳过`,
  );
  output.write(`\n${summary}\n`);
  return failed > 0 ? 1 : 0;
}

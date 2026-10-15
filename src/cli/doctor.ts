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
import {
  type OpencodeAuthProbe,
  type OpencodeServiceProbe,
  classifyOpencodeVersion,
} from "../shared/opencode-version.js";
import { setLocale, translate } from "../translate/locale.js";
import { readTaskingVersion } from "./version.js";
import { resolveWorkflowPathOrReport } from "./workflow-path.js";

type DoctorStatus = "pass" | "fail" | "skip" | "info";

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
}

const ICONS: Record<DoctorStatus, string> = {
  pass: "✓",
  fail: "✗",
  skip: "−",
  info: "·",
};

function defaultOpencodeVersion(): string | null {
  try {
    const res = spawnSync("opencode", ["--version"], { timeout: 5000, encoding: "utf8" });
    if (res.status !== 0 || res.error !== undefined) return null;
    const text = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    return text === "" ? "unknown" : (text.split("\n")[0] ?? "unknown");
  } catch {
    return null;
  }
}

function defaultOpencodeService(): OpencodeServiceProbe {
  try {
    const st = spawnSync("opencode", ["service", "status"], { timeout: 5000, encoding: "utf8" });
    const text = `${st.stdout ?? ""}${st.stderr ?? ""}`.trim();
    const urlMatch = text.match(/https?:\/\/\S+/);
    if (!urlMatch) return { status: "stopped" };
    const url = urlMatch[0] ?? "";
    const info = spawnSync("opencode", ["api", "server.info"], { timeout: 8000, encoding: "utf8" });
    const ok = info.status === 0 && `${info.stdout ?? ""}`.includes('"version"');
    return ok ? { status: "running", url } : { status: "unreachable", url };
  } catch {
    return { status: "stopped" };
  }
}

function defaultOpencodeAuth(): OpencodeAuthProbe {
  try {
    const res = spawnSync("opencode", ["auth", "list"], { timeout: 8000, encoding: "utf8" });
    if (res.status !== 0) {
      const err = `${res.stderr ?? ""}`.trim();
      return {
        ok: false,
        detail: err === "" ? "opencode auth list 失败" : (err.split("\n")[0] ?? ""),
      };
    }
    const text = `${res.stdout ?? ""}`.trim();
    if (text === "") return { ok: false, detail: "无已认证 provider（opencode auth login）" };
    return { ok: true, detail: text.split("\n")[0] ?? "" };
  } catch {
    return { ok: false, detail: "opencode 认证探测失败" };
  }
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
  const opencodeVersion = deps.opencodeVersion ?? defaultOpencodeVersion;
  const items: DoctorItem[] = [];

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
      const service = (deps.opencodeService ?? defaultOpencodeService)();
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
      const auth = (deps.opencodeAuth ?? defaultOpencodeAuth)();
      items.push({
        name: "opencode 认证",
        status: auth.ok ? "pass" : "fail",
        detail: auth.ok ? auth.detail : `${auth.detail}——模型调用将失败`,
      });
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
  const skipped = items.filter((i) => i.status === "skip").length;
  const summary = translate(`汇总: ${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`);
  output.write(`\n${summary}\n`);
  return failed > 0 ? 1 : 0;
}

import type { FeishuEdition } from "../../config/config-types.js";
import { translate } from "../../translate/locale.js";

export type ProbeStatus = "ok" | "missing" | "unknown" | "unprobed";

export interface ProbeItem {
  scope: string;
  label: string;
  status: ProbeStatus;
  hint: string | null;
}

export interface ConsoleLinks {
  app: string;
  permission: string;
  event: string;
  version: string;
}

export function feishuApiBase(edition: FeishuEdition): string {
  return edition === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

export function crossRegionHint(edition: FeishuEdition): string {
  if (edition === "lark") {
    return translate(
      "若应用创建于另一版飞书（国内版），请在 WORKFLOW.md 设置 feishu.edition: feishu",
    );
  }
  return translate(
    "若应用创建于另一版飞书（海外版 Lark），请在 WORKFLOW.md 设置 feishu.edition: lark",
  );
}

export function consoleLinks(appId: string, edition: FeishuEdition = "feishu"): ConsoleLinks {
  const app = `${feishuApiBase(edition)}/app/${appId}`;
  return {
    app,
    permission: `${app}/safe/permission`,
    event: `${app}/event`,
    version: `${app}/version`,
  };
}

export function feishuBodyCode(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as { code?: unknown };
    return typeof parsed.code === "number" ? parsed.code : null;
  } catch {
    return null;
  }
}

const SCOPE_ERROR_CODES = new Set([230027, 99991672]);

function permissionHint(
  appId: string | undefined,
  scope: string,
  what: string,
  edition: FeishuEdition,
): string {
  const base = `缺 ${scope}（${what}）`;
  if (!appId) return `${base} → 开发者后台「权限管理」搜索 "${scope}" 开通后重新发布版本`;
  return `${base} → 开通: ${consoleLinks(appId, edition).permission} （搜索 "${scope}"，开通后需重新发布版本）`;
}

function probeFailure(
  status: number,
  bodyCode: number | null,
  appId: string | undefined,
  scope: string,
  what: string,
  edition: FeishuEdition,
): { status: ProbeStatus; hint: string | null } {
  if (bodyCode !== null && SCOPE_ERROR_CODES.has(bodyCode)) {
    return { status: "missing", hint: permissionHint(appId, scope, what, edition) };
  }
  if (status === 403) {
    return { status: "missing", hint: permissionHint(appId, scope, what, edition) };
  }
  if (status === 401) {
    return { status: "unknown", hint: "HTTP 401，凭据或 token 可能不正确" };
  }
  return {
    status: "unknown",
    hint: `HTTP ${status}，无法归因到具体权限`,
  };
}

function networkFailure(scope: string, label: string): ProbeItem {
  return { scope, label, status: "unknown", hint: "网络不可达，无法检测" };
}

function okItem(scope: string, label: string): ProbeItem {
  return { scope, label, status: "ok", hint: null };
}

async function fetchAndRead(
  f: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ status: number; ok: boolean; bodyCode: number | null; raw: string }> {
  const res = await f(url, init);
  const raw = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, bodyCode: feishuBodyCode(raw), raw };
}

export async function probeListChats(
  token: string,
  fetchImpl?: typeof fetch,
  appId?: string,
  edition: FeishuEdition = "feishu",
): Promise<{ item: ProbeItem; chats: Array<{ chat_id: string; name: string }> | null }> {
  const f = fetchImpl ?? fetch;
  const scope = "im:chat";
  const label = "列群";
  try {
    const { status, ok, bodyCode, raw } = await fetchAndRead(
      f,
      `${feishuApiBase(edition)}/open-apis/im/v1/chats?page_size=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const bad = bodyCode !== null && SCOPE_ERROR_CODES.has(bodyCode);
    if (!ok || bad) {
      return {
        item: {
          scope,
          label,
          ...probeFailure(status, bodyCode, appId, scope, label, edition),
        },
        chats: null,
      };
    }
    let parsed: {
      code?: unknown;
      data?: { items?: Array<{ chat_id?: unknown; name?: unknown }> };
    } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = {};
    }
    const chats: Array<{ chat_id: string; name: string }> = [];
    for (const item of parsed.data?.items ?? []) {
      if (typeof item.chat_id === "string" && typeof item.name === "string" && item.name !== "") {
        chats.push({ chat_id: item.chat_id, name: item.name });
      }
    }
    return { item: okItem(scope, label), chats };
  } catch {
    return { item: networkFailure(scope, label), chats: null };
  }
}

export async function probeListMessages(
  token: string,
  chatId: string,
  fetchImpl?: typeof fetch,
  appId?: string,
  edition: FeishuEdition = "feishu",
): Promise<ProbeItem> {
  const f = fetchImpl ?? fetch;
  const scope = "im:message.group_msg + im:message";
  const missingScope = "im:message.group_msg";
  const label = "读群消息";
  const params = new URLSearchParams({
    container_id: chatId,
    container_id_type: "chat",
    page_size: "1",
  });
  try {
    const { status, ok, bodyCode } = await fetchAndRead(
      f,
      `${feishuApiBase(edition)}/open-apis/im/v1/messages?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const bad = bodyCode !== null && SCOPE_ERROR_CODES.has(bodyCode);
    if (!ok || bad) {
      return {
        scope,
        label,
        ...probeFailure(status, bodyCode, appId, missingScope, label, edition),
      };
    }
    return okItem(scope, label);
  } catch {
    return networkFailure(scope, label);
  }
}

export async function probeUploadFile(
  token: string,
  fetchImpl?: typeof fetch,
  appId?: string,
  edition: FeishuEdition = "feishu",
): Promise<ProbeItem> {
  const f = fetchImpl ?? fetch;
  const scope = "im:resource";
  const label = "传文件";
  const form = new FormData();
  form.append("file_type", "stream");
  form.append("file_name", "tasking-probe.txt");
  form.append("file", new Blob(["tasking probe"]), "tasking-probe.txt");
  try {
    const { status, ok, bodyCode } = await fetchAndRead(
      f,
      `${feishuApiBase(edition)}/open-apis/im/v1/files`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
    );
    const bad = bodyCode !== null && SCOPE_ERROR_CODES.has(bodyCode);
    if (!ok || bad) {
      return { scope, label, ...probeFailure(status, bodyCode, appId, scope, label, edition) };
    }
    return okItem(scope, label);
  } catch {
    return networkFailure(scope, label);
  }
}

export function sendScopeItem(): ProbeItem {
  return {
    scope: "im:message",
    label: "发消息",
    status: "unprobed",
    hint: "未探测（发消息会在群里留痕；tasking start 后实发验证）",
  };
}

export async function probeTail(
  token: string,
  appId: string,
  intakeChatId: string | null,
  fetchImpl?: typeof fetch,
  edition: FeishuEdition = "feishu",
): Promise<ProbeItem[]> {
  const items: ProbeItem[] = [];
  if (intakeChatId !== null && intakeChatId !== "") {
    items.push(await probeListMessages(token, intakeChatId, fetchImpl, appId, edition));
  }
  items.push(await probeUploadFile(token, fetchImpl, appId, edition));
  items.push(sendScopeItem());
  return items;
}

function withLink(
  base: string,
  link: keyof ConsoleLinks,
  appId: string | null,
  edition: FeishuEdition,
): string {
  return appId
    ? `${base} → 检查: ${consoleLinks(appId, edition)[link]}`
    : `${base} → 开发者后台「权限管理」开通后重新发布版本`;
}

export function diagnoseFeishuError(
  status: number,
  body: string,
  appId: string | null,
  edition: FeishuEdition = "feishu",
): string | null {
  const code = feishuBodyCode(body);
  if (code === 230027) {
    return withLink("缺 im:message.group_msg（读群消息被拒）", "permission", appId, edition);
  }
  if (code === 99991672 || /access denied/i.test(body)) {
    return withLink("缺 im:resource（文件上传被拒）", "permission", appId, edition);
  }
  if (status === 403) {
    return withLink("应用版本未发布/未审批，或缺少对应权限", "version", appId, edition);
  }
  return null;
}

import type { FeishuConfig, FeishuEdition } from "../../config/config-types.js";
import type { Logger } from "../../observability/logger.js";
import { TaskingError, toTaskingError } from "../../shared/errors.js";
import { translateCard } from "../../translate/card.js";
import { translate } from "../../translate/locale.js";
import { diagnoseFeishuError, feishuBodyCode } from "./probe.js";
import { crossRegionHint, feishuApiBase } from "./probe.js";

const DEFAULT_TIMEOUT_MS = 15000;
const TOKEN_TIMEOUT_MS = 10000;

export interface FeishuTimeoutOptions {
  defaultMs?: number;
  tokenMs?: number;
}

export interface FeishuAttachment {
  kind: "image" | "file";
  key: string;
  name: string;
}

export interface FeishuPolledMessage {
  message_id: string;
  root_id: string | null;
  parent_id: string | null;
  msg_type: string;
  text: string;
  sender_open_id: string | null;
  sender_name: string | null;
  sender_type: string | null;
  create_time: string;
  chat_id: string;
  attachments: FeishuAttachment[];
}

export function toSecondsStr(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n > 1e12) return String(Math.floor(n / 1000));
  return raw;
}

function parsePolledMessage(raw: Record<string, unknown>): FeishuPolledMessage {
  const body = (raw.body as Record<string, unknown> | undefined) ?? {};
  const content = typeof body.content === "string" ? body.content : "";
  const sender = (raw.sender as Record<string, unknown> | undefined) ?? {};
  const senderId = (sender.sender_id as Record<string, unknown> | undefined) ?? {};
  const msgType = typeof raw.msg_type === "string" ? raw.msg_type : "";
  const restId = typeof sender.id === "string" ? sender.id : null;
  const restIdType = typeof sender.id_type === "string" ? sender.id_type : null;
  const webhookOpenId = typeof senderId.open_id === "string" ? senderId.open_id : null;
  return {
    message_id: String(raw.message_id ?? ""),
    root_id: typeof raw.root_id === "string" && raw.root_id !== "" ? raw.root_id : null,
    parent_id: typeof raw.parent_id === "string" && raw.parent_id !== "" ? raw.parent_id : null,
    msg_type: msgType,
    text: parseMessageText(msgType, content),
    sender_open_id: webhookOpenId ?? (restId !== null && restIdType === "open_id" ? restId : null),
    sender_name: typeof sender.sender_name === "string" ? sender.sender_name : null,
    sender_type: typeof sender.sender_type === "string" ? sender.sender_type : null,
    create_time: toSecondsStr(raw.create_time),
    chat_id: typeof raw.chat_id === "string" ? raw.chat_id : "",
    attachments: parseMessageAttachments(msgType, content),
  };
}

export function parseMessageText(msgType: string, content: string): string {
  return msgType === "post" ? flattenPostContent(content) : parseTextContent(content);
}

export class FeishuSource {
  private static readonly COOLDOWN_BASE_MS = 60000;
  private static readonly COOLDOWN_CAP_MS = 600000;
  private readonly config: FeishuConfig;
  private readonly apiBase: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;
  private readonly tokenTimeoutMs: number;
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;
  private cooldownUntil = 0;
  private cooldownMs = 0;
  private readonly shownHints = new Set<string>();

  constructor(
    config: FeishuConfig,
    logger: Logger,
    fetchImpl?: typeof fetch,
    timeouts?: FeishuTimeoutOptions,
  ) {
    this.config = config;
    this.apiBase = feishuApiBase(config.edition);
    this.logger = logger;
    this.fetchImpl = fetchImpl ?? fetch;
    this.defaultTimeoutMs = timeouts?.defaultMs ?? DEFAULT_TIMEOUT_MS;
    this.tokenTimeoutMs = timeouts?.tokenMs ?? TOKEN_TIMEOUT_MS;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private assertNotCooling(): void {
    if (Date.now() < this.cooldownUntil) {
      throw new TaskingError(
        "feishu_cooldown",
        `feishu cooling down for ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)}s after 429`,
      );
    }
  }

  private enterCooldown(): void {
    this.cooldownMs =
      this.cooldownMs === 0
        ? FeishuSource.COOLDOWN_BASE_MS
        : Math.min(this.cooldownMs * 2, FeishuSource.COOLDOWN_CAP_MS);
    this.cooldownUntil = Date.now() + this.cooldownMs;
    this.logger.warn("feishu 429 received; entering cooldown", { cooldown_ms: this.cooldownMs });
  }

  private resetCooldown(): void {
    this.cooldownUntil = 0;
    this.cooldownMs = 0;
  }

  private warnTokenEditionHintOnce(): void {
    if (this.shownHints.has("token-edition")) return;
    this.shownHints.add("token-edition");
    this.logger.warn(`feishu tenant token auth failed: ${crossRegionHint(this.config.edition)}`);
  }

  private diagnosticSuffix(label: string, status: number, body: string): string {
    const key = `${label}:${status}`;
    if (this.shownHints.has(key)) return "";
    const hint = diagnoseFeishuError(status, body, this.config.app_id || null, this.config.edition);
    if (hint === null) return "";
    this.shownHints.add(key);
    return ` | ${hint}`;
  }

  async reply(chatId: string, text: string): Promise<void> {
    await this.postMessage(chatId, text);
  }

  async postMessage(chatId: string, text: string): Promise<string> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const url = `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=chat_id`;
    try {
      const res = await this.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: "text",
            content: JSON.stringify({ text: translate(text) }),
          }),
        },
        this.defaultTimeoutMs,
      );
      if (!res.ok) {
        if (res.status === 429) this.enterCooldown();
        const body = await res.text().catch(() => "");
        const suffix = this.diagnosticSuffix("postMessage", res.status, body);
        throw new TaskingError(
          "feishu_api_status",
          `feishu postMessage failed: ${res.status}${suffix}`,
          {
            status: res.status,
            body: body.slice(0, 500),
          },
        );
      }
      this.resetCooldown();
      const data = (await res.json()) as { data?: { message_id?: string } };
      return data.data?.message_id ?? "";
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "feishu_api_request",
        `feishu postMessage request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async replyInThread(
    rootId: string,
    text: string,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }> {
    return this.replyToMessage(rootId, text, true);
  }

  async replyFlat(rootId: string, text: string): Promise<void> {
    await this.replyToMessage(rootId, text, false);
  }

  async replyCardInThread(
    rootId: string,
    card: unknown,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }> {
    return this.replyPayload(rootId, "interactive", JSON.stringify(translateCard(card)), true);
  }

  async replyCardFlat(
    rootId: string,
    card: unknown,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }> {
    return this.replyPayload(rootId, "interactive", JSON.stringify(translateCard(card)), false);
  }

  async updateCard(messageId: string, card: unknown): Promise<void> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const url = `${this.apiBase}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`;
    try {
      const res = await this.fetchWithTimeout(
        url,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: JSON.stringify(translateCard(card)) }),
        },
        this.defaultTimeoutMs,
      );
      if (!res.ok) {
        if (res.status === 429) this.enterCooldown();
        const body = await res.text().catch(() => "");
        const suffix = this.diagnosticSuffix("updateCard", res.status, body);
        throw new TaskingError(
          "feishu_api_status",
          `feishu updateCard failed: ${res.status}${suffix}`,
          {
            status: res.status,
            body: body.slice(0, 500),
          },
        );
      }
      this.resetCooldown();
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "feishu_api_request",
        `feishu updateCard request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const url = `${this.apiBase}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`;
    try {
      const res = await this.fetchWithTimeout(
        url,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        this.defaultTimeoutMs,
      );
      if (!res.ok) {
        if (res.status === 429) this.enterCooldown();
        const body = await res.text().catch(() => "");
        const suffix = this.diagnosticSuffix("deleteMessage", res.status, body);
        throw new TaskingError(
          "feishu_api_status",
          `feishu deleteMessage failed: ${res.status}${suffix}`,
          {
            status: res.status,
            body: body.slice(0, 500),
          },
        );
      }
      this.resetCooldown();
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "feishu_api_request",
        `feishu deleteMessage request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async uploadFile(content: Uint8Array, fileName: string): Promise<string> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const url = `${this.apiBase}/open-apis/im/v1/files`;
    const form = new FormData();
    form.append("file_type", "stream");
    form.append("file_name", fileName);
    form.append("file", new Blob([content]), fileName);
    try {
      const res = await this.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        },
        this.defaultTimeoutMs,
      );
      if (!res.ok) {
        if (res.status === 429) this.enterCooldown();
        const body = await res.text().catch(() => "");
        const suffix = this.diagnosticSuffix("uploadFile", res.status, body);
        throw new TaskingError(
          "feishu_api_status",
          `feishu uploadFile failed: ${res.status}${suffix}`,
          {
            status: res.status,
            body: body.slice(0, 500),
          },
        );
      }
      this.resetCooldown();
      const data = (await res.json()) as { data?: { file_key?: string } };
      return data.data?.file_key ?? "";
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "feishu_api_request",
        `feishu uploadFile request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async sendFileMessage(
    rootId: string,
    fileKey: string,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }> {
    return this.replyPayload(rootId, "file", JSON.stringify({ file_key: fileKey }), true);
  }

  private async replyToMessage(
    rootId: string,
    text: string,
    asThread: boolean,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }> {
    return this.replyPayload(rootId, "text", JSON.stringify({ text: translate(text) }), asThread);
  }

  private async replyPayload(
    rootId: string,
    msgType: string,
    content: string,
    asThread: boolean,
  ): Promise<{ message_id: string; root_id: string | null; thread_id: string | null }> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const url = `${this.apiBase}/open-apis/im/v1/messages/${encodeURIComponent(rootId)}/reply`;
    const body: Record<string, unknown> = {
      msg_type: msgType,
      content,
    };
    if (asThread) body.reply_in_thread = true;
    try {
      const res = await this.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        this.defaultTimeoutMs,
      );
      if (!res.ok) {
        if (res.status === 429) this.enterCooldown();
        const resBody = await res.text().catch(() => "");
        const suffix = this.diagnosticSuffix(
          asThread ? "replyInThread" : "replyFlat",
          res.status,
          resBody,
        );
        throw new TaskingError(
          "feishu_api_status",
          `feishu reply${asThread ? "InThread" : "Flat"} failed: ${res.status}${suffix}`,
          { status: res.status, body: resBody.slice(0, 500) },
        );
      }
      this.resetCooldown();
      const data = (await res.json()) as {
        data?: { message_id?: string; root_id?: string; parent_id?: string; thread_id?: string };
      };
      const msgId = data.data?.message_id ?? "";
      const root = data.data?.root_id ?? null;
      const threadId = data.data?.thread_id ?? null;
      return { message_id: msgId, root_id: root, thread_id: threadId };
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "feishu_api_request",
        `feishu reply${asThread ? "InThread" : "Flat"} request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    kind: "image" | "file",
  ): Promise<{ data: Uint8Array; contentType: string | null }> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const url = `${this.apiBase}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${kind}`;
    try {
      const res = await this.fetchWithTimeout(
        url,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        this.defaultTimeoutMs,
      );
      if (!res.ok) {
        if (res.status === 429) this.enterCooldown();
        const body = await res.text().catch(() => "");
        const suffix = this.diagnosticSuffix("downloadMessageResource", res.status, body);
        throw new TaskingError(
          "feishu_api_status",
          `feishu downloadMessageResource failed: ${res.status}${suffix}`,
          { status: res.status, body: body.slice(0, 500) },
        );
      }
      this.resetCooldown();
      return {
        data: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type"),
      };
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "feishu_api_request",
        `feishu downloadMessageResource request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async listChatMembers(chatId: string): Promise<Array<{ open_id: string; name: string }>> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const members: Array<{ open_id: string; name: string }> = [];
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ member_id_type: "open_id", page_size: "100" });
      if (pageToken !== "") params.set("page_token", pageToken);
      const url = `${this.apiBase}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?${params.toString()}`;
      try {
        const res = await this.fetchWithTimeout(
          url,
          { method: "GET", headers: { Authorization: `Bearer ${token}` } },
          this.defaultTimeoutMs,
        );
        if (!res.ok) {
          if (res.status === 429) this.enterCooldown();
          const body = await res.text().catch(() => "");
          const suffix = this.diagnosticSuffix("listChatMembers", res.status, body);
          throw new TaskingError(
            "feishu_api_status",
            `feishu listChatMembers failed: ${res.status}${suffix}`,
            { status: res.status, body: body.slice(0, 500) },
          );
        }
        this.resetCooldown();
        const data = (await res.json()) as {
          data?: {
            items?: Array<{ member_id?: string; name?: string }>;
            has_more?: boolean;
            page_token?: string;
          };
        };
        for (const item of data.data?.items ?? []) {
          if (typeof item.member_id === "string" && item.member_id !== "") {
            members.push({
              open_id: item.member_id,
              name: typeof item.name === "string" ? item.name : "",
            });
          }
        }
        if (data.data?.has_more !== true || typeof data.data.page_token !== "string") break;
        pageToken = data.data.page_token;
        if (pageToken === "") break;
      } catch (e) {
        if (e instanceof TaskingError) throw e;
        throw new TaskingError(
          "feishu_api_request",
          `feishu listChatMembers request failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return members;
  }

  async listMessages(chatId: string, sinceTime: string): Promise<FeishuPolledMessage[]> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const nowSec = String(Math.floor(Date.now() / 1000));
    const startTime = this.resolveStartTime(sinceTime);
    const params = new URLSearchParams({
      container_id: chatId,
      container_id_type: "chat",
      end_time: nowSec,
      page_size: "50",
    });
    if (startTime !== null) params.set("start_time", startTime);
    return this.listPages(token, params, "listMessages");
  }

  async listThreadReplies(threadId: string, since?: string | null): Promise<FeishuPolledMessage[]> {
    this.assertNotCooling();
    const token = await this.getTenantAccessToken();
    const nowSec = String(Math.floor(Date.now() / 1000));
    const startTime = this.resolveStartTime(since);
    const params = new URLSearchParams({
      container_id: threadId,
      container_id_type: "thread",
      end_time: nowSec,
      page_size: "50",
    });
    if (startTime !== null) params.set("start_time", startTime);
    return this.listPages(token, params, "listThreadReplies");
  }

  private async listPages(
    token: string,
    params: URLSearchParams,
    label: string,
    singlePage = false,
  ): Promise<FeishuPolledMessage[]> {
    const all: FeishuPolledMessage[] = [];
    let pageToken: string | null = null;
    try {
      do {
        if (pageToken !== null) params.set("page_token", pageToken);
        const url = `${this.apiBase}/open-apis/im/v1/messages?${params.toString()}`;
        const res = await this.fetchWithTimeout(
          url,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          },
          this.defaultTimeoutMs,
        );
        if (!res.ok) {
          if (res.status === 429) this.enterCooldown();
          const body = await res.text().catch(() => "");
          const suffix = this.diagnosticSuffix(label, res.status, body);
          throw new TaskingError(
            "feishu_api_status",
            `feishu ${label} failed: ${res.status} ${body.slice(0, 200)}${suffix}`,
            { status: res.status, body: body.slice(0, 500) },
          );
        }
        this.resetCooldown();
        const data = (await res.json()) as {
          code?: number;
          data?: {
            items?: Array<Record<string, unknown>>;
            has_more?: boolean;
            page_token?: string;
          };
        };
        const items = Array.isArray(data.data?.items) ? data.data.items : [];
        for (const item of items) all.push(parsePolledMessage(item));
        const hasMore = data.data?.has_more === true;
        const nextToken = typeof data.data?.page_token === "string" ? data.data.page_token : null;
        pageToken =
          !singlePage && hasMore && nextToken !== null && nextToken !== "" ? nextToken : null;
      } while (pageToken !== null);
      return all;
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "feishu_api_request",
        `feishu ${label} request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private resolveStartTime(since?: string | null): string | null {
    const sinceSec = since ? toSecondsStr(since) : "";
    return sinceSec !== "" ? sinceSec : null;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.tenantAccessToken;
    }
    if (!this.config.app_id || !this.config.app_secret) {
      throw new TaskingError("feishu_missing_credentials", "feishu app_id/app_secret required");
    }
    const url = `${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`;
    try {
      const res = await this.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: this.config.app_id,
            app_secret: this.config.app_secret,
          }),
        },
        this.tokenTimeoutMs,
      );
      if (!res.ok) {
        if (res.status === 429) this.enterCooldown();
        this.warnTokenEditionHintOnce();
        throw new TaskingError("feishu_api_status", `feishu token failed: ${res.status}`);
      }
      const data = (await res.json()) as { tenant_access_token?: string; expire?: number };
      this.resetCooldown();
      this.tenantAccessToken = data.tenant_access_token ?? null;
      this.tokenExpiresAt = Date.now() + (data.expire ?? 7200) * 1000 - 60000;
      if (!this.tenantAccessToken) {
        this.warnTokenEditionHintOnce();
        throw new TaskingError("feishu_api_status", "feishu token response missing access token");
      }
      return this.tenantAccessToken;
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw toTaskingError(e);
    }
  }
}

export function parseTextContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text ?? content;
  } catch {
    return content;
  }
}

export function parseMessageAttachments(msgType: string, content: string): FeishuAttachment[] {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (msgType === "image") {
    const key = typeof parsed.image_key === "string" ? parsed.image_key : "";
    return key === "" ? [] : [{ kind: "image", key, name: "image.png" }];
  }
  if (msgType === "file" || msgType === "media" || msgType === "audio") {
    const key = typeof parsed.file_key === "string" ? parsed.file_key : "";
    if (key === "") return [];
    const name =
      typeof parsed.file_name === "string" && parsed.file_name !== ""
        ? parsed.file_name
        : "attachment";
    return [{ kind: "file", key, name }];
  }
  if (msgType !== "post") return [];
  const attachments: FeishuAttachment[] = [];
  let index = 0;
  const lines = Array.isArray(parsed.content) ? parsed.content : [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    for (const block of line) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;
      const tag = typeof b.tag === "string" ? b.tag : "";
      if (tag !== "img") continue;
      const key = typeof b.image_key === "string" ? b.image_key : "";
      if (key === "") continue;
      index++;
      attachments.push({ kind: "image", key, name: `image-${index}.png` });
    }
  }
  return attachments;
}

export function isReadableText(msgType: string): boolean {
  return msgType === "text" || msgType === "post";
}

export function flattenPostContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { title?: unknown; content?: unknown };
    if (!Array.isArray(parsed.content)) return "";
    const lines: string[] = [];
    for (const line of parsed.content) {
      if (!Array.isArray(line)) continue;
      const parts: string[] = [];
      for (const block of line) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;
        const tag = typeof b.tag === "string" ? b.tag : "";
        const text = typeof b.text === "string" ? b.text : "";
        switch (tag) {
          case "text":
          case "a":
          case "plain_text":
          case "md":
          case "emoji":
            parts.push(text);
            break;
          case "at":
            parts.push(
              typeof b.user_name === "string" && b.user_name !== "" ? `@${b.user_name}` : "@user",
            );
            break;
          case "img":
            parts.push("[图片]");
            break;
          default:
            break;
        }
      }
      lines.push(parts.join(""));
    }
    const title =
      typeof parsed.title === "string" && parsed.title.trim() !== "" ? parsed.title.trim() : "";
    const body = lines.filter((l) => l.trim() !== "").join("\n");
    return [title, body].filter((s) => s !== "").join("\n");
  } catch {
    return "";
  }
}

export function validateFeishuConfig(config: FeishuConfig): TaskingError[] {
  const errors: TaskingError[] = [];
  if (config.enabled) {
    if (!config.app_id) {
      errors.push(
        new TaskingError("feishu_missing_credentials", "feishu.app_id is required when enabled"),
      );
    }
    if (!config.app_secret) {
      errors.push(
        new TaskingError(
          "feishu_missing_credentials",
          "feishu.app_secret is required when enabled",
        ),
      );
    }
  }
  return errors;
}

const TOKEN_CODE_HINTS: Record<number, string> = {
  10003: "App Secret 不正确",
  10014: "App ID 不正确或应用不存在",
};

export async function fetchTenantTokenFor(
  appId: string,
  appSecret: string,
  fetchImpl?: typeof fetch,
  edition: FeishuEdition = "feishu",
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(
      `${feishuApiBase(edition)}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );
    if (!res.ok) return { ok: false, reason: `服务不可用（HTTP ${res.status}）` };
    const data = (await res.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
    };
    if (data.code !== 0 || typeof data.tenant_access_token !== "string") {
      const hint = data.code !== undefined ? TOKEN_CODE_HINTS[data.code] : undefined;
      return { ok: false, reason: hint ?? data.msg ?? "凭据错误或应用未发布版本" };
    }
    return { ok: true, token: data.tenant_access_token };
  } catch (e) {
    return { ok: false, reason: `网络不可达（${e instanceof Error ? e.message : String(e)}）` };
  }
}

export async function lookupFeishuUserId(
  token: string,
  emailOrMobile: string,
  fetchImpl?: typeof fetch,
  edition: FeishuEdition = "feishu",
): Promise<
  | { ok: true; open_id: string }
  | { ok: false; reason: "not_found" | "permission" | "other"; detail: string }
> {
  const f = fetchImpl ?? fetch;
  const isEmail = emailOrMobile.includes("@");
  const body = isEmail ? { emails: [emailOrMobile] } : { mobiles: [emailOrMobile] };
  try {
    const res = await f(
      `${feishuApiBase(edition)}/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const permission = res.status === 403 || feishuBodyCode(text) === 230027;
      return {
        ok: false,
        reason: permission ? "permission" : "other",
        detail: `HTTP ${res.status} ${text.slice(0, 120)}`,
      };
    }
    const data = (await res.json()) as {
      data?: { user_list?: Array<{ user_id?: unknown }> };
    };
    const openId = data.data?.user_list?.[0]?.user_id;
    if (typeof openId === "string" && openId !== "") {
      return { ok: true, open_id: openId };
    }
    return { ok: false, reason: "not_found", detail: "未找到对应用户" };
  } catch (e) {
    return { ok: false, reason: "other", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function dismissBotChat(
  token: string,
  chatId: string,
  fetchImpl?: typeof fetch,
  edition: FeishuEdition = "feishu",
): Promise<boolean> {
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(
      `${feishuApiBase(edition)}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function createBotChat(
  token: string,
  name: string,
  fetchImpl?: typeof fetch,
  userIds: string[] = [],
  edition: FeishuEdition = "feishu",
): Promise<
  { ok: true; chat_id: string } | { ok: false; reason: "permission" | "other"; detail: string }
> {
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(`${feishuApiBase(edition)}/open-apis/im/v1/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name,
        description: "tasking intake",
        chat_mode: "group",
        user_id_list: userIds,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const permission = res.status === 403 || feishuBodyCode(body) === 99991672;
      return {
        ok: false,
        reason: permission ? "permission" : "other",
        detail: `HTTP ${res.status} ${body.slice(0, 120)}`,
      };
    }
    const data = (await res.json()) as { data?: { chat_id?: unknown } };
    const chatId = typeof data.data?.chat_id === "string" ? data.data.chat_id : "";
    if (chatId === "") return { ok: false, reason: "other", detail: "响应缺少 chat_id" };
    return { ok: true, chat_id: chatId };
  } catch (e) {
    return { ok: false, reason: "other", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function listBotChats(
  token: string,
  fetchImpl?: typeof fetch,
  edition: FeishuEdition = "feishu",
): Promise<Array<{ chat_id: string; name: string }> | null> {
  const f = fetchImpl ?? fetch;
  const chats: Array<{ chat_id: string; name: string }> = [];
  let pageToken = "";
  try {
    for (let page = 0; page < 5; page++) {
      const url = `${feishuApiBase(edition)}/open-apis/im/v1/chats?page_size=100${
        pageToken === "" ? "" : `&page_token=${encodeURIComponent(pageToken)}`
      }`;
      const res = await f(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        data?: {
          items?: Array<{ chat_id?: unknown; name?: unknown }>;
          page_token?: unknown;
          has_more?: boolean;
        };
      };
      for (const item of data.data?.items ?? []) {
        if (typeof item.chat_id === "string" && typeof item.name === "string" && item.name !== "") {
          chats.push({ chat_id: item.chat_id, name: item.name });
        }
      }
      if (data.data?.has_more !== true) break;
      pageToken = typeof data.data?.page_token === "string" ? data.data.page_token : "";
      if (pageToken === "") break;
    }
    return chats;
  } catch {
    return null;
  }
}

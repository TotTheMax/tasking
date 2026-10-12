import { Domain, EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import type { FeishuEdition } from "../../config/config-types.js";
import type { Logger } from "../../observability/logger.js";
import type { FeishuPolledMessage } from "./source.js";
import { parseMessageAttachments, parseMessageText, toSecondsStr } from "./source.js";

export const EVENT_MESSAGE_RECEIVE = "im.message.receive_v1";
export const EVENT_CARD_ACTION = "card.action.trigger";

export interface FeishuCardAction {
  messageId: string;
  chatId: string;
  operatorOpenId: string | null;
  operatorName: string | null;
  value: unknown;
}

interface RawCardActionFields {
  context?: { open_message_id?: unknown; open_chat_id?: unknown };
  open_message_id?: unknown;
  open_chat_id?: unknown;
  operator?: { open_id?: unknown; name?: unknown };
  action?: { value?: unknown };
  event?: unknown;
}

function firstString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeCardAction(data: unknown): FeishuCardAction | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as RawCardActionFields;
  const inner =
    typeof raw.event === "object" && raw.event !== null ? (raw.event as RawCardActionFields) : raw;
  const messageId =
    firstString(inner.context?.open_message_id) ||
    firstString(inner.open_message_id) ||
    firstString(raw.context?.open_message_id) ||
    firstString(raw.open_message_id);
  if (messageId === "") return null;
  if (inner.action?.value === undefined) return null;
  const operatorOpenId = firstString(inner.operator?.open_id) || firstString(raw.operator?.open_id);
  const operatorName = firstString(inner.operator?.name) || firstString(raw.operator?.name);
  return {
    messageId,
    chatId:
      firstString(inner.context?.open_chat_id) ||
      firstString(inner.open_chat_id) ||
      firstString(raw.context?.open_chat_id) ||
      firstString(raw.open_chat_id),
    operatorOpenId: operatorOpenId === "" ? null : operatorOpenId,
    operatorName: operatorName === "" ? null : operatorName,
    value: inner.action.value,
  };
}

interface SdkEventMessage {
  message_id?: unknown;
  root_id?: unknown;
  parent_id?: unknown;
  thread_id?: unknown;
  message_type?: unknown;
  msg_type?: unknown;
  create_time?: unknown;
  chat_id?: unknown;
  content?: unknown;
}

interface SdkEventSender {
  sender_id?: unknown;
  sender_type?: unknown;
  id?: unknown;
  id_type?: unknown;
}

export function normalizeEventPayload(data: unknown): FeishuPolledMessage | null {
  const raw = data as { message?: SdkEventMessage; sender?: SdkEventSender } | null;
  const m = raw?.message;
  if (typeof m !== "object" || m === null) return null;
  const messageId = typeof m.message_id === "string" ? m.message_id : "";
  if (messageId === "") return null;
  const msgType =
    typeof m.message_type === "string"
      ? m.message_type
      : typeof m.msg_type === "string"
        ? m.msg_type
        : "";
  const content = typeof m.content === "string" ? m.content : "";
  const sender = (raw?.sender ?? {}) as SdkEventSender;
  const senderId = (sender.sender_id as Record<string, unknown> | undefined) ?? {};
  const restId = typeof sender.id === "string" ? sender.id : null;
  const restIdType = typeof sender.id_type === "string" ? sender.id_type : null;
  const webhookOpenId = typeof senderId.open_id === "string" ? senderId.open_id : null;
  return {
    message_id: messageId,
    root_id: typeof m.root_id === "string" && m.root_id !== "" ? m.root_id : null,
    parent_id: typeof m.parent_id === "string" && m.parent_id !== "" ? m.parent_id : null,
    msg_type: msgType,
    text: parseMessageText(msgType, content),
    sender_open_id: webhookOpenId ?? (restId !== null && restIdType === "open_id" ? restId : null),
    sender_name: null,
    sender_type: typeof sender.sender_type === "string" ? sender.sender_type : null,
    create_time: toSecondsStr(m.create_time),
    chat_id: typeof m.chat_id === "string" ? m.chat_id : "",
    attachments: parseMessageAttachments(msgType, content),
  };
}

export interface WSClientLike {
  start(options: { eventDispatcher: unknown }): Promise<unknown> | unknown;
  close?(): void;
}

interface SdkLogger {
  error: (...msg: unknown[]) => void;
  warn: (...msg: unknown[]) => void;
  info: (...msg: unknown[]) => void;
  debug: (...msg: unknown[]) => void;
  trace: (...msg: unknown[]) => void;
}

const SDK_NOISE_PATTERNS = [
  /receive events or callbacks through persistent connection/,
  /register .+ handle/,
  /event-dispatch is ready/,
];

export function makeSdkLogger(logger: Logger): SdkLogger {
  const fmt = (parts: unknown[]): string =>
    parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  const noisy = (msg: string): boolean => SDK_NOISE_PATTERNS.some((re) => re.test(msg));
  return {
    error: (...parts) => logger.error(`feishu-ws ${fmt(parts)}`),
    warn: (...parts) => logger.warn(`feishu-ws ${fmt(parts)}`),
    info: (...parts) => {
      const msg = fmt(parts);
      if (!noisy(msg)) logger.info(`feishu-ws ${msg}`);
    },
    debug: (...parts) => {
      const msg = fmt(parts);
      if (!noisy(msg)) logger.debug(`feishu-ws ${msg}`);
    },
    trace: (...parts) => logger.debug(`feishu-ws ${fmt(parts)}`),
  };
}

export interface FeishuEventListenerDeps {
  appId: string;
  appSecret: string;
  edition: FeishuEdition;
  onMessage: (msg: FeishuPolledMessage) => void;
  onCardAction?: (action: FeishuCardAction) => unknown | Promise<unknown>;
  onConnected: () => void;
  logger: Logger;
  retryDelayMs?: number;
  clientFactory?: (onConnected: () => void, onError: (err: Error) => void) => WSClientLike;
}

const CONNECT_RETRY_LOG_HINT =
  "event channel unavailable — check developer console: subscription mode = long connection, " +
  "event im.message.receive_v1 added, app version published";

export class FeishuEventListener {
  private readonly deps: FeishuEventListenerDeps;
  private running = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private connectFailureWarned = false;

  constructor(deps: FeishuEventListenerDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private buildClient(): WSClientLike {
    const connected = (): void => {
      this.connectFailureWarned = false;
      this.deps.logger.info("event channel connected");
      this.deps.onConnected();
    };
    if (this.deps.clientFactory) {
      return this.deps.clientFactory(connected, (err) => this.scheduleRetry(err));
    }
    const client = new WSClient({
      appId: this.deps.appId,
      appSecret: this.deps.appSecret,
      domain: this.deps.edition === "lark" ? Domain.Lark : Domain.Feishu,
      autoReconnect: true,
      loggerLevel: 4,
      logger: makeSdkLogger(this.deps.logger),
      onReady: connected,
      onReconnected: connected,
      onError: (err: Error) => this.scheduleRetry(err),
    });
    return {
      start: (options: { eventDispatcher: unknown }) =>
        client.start(options as { eventDispatcher: EventDispatcher }),
      close: () => client.close(),
    };
  }

  handleEventData = (data: unknown): void => {
    const msg = normalizeEventPayload(data);
    if (msg) this.deps.onMessage(msg);
  };

  handleCardActionData = (data: unknown): unknown => {
    const action = normalizeCardAction(data);
    if (!action) {
      this.deps.logger.debug("card action ignored: unnormalizable payload");
      return undefined;
    }
    return this.deps.onCardAction?.(action);
  };

  private async connect(): Promise<void> {
    if (!this.running) return;
    const client = this.buildClient();
    const dispatcher = new EventDispatcher({
      logger: makeSdkLogger(this.deps.logger),
      loggerLevel: 4,
    }).register({
      [EVENT_MESSAGE_RECEIVE]: this.handleEventData,
      [EVENT_CARD_ACTION]: this.handleCardActionData,
    });
    try {
      await client.start({ eventDispatcher: dispatcher });
    } catch (e) {
      this.scheduleRetry(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private scheduleRetry(err: Error): void {
    if (!this.running) return;
    const delay = this.deps.retryDelayMs ?? 60000;
    this.deps.logger.warn(
      `event channel connect failed: ${err.message}; ${CONNECT_RETRY_LOG_HINT}`,
      {
        retry_ms: delay,
      },
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.deps.logger.debug("event channel reconnecting");
      void this.connect();
    }, delay);
  }
}

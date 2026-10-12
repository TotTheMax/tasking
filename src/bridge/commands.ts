export const SENTINEL = "via Feishu";
const LEGACY_SENTINEL = "via 飞书";
const SENTINEL_PREFIX = new RegExp(`^💬 [^\\n]* (?:${LEGACY_SENTINEL}|${SENTINEL}):\\n`);
export const COMMAND_PREFIX = "/";

export function intakeAckTextFor(jiraAvailable: boolean): string {
  return jiraAvailable
    ? "已收到 ✓（/issue 创建任务，/help 看用法）"
    : "已收到 ✓（/chat 创建会话，/help 看用法）";
}

export const THREAD_ACK_TEXT = "✅ 已收到，已同步到 {issue_key}";
export const THREAD_ACK_FAIL_TEXT = "⚠️ 同步失败，请稍后重试";

const HELP_HEADER_LINES = ["tasking 命令:"];
const ISSUE_HELP_LINES = [
  "/issue <title>        创建 issue（仅 intake 群）",
  "  <description>        第 2 行起 = 描述，多行",
  "  --type <name|N>     覆盖 issueType（默认 feishu.create_issue_type）",
  "  --agent <name>      创建时指定 agent（打 agent:<name> 标签）",
  "/issue                列该项目可用 issueType + 默认",
];
const CHAT_HELP_LINES = [
  "/chat <project> <msg> 在已配置项目目录创建 opencode 会话（仅 intake 群）",
  "/chat /abs/path <msg> 在指定目录创建 opencode 会话",
  "/chat                 列出可用项目",
  "/chat 内: 直接回复续聊，/stop 中断当前任务，/done 结束会话",
];
const STATE_HELP_LINES = [
  "/state                查看当前状态 + 可用转移编号（已绑话题内）",
  "/state <N|name>       转状态",
];
const AGENT_HELP_LINES = [
  "/agent                查看默认 agent + 可用目录（话题内还显示当前 agent）",
  "/agent <name>         切换该任务 agent（话题内，下一 turn 生效）",
  "/agent default        清除 agent 标签，回退默认",
];
const HELP_TAIL_LINES = ["/help                 本帮助"];

export const HELP_LINES: string[] = [
  ...HELP_HEADER_LINES,
  ...ISSUE_HELP_LINES,
  ...CHAT_HELP_LINES,
  ...STATE_HELP_LINES,
  ...AGENT_HELP_LINES,
  ...HELP_TAIL_LINES,
];
export const HELP_TEXT = HELP_LINES.join("\n");

export function helpLinesFor(jiraAvailable: boolean): string[] {
  if (jiraAvailable) return HELP_LINES;
  return [...HELP_HEADER_LINES, ...CHAT_HELP_LINES, ...AGENT_HELP_LINES, ...HELP_TAIL_LINES];
}

export function helpTextFor(jiraAvailable: boolean): string {
  return helpLinesFor(jiraAvailable).join("\n");
}

export function threadHelpLinesFor(jiraAvailable: boolean): string[] {
  const groupOnly = jiraAvailable ? "/issue、/chat" : "/chat";
  return [
    ...HELP_HEADER_LINES,
    ...(jiraAvailable ? STATE_HELP_LINES : []),
    ...AGENT_HELP_LINES,
    ...HELP_TAIL_LINES,
    `群聊命令（intake 群内使用）：${groupOnly}`,
  ];
}

export function threadHelpTextFor(jiraAvailable: boolean): string {
  return threadHelpLinesFor(jiraAvailable).join("\n");
}

function commandNamesOf(lines: string[]): string[] {
  const names = lines
    .map((line) => /^\/(\S+)/.exec(line)?.[0])
    .filter((name): name is string => name !== undefined);
  return [...new Set(names)];
}

export function intakeCommandsFor(jiraAvailable: boolean): string[] {
  const commands = jiraAvailable
    ? [...ISSUE_HELP_LINES, ...CHAT_HELP_LINES, ...AGENT_HELP_LINES]
    : [...CHAT_HELP_LINES, ...AGENT_HELP_LINES];
  return [...commandNamesOf(commands), "/help"];
}

export function threadCommandsFor(jiraAvailable: boolean): string[] {
  const commands = jiraAvailable
    ? [...STATE_HELP_LINES, ...AGENT_HELP_LINES]
    : [...AGENT_HELP_LINES];
  return [...commandNamesOf(commands), "/help"];
}

export function isCommand(text: string): boolean {
  return text.trimStart().startsWith(COMMAND_PREFIX);
}

export function isHelp(text: string): boolean {
  const t = text.trim();
  return t === "/help" || t === "/?";
}

export function isAgent(text: string): boolean {
  const t = text.trim();
  return t === "/agent" || t.startsWith("/agent ");
}

export interface ParsedAgent {
  kind: "list" | "switch" | "reset";
  name: string | null;
}

export function parseAgent(text: string): ParsedAgent | null {
  const trimmed = text.trim();
  if (trimmed === "/agent") return { kind: "list", name: null };
  if (!trimmed.startsWith("/agent ")) return null;
  const name = trimmed.slice("/agent ".length).trim();
  if (name === "") return { kind: "list", name: null };
  if (name === "default" || name === "-") return { kind: "reset", name: null };
  return { kind: "switch", name };
}

export interface ParsedIssue {
  kind: "create" | "discover";
  title: string | null;
  description: string;
  typeOverride: string | null;
  agentOverride: string | null;
}

export function parseIssue(text: string): ParsedIssue | null {
  const trimmed = text.trim();
  if (!/^\/issue(?:\s|$)/.test(trimmed)) return null;
  let rest = trimmed.slice("/issue".length).replace(/^\s+/, "");
  if (rest === "") {
    return {
      kind: "discover",
      title: null,
      description: "",
      typeOverride: null,
      agentOverride: null,
    };
  }
  let typeOverride: string | null = null;
  let agentOverride: string | null = null;
  for (;;) {
    const typeMatch = /^--type\s+(\S+)(?:\s+)?/.exec(rest);
    if (typeMatch && typeMatch[1] !== undefined) {
      typeOverride = typeMatch[1];
      rest = rest.slice(typeMatch[0].length);
      continue;
    }
    const agentMatch = /^--agent\s+(\S+)(?:\s+)?/.exec(rest);
    if (agentMatch && agentMatch[1] !== undefined) {
      agentOverride = agentMatch[1];
      rest = rest.slice(agentMatch[0].length);
      continue;
    }
    break;
  }
  const lines = rest.split("\n");
  const title = (lines[0] ?? "").trim();
  const description = lines.slice(1).join("\n").trim();
  if (!title) {
    return {
      kind: "discover",
      title: null,
      description: "",
      typeOverride: null,
      agentOverride: null,
    };
  }
  return { kind: "create", title, description, typeOverride, agentOverride };
}

export interface ParsedState {
  kind: "list" | "transition";
  target: string | null;
}

export interface ParsedChat {
  kind: "list" | "help" | "start";
  target: string | null;
  isPath: boolean;
  message: string;
}

export function parseChat(text: string): ParsedChat | null {
  const trimmed = text.trim();
  if (trimmed === "/chat") {
    return { kind: "list", target: null, isPath: false, message: "" };
  }
  if (!trimmed.startsWith("/chat ")) return null;
  const rest = trimmed.slice("/chat ".length).trim();
  if (rest === "") return { kind: "list", target: null, isPath: false, message: "" };
  if (rest === "list") return { kind: "list", target: null, isPath: false, message: "" };
  if (rest === "help") return { kind: "help", target: null, isPath: false, message: "" };
  const firstSpace = rest.search(/\s/);
  const head = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const message = firstSpace === -1 ? "" : rest.slice(firstSpace + 1).trim();
  const isPath = head.startsWith("/");
  return { kind: "start", target: head, isPath, message };
}

export function parseState(text: string): ParsedState | null {
  const trimmed = text.trim();
  if (trimmed === "/state") {
    return { kind: "list", target: null };
  }
  if (!trimmed.startsWith("/state ")) {
    return null;
  }
  const target = trimmed.slice("/state ".length).trim();
  if (target === "") {
    return { kind: "list", target: null };
  }
  return { kind: "transition", target };
}

export function buildBridgedCommentBody(senderName: string, text: string): string {
  return `💬 ${senderName} ${SENTINEL}:\n${text}`;
}

export function hasSentinel(commentText: string): boolean {
  return SENTINEL_PREFIX.test(commentText);
}

export function renderForwardedComment(
  authorName: string | null,
  text: string,
  isAgent: boolean,
): string {
  const prefix = isAgent ? "🤖 agent" : `💬 ${authorName ?? "someone"} (Jira)`;
  return `${prefix}:\n${text}`;
}

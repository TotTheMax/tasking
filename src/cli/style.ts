import { translate } from "../translate/locale.js";

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const CYAN = "\x1b[36m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const GRAY = "\x1b[90m";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code is intentional
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export type StatusKind = "ok" | "fail" | "warn" | "info";

export interface Style {
  bold: (text: string) => string;
  dim: (text: string) => string;
  green: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  gray: (text: string) => string;
  cyan: (text: string) => string;
  boxHeader: (title: string) => string;
  boxLine: (text: string) => string;
  boxFooter: () => string;
  boxPrefix: () => string;
  statusIcon: (kind: StatusKind) => string;
}

const STATUS_ICONS: Record<StatusKind, string> = {
  ok: "✓",
  fail: "✗",
  warn: "⚠",
  info: "·",
};

export function createStyle(useColor: boolean): Style {
  if (useColor) {
    return {
      bold: (t) => `${BOLD}${translate(t)}${RESET}`,
      dim: (t) => `${DIM}${translate(t)}${RESET}`,
      green: (t) => `${GREEN}${t}${RESET}`,
      red: (t) => `${RED}${t}${RESET}`,
      yellow: (t) => `${YELLOW}${t}${RESET}`,
      gray: (t) => `${GRAY}${t}${RESET}`,
      cyan: (t) => `${CYAN}${t}${RESET}`,
      boxHeader: (title) => `${CYAN}${BOLD}╭─ ${translate(title)}${RESET}\n`,
      boxLine: (text) => `${GRAY}│${RESET}  ${translate(text)}\n`,
      boxFooter: () => `${CYAN}${BOLD}╰──${RESET}\n`,
      boxPrefix: () => `${GRAY}│${RESET}  `,
      statusIcon: (kind) => {
        const icon = STATUS_ICONS[kind];
        const color =
          kind === "ok" ? GREEN : kind === "fail" ? RED : kind === "warn" ? YELLOW : GRAY;
        return `${color}${icon}${RESET}`;
      },
    };
  }
  const identity = (t: string) => t;
  return {
    bold: translate,
    dim: translate,
    green: identity,
    red: identity,
    yellow: identity,
    gray: identity,
    cyan: identity,
    boxHeader: (title) => `╭─ ${translate(title)}\n`,
    boxLine: (text) => `│  ${translate(text)}\n`,
    boxFooter: () => "╰──\n",
    boxPrefix: () => "│  ",
    statusIcon: (kind) => STATUS_ICONS[kind],
  };
}

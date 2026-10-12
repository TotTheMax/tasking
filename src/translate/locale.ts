import type { InterfaceLanguage } from "../config/config-types.js";
import { EXACT, PATTERNS } from "./dict.js";

const HAN = /[\u4e00-\u9fff]/;
const WARN_CAP = 200;

let locale: InterfaceLanguage = "zh";
let warnLogger: ((message: string) => void) | null = null;
const warned = new Set<string>();

export type TranslateWarnLogger = (message: string) => void;

export function getLocale(): InterfaceLanguage {
  return locale;
}

export function setLocale(next: InterfaceLanguage): void {
  locale = next;
}

export function setTranslateWarnLogger(logger: TranslateWarnLogger | null): void {
  warnLogger = logger;
}

export function resetTranslateWarned(): void {
  warned.clear();
}

export function translate(text: string): string {
  if (locale === "zh") return text;
  const out = translateRaw(text);
  maybeWarn(text, out);
  return out;
}

function translateRaw(text: string): string {
  const whole = EXACT[text];
  if (whole !== undefined) {
    return whole;
  }
  const full = matchPattern(text);
  if (full !== null) {
    return full;
  }
  if (text.includes("\n")) {
    return text
      .split("\n")
      .map((line) => translateSingle(line))
      .join("\n");
  }
  return translateSingle(text);
}

function matchPattern(text: string): string | null {
  for (const rule of PATTERNS) {
    if (rule.re.test(text)) return text.replace(rule.re, rule.en);
  }
  return null;
}

function translateSingle(line: string): string {
  const exact = EXACT[line];
  if (exact !== undefined) return exact;
  const matched = matchPattern(line);
  if (matched !== null) return matched;
  return line;
}

function maybeWarn(original: string, translated: string): void {
  if (locale !== "en") return;
  if (!HAN.test(translated)) return;
  if (warned.has(original)) return;
  if (warned.size >= WARN_CAP) return;
  warned.add(original);
  let hash = 5381;
  for (let i = 0; i < original.length; i++) {
    hash = ((hash << 5) + hash + (original.charCodeAt(i) & 0xffff)) >>> 0;
  }
  warnLogger?.(
    `translate: untranslated Han in outbound text (${original.length} chars, hash ${hash.toString(16)})`,
  );
}

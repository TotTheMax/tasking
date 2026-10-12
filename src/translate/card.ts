import { translate } from "./locale.js";

const PROTOCOL_KEYS = new Set(["value", "tag", "url", "callback_key", "block_id", "i18n_code"]);

export function translateCard(node: unknown): unknown {
  if (typeof node === "string") return translate(node);
  if (Array.isArray(node)) return node.map(translateCard);
  if (typeof node === "object" && node !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node)) {
      out[key] = PROTOCOL_KEYS.has(key) ? val : translateCard(val);
    }
    return out;
  }
  return node;
}

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

function isWide(code: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

export function truncateToWidth(text: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  const total = displayWidth(text);
  if (total <= width) return text;
  const budget = Math.max(0, width - displayWidth(ellipsis));
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return `${out}${ellipsis}`;
}

export function wrapToWidth(text: string, width: number): string[] {
  if (width <= 0 || text.length === 0) return [];
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    let used = 0;
    for (const ch of rawLine) {
      const w = displayWidth(ch);
      if (used + w > width && line.length > 0) {
        lines.push(line.trimEnd());
        line = "";
        used = 0;
        if (ch === " ") continue;
      }
      line += ch;
      used += w;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

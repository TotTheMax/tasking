const INTERP = /\$\{[^}]*\}/g;
const PLACEHOLDER = "\u0000";
const PLACEHOLDER_RUN = new RegExp(`${PLACEHOLDER}+`, "g");
const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;
const UNESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "`": "`",
};

export function escapeRegExp(text: string): string {
  return text.replace(REGEX_ESCAPE, "\\$&");
}

export function unescapeLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const rep = UNESCAPES[raw[i + 1] ?? ""];
      if (rep !== undefined) {
        out += rep;
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

export function normalizeTemplate(template: string): string {
  const marked = template.replace(INTERP, PLACEHOLDER);
  const collapsed = marked.replace(PLACEHOLDER_RUN, PLACEHOLDER);
  return escapeRegExp(collapsed).replaceAll(PLACEHOLDER, "(.*)");
}

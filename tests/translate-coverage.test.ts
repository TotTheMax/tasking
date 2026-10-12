import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EXACT, PATTERNS } from "../src/translate/dict.js";
import { normalizeTemplate, unescapeLiteral } from "../src/translate/normalize.js";

const HAN = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

const WHITELIST = new Set(["via 飞书", "${c.name}（${c.chat_id}）"]);
const WHITELIST_REASONS: Record<string, string> = {
  "via 飞书":
    "protocol string: legacy sentinel inside SENTINEL_PREFIX's dual matcher, never translated",
  "${c.name}（${c.chat_id}）":
    "CLI-only init group-picker formatting; its wildcard-heavy frame would collide with user content containing full-width parens",
};

interface Literal {
  file: string;
  line: number;
  text: string;
  interpolated: boolean;
}

function scanLiterals(src: string): Array<{ text: string; line: number; interpolated: boolean }> {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
  const found: Array<{ text: string; line: number; interpolated: boolean }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      const staticText = node.head.text + node.templateSpans.map((sp) => sp.literal.text).join("");
      if (HAN.test(staticText)) {
        const text = unescapeLiteral(src.slice(node.getStart() + 1, node.getEnd() - 1));
        found.push({
          text,
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          interpolated: true,
        });
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = unescapeLiteral(src.slice(node.getStart() + 1, node.getEnd() - 1));
      found.push({
        text,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        interpolated: false,
      });
    } else if (ts.isStringLiteral(node)) {
      found.push({
        text: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        interpolated: false,
      });
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

function extractLiterals(src: string, file: string): Literal[] {
  return scanLiterals(src)
    .filter((l) => HAN.test(l.text))
    .map((l) => ({ file, line: l.line, text: l.text, interpolated: l.interpolated }));
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      const rel = full.split("src/").pop() ?? full;
      if (rel === join("translate", "dict.ts")) continue;
      files.push(full);
    }
  }
  return files;
}

function patternRegexes(): RegExp[] {
  return PATTERNS.map((p) => p.re);
}

function isCovered(lit: Literal, patternRegexes: RegExp[]): boolean {
  if (WHITELIST.has(lit.text)) return true;
  if (lit.interpolated) {
    const want = new RegExp(`^${normalizeTemplate(lit.text)}$`).source;
    return patternRegexes.some((re) => re.source === want);
  }
  return EXACT[lit.text] !== undefined;
}

describe("literal scanner", () => {
  it("extracts Han literals after a regex containing quotes and backticks", () => {
    const src = [
      "const yamlScalar = (v) => /[:#[\\]{},&*!|>'\"%@`]|^\\s|\\s$/.test(v) ? v : v;",
      'output.write(`${style.statusIcon("ok")} 配置完成！`);',
      "const s = '列表加载失败';",
    ].join("\n");
    const lits = extractLiterals(src, "probe.ts").map((l) => l.text);
    expect(lits).toContain("列表加载失败");
    expect(lits.some((t) => t.includes("配置完成"))).toBe(true);
  });

  it("skips templates whose Han lives only inside expression string arguments", () => {
    const src = 'output.write(`${a("x")} ${translate("配置完成！")}`);';
    const lits = extractLiterals(src, "probe.ts").map((l) => l.text);
    expect(lits).toContain("配置完成！");
    expect(lits.some((t) => t.includes("${a("))).toBe(false);
  });
});

describe("translate dictionary coverage", () => {
  it("every Han string literal in src is covered by the dictionary or whitelist", () => {
    const srcDir = join(import.meta.dirname, "..", "src");
    const literals = walk(srcDir).flatMap((f) =>
      extractLiterals(readFileSync(f, "utf8"), f.split("src/").pop() ?? f),
    );
    const patterns = patternRegexes();
    for (const entry of WHITELIST) {
      expect(WHITELIST_REASONS[entry], `whitelist entry without reason: ${entry}`).toBeTruthy();
    }
    const uncovered = literals.filter((l) => !isCovered(l, patterns));
    const report = uncovered.map((l) => `${l.file}:${l.line} ${l.text}`).join("\n");
    expect(uncovered, `uncovered Han literals (${uncovered.length}):\n${report}`).toHaveLength(0);
  });

  it("every dictionary exact key contains CJK (no stale entries)", () => {
    for (const key of Object.keys(EXACT)) {
      expect(CJK.test(key), `EXACT key without CJK: ${key}`).toBe(true);
    }
  });
});

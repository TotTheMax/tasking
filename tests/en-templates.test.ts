import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/config/config-types.js";
import { parseWorkflowContent } from "../src/config/loader.js";
import { resolveConfig } from "../src/config/resolver.js";

const ROOT = process.cwd();

const PAIRS = [
  {
    zh: "assets/workflows/WORKFLOW.minimal.md.example",
    en: "assets/workflows/WORKFLOW.minimal.en.md.example",
    variant: "minimal",
  },
  {
    zh: "assets/workflows/WORKFLOW.feishu-direct.md.example",
    en: "assets/workflows/WORKFLOW.feishu-direct.en.md.example",
    variant: "feishu-direct",
  },
  {
    zh: "assets/workflows/WORKFLOW.code-mr.md.example",
    en: "assets/workflows/WORKFLOW.code-mr.en.md.example",
    variant: "code-mr",
  },
  {
    zh: "assets/workflows/WORKFLOW.grill-openspec.md.example",
    en: "assets/workflows/WORKFLOW.grill-openspec.en.md.example",
    variant: "grill-openspec",
  },
] as const;

const EN_LANG_MARKER = "<!-- tasking-workflow-lang: en -->";
const CODE_MR_MARKER = "<!-- tasking-workflow: code-mr -->";
const GRILL_MARKER = "## 🔍 拷问 / Grill Questions";

function yamlKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      out.push(...yamlKeys(val, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

function defaultLeafPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return prefix ? [prefix] : [];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([key, value]) =>
    defaultLeafPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

function hasPath(obj: unknown, path: string): boolean {
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return false;
    const record = current as Record<string, unknown>;
    if (!(segment in record)) return false;
    current = record[segment];
  }
  return true;
}

function liquidExpressions(body: string): string[] {
  const matches = body.match(/\{\{[^}]*\}\}|\{%[^%]*%\}/g);
  return (matches ?? []).sort();
}

function splitTemplate(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/^\uFEFF/, "");
  const end = normalized.indexOf("\n---", 3);
  expect(end).toBeGreaterThan(0);
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(normalized.indexOf("\n", end + 1) + 1),
  };
}

describe("english workflow templates (TAS-19)", () => {
  for (const pair of PAIRS) {
    describe(`${pair.variant}`, () => {
      it("en template exists and carries the language sentinel at the top of the body", () => {
        const content = readFileSync(join(ROOT, pair.en), "utf8");
        const { body } = splitTemplate(content);
        const firstBodyLine = body
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l !== "");
        expect(firstBodyLine).toBe(EN_LANG_MARKER);
      });

      it("en template frontmatter declares the same YAML keys as zh", () => {
        const zh = parseWorkflowContent(readFileSync(join(ROOT, pair.zh), "utf8"), pair.zh);
        const en = parseWorkflowContent(readFileSync(join(ROOT, pair.en), "utf8"), pair.en);
        expect(yamlKeys(en.config)).toEqual(yamlKeys(zh.config));
      });

      it("en template prompt body uses the same Liquid expressions as zh", () => {
        const zhBody = splitTemplate(readFileSync(join(ROOT, pair.zh), "utf8")).body;
        const enBody = splitTemplate(readFileSync(join(ROOT, pair.en), "utf8")).body;
        expect(liquidExpressions(enBody)).toEqual(liquidExpressions(zhBody));
      });

      it("protocol sentinels are byte-identical across languages", () => {
        const zh = readFileSync(join(ROOT, pair.zh), "utf8");
        const en = readFileSync(join(ROOT, pair.en), "utf8");
        expect(zh.includes(CODE_MR_MARKER)).toBe(pair.variant === "code-mr");
        expect(en.includes(CODE_MR_MARKER)).toBe(pair.variant === "code-mr");
        expect(zh.includes(GRILL_MARKER)).toBe(pair.variant === "grill-openspec");
        expect(en.includes(GRILL_MARKER)).toBe(pair.variant === "grill-openspec");
      });

      it("shipped feishu.direct block parses to a valid empty config", () => {
        for (const file of [pair.zh, pair.en]) {
          const def = parseWorkflowContent(readFileSync(join(ROOT, file), "utf8"), file);
          const cfg = resolveConfig(def.config, ROOT, def.prompt_template);
          expect(cfg.feishu.direct.enabled).toBe(true);
          expect(cfg.feishu.direct.projects).toEqual({});
          expect(cfg.feishu.direct.path_roots).toEqual([]);
          expect(cfg.feishu.direct.verbosity).toBe("detailed");
          expect(cfg.feishu.direct.max_concurrent).toBe(5);
          expect(cfg.feishu.direct.idle_ttl_ms).toBe(2592000000);
        }
      });

      it("credential guidance permits plaintext in both languages", () => {
        const zh = readFileSync(join(ROOT, pair.zh), "utf8");
        const en = readFileSync(join(ROOT, pair.en), "utf8");
        expect(zh).toContain("可明文");
        expect(en).toContain("Plaintext or a $VAR env reference both work.");
      });

      it("feishu-direct bodies are note-only in both languages", () => {
        if (pair.variant !== "feishu-direct") return;
        const zh = splitTemplate(readFileSync(join(ROOT, pair.zh), "utf8")).body;
        const en = splitTemplate(readFileSync(join(ROOT, pair.en), "utf8")).body;
        for (const body of [zh, en]) {
          expect(body).toContain("<!-- tasking-workflow: feishu-direct -->");
          expect(body).not.toMatch(/\{\{|\{%/);
          expect(body).not.toContain("ADR");
        }
        const firstEn = en
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l !== "");
        expect(firstEn).toBe(EN_LANG_MARKER);
      });
    });
  }
});

describe("shipped workflow templates cover the config defaults", () => {
  it("every DEFAULTS.feishu key exists in all templates (drift reminders cannot silently skip a new field)", () => {
    const expected = defaultLeafPaths(DEFAULTS.feishu);
    expect(expected).toContain("direct.max_concurrent");
    for (const pair of PAIRS) {
      for (const file of [pair.zh, pair.en]) {
        const def = parseWorkflowContent(readFileSync(join(ROOT, file), "utf8"), file);
        const feishu = (def.config.feishu as Record<string, unknown>) ?? {};
        const missing = expected.filter((path) => !hasPath(feishu, path));
        expect(missing, `${file} is missing feishu keys: ${missing.join(", ")}`).toEqual([]);
      }
    }
  });
});

describe("templates carry no stale 'default' variant prose", () => {
  it.each([
    "assets/workflows/WORKFLOW.minimal.md.example",
    "assets/workflows/WORKFLOW.minimal.en.md.example",
    "assets/workflows/WORKFLOW.feishu-direct.md.example",
    "assets/workflows/WORKFLOW.feishu-direct.en.md.example",
    "assets/workflows/WORKFLOW.code-mr.md.example",
    "assets/workflows/WORKFLOW.grill-openspec.md.example",
  ])("%s", (file) => {
    const content = readFileSync(join(ROOT, file), "utf8");
    expect(content).not.toMatch(/默认 default|最小 default|[Mm]inimal default|the minimal default/);
  });
});

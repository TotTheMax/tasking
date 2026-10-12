import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const SKIP_DIRS = new Set(["node_modules", ".git", ".vitepress", "dist", "public", "coverage"]);

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...listMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

const docsDir = join(repoRoot, "docs");
const zhDir = join(docsDir, "zh");
const enDir = join(docsDir, "en");

const docFiles = listMarkdownFiles(docsDir);
const rootFiles = [
  join(repoRoot, "README.md"),
  join(repoRoot, "README.zh-CN.md"),
  join(repoRoot, "CONTEXT.md"),
];
const scannedFiles = [...docFiles, ...rootFiles].filter(existsSync);

function stripCode(src: string): string {
  const noFenced = src.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
  return noFenced.replace(/`[^`\n]+`/g, "");
}

function isLocalLink(target: string): boolean {
  const t = target.trim();
  if (!t) return false;
  if (t.startsWith("#")) return false;
  if (t.startsWith("<")) return false;
  if (t.startsWith("//")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t)) return false;
  return true;
}

interface BrokenLink {
  file: string;
  target: string;
  resolved: string;
}

function collectBrokenLinks(): BrokenLink[] {
  const broken: BrokenLink[] = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  for (const file of scannedFiles) {
    const raw = readFileSync(file, "utf8");
    const stripped = stripCode(raw);
    for (const match of stripped.matchAll(linkRe)) {
      const target = match[2];
      if (!isLocalLink(target)) continue;
      const url = target.trim().replace(/^<|>$/g, "").split(/\s+/)[0];
      const withoutFragment = url.split("#")[0];
      if (!withoutFragment) continue;
      const resolved = resolve(dirname(file), withoutFragment);
      if (!existsSync(resolved)) {
        broken.push({ file, target, resolved });
      }
    }
  }
  return broken;
}

function relNames(dir: string): Set<string> {
  return new Set(listMarkdownFiles(dir).map((f) => relative(dir, f)));
}

describe("docs internal link integrity", () => {
  it("docs/zh/getting-started.md exists", () => {
    expect(existsSync(join(zhDir, "getting-started.md"))).toBe(true);
  });

  it("zh and en doc sets have filename parity (bilingual parity)", () => {
    const zh = relNames(zhDir);
    const en = relNames(enDir);
    expect(zh.size, "zh doc set must be non-empty").toBeGreaterThan(0);
    expect(en.size, "en doc set must be non-empty").toBeGreaterThan(0);
    const missingInEn = [...zh].filter((n) => !en.has(n)).sort();
    const missingInZh = [...en].filter((n) => !zh.has(n)).sort();
    const report = `bilingual parity broken:\n  missing in en: ${missingInEn.join(", ") || "(none)"}\n  missing in zh: ${missingInZh.join(", ") || "(none)"}`;
    expect({ missingInEn, missingInZh }, report).toEqual({ missingInEn: [], missingInZh: [] });
  });

  it("all local relative markdown links resolve to existing files", () => {
    const broken = collectBrokenLinks();
    const report = broken
      .map(
        (b) =>
          `  ${relative(repoRoot, b.file)} -> ${b.target} (resolved: ${relative(repoRoot, b.resolved) || b.resolved})`,
      )
      .join("\n");
    expect(broken, `broken local links:\n${report}`).toEqual([]);
  });

  it("scanned a non-empty set of docs", () => {
    expect(scannedFiles.length).toBeGreaterThan(0);
    for (const f of scannedFiles) expect(statSync(f).isFile()).toBe(true);
  });
});

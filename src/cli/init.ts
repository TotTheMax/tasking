import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  type ProbeItem,
  type ProbeStatus,
  consoleLinks,
  crossRegionHint,
  feishuApiBase,
  probeListChats,
  probeListMessages,
  probeTail,
} from "../adapters/feishu/probe.js";
import {
  createBotChat,
  fetchTenantTokenFor,
  lookupFeishuUserId,
} from "../adapters/feishu/source.js";
import { JiraTracker } from "../adapters/jira/tracker.js";
import { DEFAULTS, type FeishuEdition, type TrackerConfig } from "../config/config-types.js";
import { parseWorkflowContent } from "../config/loader.js";
import { expandHome } from "../config/resolver.js";
import { toTaskingError } from "../shared/errors.js";
import type { WorkflowDefinition } from "../shared/types.js";
import { setLocale, translate } from "../translate/locale.js";
import { translatingWritable } from "../translate/output.js";
import { type PromptInterface, createPromptInterface } from "./prompts.js";
import { type Style, createStyle } from "./style.js";
import { type ResolvedWorkflowPath, resolveWorkflowPathOrReport } from "./workflow-path.js";

const EXAMPLE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.minimal.md.example",
);

const EXAMPLE_FILE_CODE_MR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.code-mr.md.example",
);

const EXAMPLE_FILE_GRILL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.grill-openspec.md.example",
);

const EXAMPLE_FILE_EN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.minimal.en.md.example",
);

const EXAMPLE_FILE_CODE_MR_EN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.code-mr.en.md.example",
);

const EXAMPLE_FILE_GRILL_EN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.grill-openspec.en.md.example",
);

const EXAMPLE_FILE_FEISHU_DIRECT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.feishu-direct.md.example",
);

const EXAMPLE_FILE_FEISHU_DIRECT_EN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "workflows",
  "WORKFLOW.feishu-direct.en.md.example",
);

const CODE_MR_MARKER = "<!-- tasking-workflow: code-mr -->";
const FEISHU_DIRECT_MARKER = "<!-- tasking-workflow: feishu-direct -->";
const GRILL_MARKER = "## 🔍 拷问 / Grill Questions";
const EN_LANG_MARKER = "<!-- tasking-workflow-lang: en -->";
const DIFF_PRINT_LIMIT = 50;

export type WorkflowVariant = "minimal" | "code-mr" | "grill-openspec" | "feishu-direct";

export const SUPPORTED_WORKFLOWS: readonly WorkflowVariant[] = [
  "minimal",
  "code-mr",
  "grill-openspec",
  "feishu-direct",
];

export type TemplateLanguage = "zh" | "en";

export const SUPPORTED_LANGUAGES: readonly TemplateLanguage[] = ["zh", "en"];

function resolveExampleFile(workflow: WorkflowVariant, lang: TemplateLanguage): string {
  if (workflow === "feishu-direct") {
    return lang === "en" ? EXAMPLE_FILE_FEISHU_DIRECT_EN : EXAMPLE_FILE_FEISHU_DIRECT;
  }
  if (lang === "en") {
    if (workflow === "grill-openspec") return EXAMPLE_FILE_GRILL_EN;
    if (workflow === "code-mr") return EXAMPLE_FILE_CODE_MR_EN;
    return EXAMPLE_FILE_EN;
  }
  if (workflow === "grill-openspec") return EXAMPLE_FILE_GRILL;
  if (workflow === "code-mr") return EXAMPLE_FILE_CODE_MR;
  return EXAMPLE_FILE;
}

function normalizeWorkflow(value: string | undefined): WorkflowVariant | "invalid" {
  if (value === undefined || value === "") return "feishu-direct";
  if (
    value === "minimal" ||
    value === "code-mr" ||
    value === "grill-openspec" ||
    value === "feishu-direct"
  ) {
    return value;
  }
  return "invalid";
}

function normalizeLang(value: string | undefined): TemplateLanguage | "invalid" {
  if (value === undefined || value === "") return "zh";
  if (value === "zh" || value === "en") return value;
  return "invalid";
}

const ASSETS_SKILLS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "skills",
);

interface SkillSource {
  name: string;
  files: string[];
}

const LAND_SKILL: SkillSource = { name: "land", files: ["SKILL.md", "land_watch.py"] };
const INSTALL_GLAB_SKILL: SkillSource = { name: "install-glab", files: ["SKILL.md"] };
const OPSX_SKILLS: SkillSource[] = [
  { name: "opsx-grill-with-docs", files: ["SKILL.md"] },
  { name: "opsx-propose-with-tdd", files: ["SKILL.md"] },
  { name: "opsx-implement", files: ["SKILL.md"] },
  { name: "openspec-archive-change", files: ["SKILL.md"] },
];

function skillsForWorkflow(workflow: WorkflowVariant): SkillSource[] {
  if (workflow === "minimal" || workflow === "feishu-direct") return [];
  const base = [LAND_SKILL, INSTALL_GLAB_SKILL];
  return workflow === "grill-openspec" ? [...base, ...OPSX_SKILLS] : base;
}

function copySkills(
  wfDir: string,
  workflow: WorkflowVariant,
  log: (status: "ok" | "info" | "fail", message: string) => void,
): void {
  for (const skill of skillsForWorkflow(workflow)) {
    const destDir = join(wfDir, ".opencode", "skills", skill.name);
    if (existsSync(destDir)) {
      log("info", `${skill.name} already installed`);
      continue;
    }
    try {
      mkdirSync(destDir, { recursive: true });
      let copied = false;
      for (const file of skill.files) {
        const src = join(ASSETS_SKILLS_DIR, skill.name, file);
        if (!existsSync(src)) continue;
        copyFileSync(src, join(destDir, file));
        copied = true;
      }
      log(
        copied ? "ok" : "fail",
        copied ? `${skill.name} installed` : `${skill.name} source missing`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("fail", `${skill.name} copy failed: ${msg}`);
    }
  }
}

export interface InitOptions {
  force: boolean;
  nonInteractive?: boolean;
  workflow?: string;
  lang?: string;
  update?: boolean;
  restore?: boolean;
  workflowPath?: string;
  input?: Readable;
  output?: Writable;
  fetchImpl?: typeof fetch;
  promptInterface?: PromptInterface;
}

interface CollectedCredentials {
  endpoint: string;
  api_key: string;
  auth_mode: "basic" | "bearer";
  api_user: string | null;
  project_key: string;
}

interface CollectedFeishu {
  edition: FeishuEdition;
  app_id: string;
  app_secret: string | null;
  intake_chat_id: string;
  create_issue_type: string | null;
  project: { name: string; path: string } | null;
}

export async function runInit(cwd: string, opts: InitOptions): Promise<number> {
  const modeCount = [opts.force, opts.update ?? false, opts.restore ?? false].filter(
    Boolean,
  ).length;
  if (modeCount > 1) {
    const errOutput = opts.output ?? process.stderr;
    errOutput.write("--force, --update, and --restore are mutually exclusive\n");
    return 1;
  }

  const resolved = resolveWorkflowPathOrReport(cwd, opts.workflowPath, (message) =>
    (opts.output ?? process.stderr).write(`${message}\n`),
  );
  if (resolved === null) return 1;
  const wfPath = resolved.path;

  if (opts.update) {
    return runUpdate(resolved, opts.output ?? process.stdout, opts.workflow, opts.lang);
  }

  if (opts.restore) {
    if (opts.workflowPath !== undefined && !existsSync(wfPath)) {
      (opts.output ?? process.stderr).write(
        `error: ${resolved.name} not found at ${wfPath}. Run 'tasking init' first.\n`,
      );
      return 1;
    }
    return runRestore(resolved, opts.output ?? process.stdout);
  }

  const workflow = normalizeWorkflow(opts.workflow);
  if (workflow === "invalid") {
    console.error(
      `unknown workflow: ${opts.workflow}. Supported values: ${SUPPORTED_WORKFLOWS.join(", ")}`,
    );
    return 1;
  }

  const lang = normalizeLang(opts.lang);
  if (lang === "invalid") {
    console.error(
      `unknown language: ${opts.lang}. Supported values: ${SUPPORTED_LANGUAGES.join(", ")}`,
    );
    return 1;
  }

  if (existsSync(wfPath) && !opts.force) {
    console.error(`${resolved.name} already exists at ${wfPath}. Use --force to overwrite.`);
    return 1;
  }

  mkdirSync(dirname(wfPath), { recursive: true });

  const isTTY = opts.input
    ? Boolean((opts.input as { isTTY?: boolean }).isTTY)
    : Boolean(process.stdin.isTTY);
  const interactive = (!opts.nonInteractive && isTTY) || Boolean(opts.promptInterface);

  if (!interactive) {
    setLocale(lang === "en" ? "en" : "zh");
    const output = translatingWritable(opts.output ?? process.stdout);
    return runNonInteractiveInit(wfPath, output, workflow, lang);
  }

  const input = opts.input ?? process.stdin;
  const output = translatingWritable(opts.output ?? process.stdout);
  return runInteractiveInit(
    wfPath,
    input,
    output,
    opts.fetchImpl,
    opts.promptInterface,
    opts.workflow,
    opts.lang,
  );
}

function backupExistingWorkflow(wfPath: string): string | null {
  if (!existsSync(wfPath)) return null;
  const backupPath = `${wfPath}.bak`;
  copyFileSync(wfPath, backupPath);
  return backupPath;
}

function runNonInteractiveInit(
  wfPath: string,
  output: Writable,
  workflow: WorkflowVariant,
  lang: TemplateLanguage,
): number {
  const style = createStyle(false);
  const content = generateWorkflowContent(null, workflow, null, lang);
  const backupPath = backupExistingWorkflow(wfPath);
  writeFileSync(wfPath, content, "utf8");

  copySkill(dirname(wfPath), output, workflow);

  const wsRoot = resolve(homedir(), "tasking_workspaces");
  if (!existsSync(wsRoot)) {
    mkdirSync(wsRoot, { recursive: true });
  }

  output.write(`${style.statusIcon("ok")} tasking initialized\n`);
  if (backupPath) {
    output.write(
      `${style.statusIcon("warn")} existing ${basename(wfPath)} backed up to ${backupPath}\n`,
    );
  }
  output.write(`  Config file:    ${wfPath}\n`);
  output.write(`  Workflow:        ${workflow}\n`);
  output.write(`  Language:        ${lang}\n`);
  output.write(`  Workspace root: ${wsRoot}\n`);
  const skillsPath = join(dirname(wfPath), ".opencode", "skills");
  output.write(`  Skills dir:     ${skillsPath}\n`);
  if (workflow === "feishu-direct") {
    output.write(
      "  Feishu:          enabled (direct-only); fill app_id/app_secret/intake_chat_id in WORKFLOW.md\n" +
        "                   guide: docs/feishu-quickstart.md\n",
    );
  } else {
    output.write(
      "  Feishu bridge:  disabled; enable & configure in WORKFLOW.md feishu: block (docs/feishu-quickstart.md)\n",
    );
  }
  return 0;
}

function detectWorkflow(body: string): WorkflowVariant {
  if (body.includes(FEISHU_DIRECT_MARKER)) return "feishu-direct";
  if (body.includes(GRILL_MARKER)) return "grill-openspec";
  if (body.includes(CODE_MR_MARKER)) return "code-mr";
  return "minimal";
}

function detectTemplateLanguage(content: string): TemplateLanguage {
  return content.includes(EN_LANG_MARKER) ? "en" : "zh";
}

function runUpdate(
  resolved: ResolvedWorkflowPath,
  output: Writable,
  workflowRaw: string | undefined,
  langRaw: string | undefined,
): number {
  const { path: wfPath, dir: wfDir, name } = resolved;
  if (!existsSync(wfPath)) {
    output.write(`error: ${name} not found at ${wfPath}. Run 'tasking init' first.\n`);
    return 1;
  }

  const style = createStyle(false);
  const userContent = readFileSync(wfPath, "utf8");

  let workflow: WorkflowVariant;
  if (workflowRaw !== undefined) {
    const normalized = normalizeWorkflow(workflowRaw);
    if (normalized === "invalid") {
      output.write(
        `error: unknown workflow: ${workflowRaw}. Supported values: ${SUPPORTED_WORKFLOWS.join(", ")}\n`,
      );
      return 1;
    }
    workflow = normalized;
  } else {
    workflow = detectWorkflow(parseWorkflowContent(userContent, wfPath).prompt_template);
  }

  let lang: TemplateLanguage;
  if (langRaw !== undefined) {
    const normalizedLang = normalizeLang(langRaw);
    if (normalizedLang === "invalid") {
      output.write(
        `error: unknown language: ${langRaw}. Supported values: ${SUPPORTED_LANGUAGES.join(", ")}\n`,
      );
      return 1;
    }
    lang = normalizedLang;
  } else {
    lang = detectTemplateLanguage(userContent);
  }

  output.write(`${style.statusIcon("info")} Workflow: ${workflow}`);
  if (workflowRaw !== undefined) {
    output.write(" (explicit --workflow)");
  } else {
    output.write(" (detected from WORKFLOW.md sentinel markers)");
  }
  output.write("\n");
  output.write(`${style.statusIcon("info")} Template language: ${lang}`);
  if (langRaw !== undefined) {
    output.write(" (explicit --lang)");
  } else {
    output.write(" (detected from WORKFLOW.md sentinel marker)");
  }
  output.write("\n");

  const synced = syncAllSkills(wfDir, output, style, workflow);
  output.write("\n");
  reportWorkflowDrift(resolved, output, style, workflow, lang);

  output.write("\n");
  output.write(`${style.statusIcon("ok")} skills updated`);
  if (synced.updated > 0) {
    output.write(` (${synced.updated} updated, backups in .opencode/skills/<name>/<file>.bak)`);
  }
  output.write("\n");
  output.write(`  ${name} untouched — reconcile any listed fields/diff manually\n`);
  return 0;
}

function runRestore(resolved: ResolvedWorkflowPath, output: Writable): number {
  const { path: wfPath, dir: wfDir } = resolved;
  const wfBak = `${wfPath}.bak`;
  if (existsSync(wfBak)) {
    renameSync(wfBak, wfPath);
    output.write(`restored ${wfPath}\n`);
  }

  const skillsRoot = join(wfDir, ".opencode", "skills");
  if (!existsSync(skillsRoot)) {
    output.write("no skill backups found\n");
    return 0;
  }

  const backups = collectBackupFiles(skillsRoot);
  if (backups.length === 0) {
    output.write("no skill backups found\n");
    return 0;
  }

  for (const bak of backups) {
    const original = bak.replace(/\.bak$/, "");
    renameSync(bak, original);
    output.write(`restored ${original}\n`);
  }
  return 0;
}

function syncAllSkills(
  wfDir: string,
  output: Writable,
  style: Style,
  workflow: WorkflowVariant,
): { installed: number; updated: number; skipped: number } {
  const result = { installed: 0, updated: 0, skipped: 0 };
  for (const skill of skillsForWorkflow(workflow)) {
    const destDir = join(wfDir, ".opencode", "skills", skill.name);
    for (const file of skill.files) {
      const src = join(ASSETS_SKILLS_DIR, skill.name, file);
      const dest = join(destDir, file);
      if (!existsSync(src)) {
        output.write(`${style.statusIcon("fail")} ${skill.name}/${file} source missing\n`);
        continue;
      }
      if (!existsSync(dest)) {
        try {
          mkdirSync(destDir, { recursive: true });
          copyFileSync(src, dest);
          result.installed++;
          output.write(`${style.statusIcon("ok")} ${skill.name}/${file} installed\n`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          output.write(
            `${style.statusIcon("fail")} ${skill.name}/${file} install failed: ${msg}\n`,
          );
        }
        continue;
      }
      if (filesEqual(src, dest)) {
        result.skipped++;
        output.write(`${style.statusIcon("info")} ${skill.name}/${file} up to date\n`);
        continue;
      }
      try {
        copyFileSync(dest, `${dest}.bak`);
        copyFileSync(src, dest);
        result.updated++;
        output.write(
          `${style.statusIcon("warn")} ${skill.name}/${file} updated (backup: ${relPath(wfDir, `${dest}.bak`)})\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`${style.statusIcon("fail")} ${skill.name}/${file} update failed: ${msg}\n`);
      }
    }
  }
  return result;
}

function filesEqual(a: string, b: string): boolean {
  return readFileSync(a).equals(readFileSync(b));
}

function relPath(root: string, target: string): string {
  const rel = target.startsWith(root) ? target.slice(root.length + 1) : target;
  return rel.replace(/\\/g, "/");
}

function reportWorkflowDrift(
  resolved: ResolvedWorkflowPath,
  output: Writable,
  style: Style,
  workflow: WorkflowVariant,
  lang: TemplateLanguage,
): void {
  const { path: wfPath, dir: wfDir, name } = resolved;
  const templatePath = resolveExampleFile(workflow, lang);
  let user: WorkflowDefinition;
  let template: WorkflowDefinition;
  let baselineConfig: Record<string, unknown>;
  try {
    user = parseWorkflowContent(readFileSync(wfPath, "utf8"), wfPath);
    const templateRaw = readFileSync(templatePath, "utf8");
    template = parseWorkflowContent(templateRaw, templatePath);
    const userFeishuEnabled =
      isPlainRecord(user.config.feishu) && user.config.feishu.enabled === true;
    const baseline = applyTemplateTrimming(
      templateRaw,
      workflow,
      feishuSectionActive(workflow, userFeishuEnabled),
      lang,
    );
    baselineConfig = parseWorkflowContent(baseline, templatePath).config;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(`${style.statusIcon("warn")} ${name} drift report skipped: ${msg}\n`);
    return;
  }

  const newFields: Array<{ path: string; value: unknown }> = [];
  collectNewConfigFields(baselineConfig, user.config, "", newFields);

  output.write("Config (fields missing vs a fresh init today — they fall back to DEFAULTS):\n");
  if (newFields.length === 0) {
    output.write("  no missing config fields\n");
  } else {
    for (const field of newFields) {
      const fallback = lookupDefaultValue(field.path);
      const value = fallback.found ? fallback.value : field.value;
      output.write(`  - ${field.path} (default: ${formatDefaultValue(value)})\n`);
    }
  }

  const diff = diffLines(template.prompt_template, user.prompt_template);
  output.write("Prompt body:\n");
  if (diff.length === 0) {
    output.write("  identical\n");
  } else {
    const shown = diff.length > DIFF_PRINT_LIMIT ? DIFF_PRINT_LIMIT : diff.length;
    for (let i = 0; i < shown; i++) {
      output.write(`  ${diff[i] ?? ""}\n`);
    }
    if (diff.length > DIFF_PRINT_LIMIT) {
      output.write(
        `  … ${diff.length - DIFF_PRINT_LIMIT} more changed lines (full diff in reference file below)\n`,
      );
    }
  }

  const ref = syncDriftReference(
    wfDir,
    templatePath,
    name,
    newFields.length > 0 || diff.length > 0,
  );
  if (ref) {
    output.write(`  Reference template: ${ref}\n`);
    output.write(
      `  See exact locations (full diff vs new template): git diff --no-index ${name} ${ref}\n`,
    );
  }
}

function lookupDefaultValue(path: string): { found: boolean; value: unknown } {
  let current: unknown = DEFAULTS;
  for (const segment of path.split(".")) {
    if (!isPlainRecord(current)) {
      return { found: false, value: undefined };
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) return { found: false, value: undefined };
    current = record[segment];
  }
  return { found: true, value: current };
}

function formatDefaultValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function syncDriftReference(
  wfDir: string,
  templatePath: string,
  baseName: string,
  hasDrift: boolean,
): string | null {
  const refPath = join(wfDir, ".tasking", `${baseName}.reference`);
  if (!hasDrift) {
    if (existsSync(refPath)) rmSync(refPath, { force: true });
    return null;
  }
  mkdirSync(dirname(refPath), { recursive: true });
  copyFileSync(templatePath, refPath);
  return relPath(wfDir, refPath);
}

function collectNewConfigFields(
  template: unknown,
  user: unknown,
  prefix: string,
  out: Array<{ path: string; value: unknown }>,
): void {
  if (!isPlainRecord(template)) return;
  const tpl = template;
  const usr = isPlainRecord(user) ? user : undefined;
  for (const [key, tval] of Object.entries(tpl)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const uval = usr?.[key];
    if (uval === undefined) {
      out.push({ path, value: tval });
      continue;
    }
    if (isPlainRecord(tval) && isPlainRecord(uval)) {
      collectNewConfigFields(tval, uval, path, out);
    }
  }
}

function diffLines(a: string, b: string): string[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = [];
  for (let i = n; i >= 0; i--) {
    const row = new Array<number>(m + 1).fill(0);
    if (i < n) {
      const aLine = aLines[i] ?? "";
      const next = dp[i + 1] ?? [];
      for (let j = m - 1; j >= 0; j--) {
        row[j] =
          aLine === (bLines[j] ?? "")
            ? (next[j + 1] ?? 0) + 1
            : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
      }
    }
    dp[i] = row;
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const aLine = aLines[i] ?? "";
    const bLine = bLines[j] ?? "";
    const next = dp[i + 1] ?? [];
    if (aLine === bLine) {
      i++;
      j++;
    } else if ((next[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push(`- ${aLine}`);
      i++;
    } else {
      out.push(`+ ${bLine}`);
      j++;
    }
  }
  while (i < n) {
    out.push(`- ${aLines[i] ?? ""}`);
    i++;
  }
  while (j < m) {
    out.push(`+ ${bLines[j] ?? ""}`);
    j++;
  }
  return out;
}

function collectBackupFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectBackupFiles(full));
    } else if (entry.name.endsWith(".bak")) {
      result.push(full);
    }
  }
  return result;
}

async function runInteractiveInit(
  wfPath: string,
  input: Readable,
  output: Writable,
  fetchImpl: typeof fetch | undefined,
  promptOverride: PromptInterface | undefined,
  workflowRaw: string | undefined,
  langRaw: string | undefined,
): Promise<number> {
  const useColor = Boolean((output as { isTTY?: boolean }).isTTY);
  const style = createStyle(useColor);

  const prompts = promptOverride ?? createPromptInterface(input, output, style);
  if (langRaw !== undefined) {
    setLocale(langRaw === "en" ? "en" : "zh");
  } else if (existsSync(wfPath)) {
    try {
      const existing = parseWorkflowContent(readFileSync(wfPath, "utf8"), wfPath);
      setLocale(existing.config.interface_language === "en" ? "en" : "zh");
    } catch {
      setLocale("zh");
    }
  }
  const workflow: WorkflowVariant =
    workflowRaw === undefined
      ? await selectTaskSource(prompts, output, style)
      : (workflowRaw as WorkflowVariant);
  const lang: TemplateLanguage =
    langRaw !== undefined
      ? (langRaw as TemplateLanguage)
      : await selectTemplateLanguage(prompts, output, style);
  setLocale(lang === "en" ? "en" : "zh");

  printPrerequisites(style, output, workflow !== "feishu-direct");

  let creds: CollectedCredentials | null = null;
  let feishuSetup: CollectedFeishu | null = null;
  let autoStates: AutoStates | null = null;
  if (workflow === "feishu-direct") {
    feishuSetup = await collectFeishuDirectConfig(prompts, output, style, fetchImpl, lang);
    if (!feishuSetup) {
      prompts.close();
      return 1;
    }
  } else {
    output.write(style.boxHeader("Jira Setup"));
    creds = await collectCredentials(prompts, output, style);
    output.write(style.boxFooter());
    if (!creds) {
      prompts.close();
      return 1;
    }

    const conn = await testJiraConnection(creds, fetchImpl, output, style);
    const issueTypes = conn.issueTypes;
    autoStates = await promptStateAutofill(conn.statuses, prompts, output, style, lang);
    feishuSetup = await collectFeishuConfig(prompts, output, style, issueTypes, fetchImpl, lang);
  }
  prompts.close();

  const content = generateWorkflowContent(creds, workflow, feishuSetup, lang, autoStates);
  const backupPath = backupExistingWorkflow(wfPath);
  writeFileSync(wfPath, content, "utf8");

  printInitialization(style, output, wfPath, workflow, lang);
  if (backupPath) {
    output.write(`${style.statusIcon("warn")} 原 ${basename(wfPath)} 已备份至 ${backupPath}\n`);
  }

  const editorOk = process.stdout.isTTY ? openEditor(wfPath) : false;
  printCompletionHint(
    output,
    style,
    editorOk,
    workflow,
    feishuSetup?.project?.name ?? null,
    autoStates !== null,
    lang,
  );

  return 0;
}

async function selectTaskSource(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
): Promise<WorkflowVariant> {
  output.write(style.boxHeader("任务来源"));
  output.write(
    style.boxLine(
      style.dim(
        "只用飞书直连：群里 /chat 直接跑 opencode，无需 Jira。接 Jira：调度器轮询 Jira issue 派发（三个变体）。",
      ),
    ),
  );
  const choice = await prompts.askSelect(`${style.bold("任务来源")}`, [
    { value: "feishu-direct", label: "只用飞书直连（默认）" },
    { value: "jira", label: "接 Jira" },
  ]);
  output.write(style.boxFooter());
  if (choice === "jira") return selectWorkflow(prompts, output, style);
  return "feishu-direct";
}

async function selectWorkflow(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
): Promise<WorkflowVariant> {
  output.write(style.boxHeader("Workflow"));
  output.write(
    style.boxLine(
      style.dim(
        "minimal: do the task in the workspace, upload results to Jira, transition to terminal. code-mr: write code & create a merge request. grill-openspec: grill → propose → implement → archive.",
      ),
    ),
  );
  const choice = await prompts.askSelect(`${style.bold("选择 Jira workflow 变体")}`, [
    { value: "minimal", label: "minimal" },
    { value: "code-mr", label: "code-mr" },
    { value: "grill-openspec", label: "grill-openspec" },
  ]);
  output.write(style.boxFooter());
  if (choice === "code-mr") return "code-mr";
  if (choice === "grill-openspec") return "grill-openspec";
  return "minimal";
}

async function selectTemplateLanguage(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
): Promise<TemplateLanguage> {
  output.write(style.boxHeader("Template Language"));
  output.write(
    style.boxLine(
      style.dim(
        "Language of the generated WORKFLOW.md comments and guidance. Press enter for 中文.",
      ),
    ),
  );
  const choice = await prompts.askSelect(`${style.bold("Template language")}`, [
    { value: "zh" as TemplateLanguage, label: "中文" },
    { value: "en" as TemplateLanguage, label: "English" },
  ]);
  output.write(style.boxFooter());
  return choice;
}

async function collectCredentials(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
): Promise<CollectedCredentials | null> {
  const endpoint = await prompts.ask(
    `${style.bold("Jira REST API endpoint")} (e.g. https://your-domain.atlassian.net/rest/api/3)`,
  );
  if (!endpoint) {
    output.write(style.boxLine(`${style.statusIcon("fail")} endpoint is required`));
    return null;
  }

  const api_key = await prompts.ask(
    `${style.bold("Jira API token")} (will be stored as $JIRA_API_KEY env var reference)`,
  );
  output.write(
    style.boxLine(
      style.dim(
        "Tip: export JIRA_API_KEY=<token> in ~/.bashrc, or set it in env: section of WORKFLOW.md",
      ),
    ),
  );

  const auth_mode = await prompts.askSelect(`${style.bold("Authentication mode")}`, [
    { value: "basic" as "basic" | "bearer", label: "basic" },
    { value: "bearer" as "basic" | "bearer", label: "bearer" },
  ]);

  let api_user: string | null = null;
  if (auth_mode === "basic") {
    api_user = await prompts.ask(`${style.bold("Jira username/email")} (required for basic auth)`);
  }

  const project_key = await prompts.ask(`${style.bold("Jira project key")} (e.g. ENG)`);
  if (!project_key) {
    output.write(style.boxLine(`${style.statusIcon("fail")} project_key is required`));
    return null;
  }

  return { endpoint, api_key, auth_mode, api_user, project_key };
}

interface JiraConnectionResult {
  issueTypes: string[];
  statuses: string[];
}

async function testJiraConnection(
  creds: CollectedCredentials,
  fetchImpl: typeof fetch | undefined,
  output: Writable,
  style: Style,
): Promise<JiraConnectionResult> {
  const config: TrackerConfig = {
    kind: "jira",
    endpoint: creds.endpoint,
    api_key: creds.api_key || process.env.JIRA_API_KEY || "",
    api_user: creds.api_user,
    auth_mode: creds.auth_mode,
    review_state: null,
    project_key: creds.project_key,
    project_slug: null,
    assignee: null,
    required_labels: [],
    active_states: [],
    terminal_states: [],
  };

  const tracker = new JiraTracker(config, fetchImpl);

  let version = "unknown";
  try {
    const info = await tracker.fetchServerInfo({ timeoutMs: 5000 });
    if (info && typeof info.version === "string") version = info.version;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(style.boxHeader("Connection Test"));
    output.write(style.boxLine(`${style.statusIcon("fail")} Jira connection test failed: ${msg}`));
    output.write(style.boxLine(style.dim(`    Endpoint: ${creds.endpoint}`)));
    output.write(style.boxLine(style.dim("    Common causes:")));
    output.write(
      style.boxLine(
        style.dim(
          "      - Wrong API version (Jira Server: /rest/api/2/, Jira Cloud: /rest/api/3/)",
        ),
      ),
    );
    output.write(
      style.boxLine(style.dim("      - Missing context path (e.g., http://host/jira/rest/api/2/)")),
    );
    output.write(style.boxLine(style.dim("      - Jira URL changed or is unreachable")));
    output.write(
      style.boxLine(
        style.dim("    You can fix credentials later and re-run 'tasking init --force'"),
      ),
    );
    output.write(style.boxFooter());
    return { issueTypes: [], statuses: [] };
  }

  output.write(style.boxHeader("Connection Test"));
  output.write(style.boxLine(`${style.statusIcon("ok")} Jira connection successful (v${version})`));

  let statuses: string[] = [];
  try {
    statuses = await tracker.fetchProjectStatuses({ timeoutMs: 5000 });
    if (statuses.length > 0) {
      output.write(style.boxLine("  Project statuses:"));
      for (const name of statuses) {
        output.write(style.boxLine(`  ${style.statusIcon("info")} ${name}`));
      }
      output.write(
        style.boxLine(
          style.dim("  Assign these to active_states/review_state/terminal_states in WORKFLOW.md"),
        ),
      );
    } else {
      output.write(style.boxLine("  No statuses found for this project."));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.write(
      style.boxLine(
        `${style.statusIcon("warn")} Project key '${creds.project_key}' test failed: ${msg}`,
      ),
    );
    output.write(style.boxLine(style.dim("    Check that:")));
    output.write(style.boxLine(style.dim("      - The project key is correct (case-sensitive)")));
    output.write(style.boxLine(style.dim("      - Your token has access to this project")));
    output.write(
      style.boxLine(
        style.dim("    You can fix credentials later and re-run 'tasking init --force'"),
      ),
    );
  }

  let issueTypes: string[] = [];
  try {
    issueTypes = await tracker.fetchIssueTypes({ timeoutMs: 5000 });
    if (issueTypes.length > 0) {
      output.write(style.boxLine("  Project issue types:"));
      for (const name of issueTypes) {
        output.write(style.boxLine(`  ${style.statusIcon("info")} ${name}`));
      }
      output.write(
        style.boxLine(style.dim("  Set feishu.create_issue_type to one of these in WORKFLOW.md")),
      );
    }
  } catch {}
  output.write(style.boxFooter());
  return { issueTypes, statuses };
}

function probeStatusIcon(style: Style, status: ProbeStatus): string {
  switch (status) {
    case "ok":
      return style.statusIcon("ok");
    case "missing":
      return style.statusIcon("fail");
    case "unknown":
      return style.statusIcon("warn");
    default:
      return style.statusIcon("info");
  }
}

function printProbeItem(output: Writable, style: Style, item: ProbeItem): void {
  const tail = item.hint !== null && item.status !== "ok" ? ` — ${translate(item.hint)}` : "";
  output.write(
    style.boxLine(
      `  ${probeStatusIcon(style, item.status)} ${translate(item.label)}（${item.scope}）${tail}`,
    ),
  );
}

function printNextStepLinks(
  output: Writable,
  style: Style,
  links: ReturnType<typeof consoleLinks>,
): void {
  output.write(
    style.boxLine(style.dim(`  下一步: 订阅事件 ${links.event} ｜ 发布版本 ${links.version}`)),
  );
}

async function pickOrCreateIntakeChat(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
  token: string,
  initialChats: Array<{ chat_id: string; name: string }>,
  appId: string,
  fetchImpl: typeof fetch | undefined,
  edition: FeishuEdition,
): Promise<string> {
  const CREATE_LABEL = "➕ 新建 intake 群（并拉你进群）";
  const REFRESH_LABEL = "⟳ 刷新群列表";
  const CREATE_VALUE = "__create__";
  const REFRESH_VALUE = "__refresh__";
  let chats = initialChats;
  for (;;) {
    const nameCounts = new Map<string, number>();
    for (const c of chats) nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
    const options = [
      { value: CREATE_VALUE, label: CREATE_LABEL },
      { value: REFRESH_VALUE, label: REFRESH_LABEL },
      ...chats.map((c) => ({
        value: c.chat_id,
        label: ((nameCounts.get(c.name) ?? 0) > 1 ? `${c.name}（${c.chat_id}）` : c.name) as string,
      })),
    ];
    const picked = await prompts.askSelect(`${style.bold("选择 intake 群")}`, options);
    if (picked === REFRESH_VALUE) {
      const { chats: refreshed } = await probeListChats(token, fetchImpl, appId, edition);
      if (refreshed !== null) chats = refreshed;
      output.write(style.boxLine(style.dim(`  已刷新（${chats.length} 个群）`)));
      continue;
    }
    if (picked === CREATE_VALUE) {
      const groupNameAnswer = await prompts.ask(
        `${style.bold("新群名称")}（回车默认 tasking-intake）`,
      );
      const groupName = groupNameAnswer === "" ? "tasking-intake" : groupNameAnswer;
      const inviteAnswer = await prompts.ask(
        `${style.bold("你的飞书邮箱或手机号")}（建群后拉你进群，需 contact:user.id:readonly；回车跳过）`,
      );
      let memberIds: string[] = [];
      if (inviteAnswer !== "") {
        const lookup = await lookupFeishuUserId(token, inviteAnswer, fetchImpl, edition);
        if (lookup.ok) {
          memberIds = [lookup.open_id];
          output.write(style.boxLine(`${style.statusIcon("ok")} 已定位你的账号，建群时拉你进群`));
        } else if (lookup.reason === "permission") {
          output.write(
            style.boxLine(
              `${style.statusIcon("warn")} 无法查询用户：缺 contact:user.id:readonly → 开通: ${consoleLinks(appId, edition).permission} （开通后需重新发布版本）`,
            ),
          );
        } else {
          output.write(style.boxLine(`${style.statusIcon("warn")} 查询用户失败：${lookup.detail}`));
        }
      }
      const created = await createBotChat(token, groupName, fetchImpl, memberIds, edition);
      if (created.ok) {
        if (memberIds.length > 0) {
          output.write(
            style.boxLine(
              `${style.statusIcon("ok")} 已建群并选用：${groupName}（${created.chat_id}）——你已在群里`,
            ),
          );
          return created.chat_id;
        }
        output.write(
          style.boxLine(
            `${style.statusIcon("warn")} 群已建（${created.chat_id}），但只有机器人成员——你在飞书看不到它，未选用`,
          ),
        );
        output.write(
          style.boxLine(
            style.dim(
              "  建议：在飞书手动建群并把 tasking 机器人拉进群，然后回来选「⟳ 刷新群列表」",
            ),
          ),
        );
        const { chats: refreshed } = await probeListChats(token, fetchImpl, appId, edition);
        if (refreshed !== null) chats = refreshed;
        continue;
      }
      output.write(style.boxLine(`${style.statusIcon("fail")} 建群失败：${created.detail}`));
      if (created.reason === "permission") {
        output.write(
          style.boxLine(
            `  缺 im:chat（建群）→ 开通: ${consoleLinks(appId, edition).permission} （搜索 "im:chat"，开通后需重新发布版本）`,
          ),
        );
      }
      output.write(
        style.boxLine(style.dim("  已降级回群选择——可手选已有群，或开通权限后重试新建")),
      );
      continue;
    }
    const pickedIndex = options.findIndex((o) => o.value === picked) - 2;
    const chosen = chats[pickedIndex >= 0 ? pickedIndex : 0];
    output.write(
      style.boxLine(style.dim(`  已选群：${chosen?.name ?? ""}（${chosen?.chat_id ?? ""}）`)),
    );
    return chosen?.chat_id ?? "";
  }
}

async function selectFeishuEdition(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
  lang: TemplateLanguage,
): Promise<FeishuEdition> {
  const cnFirst = [
    { value: "feishu" as FeishuEdition, label: "国内版（飞书）（默认）" },
    { value: "lark" as FeishuEdition, label: "海外版（Lark）" },
  ];
  const larkFirst = [
    { value: "lark" as FeishuEdition, label: "海外版（Lark）（默认）" },
    { value: "feishu" as FeishuEdition, label: "国内版（飞书）" },
  ];
  const options = lang === "en" ? larkFirst : cnFirst;
  const edition = await prompts.askSelect(`${style.bold("飞书版本")}`, options);
  output.write(style.boxLine(style.dim(`  API 域名: ${feishuApiBase(edition)}`)));
  return edition;
}

async function collectFeishuDirectConfig(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
  fetchImpl: typeof fetch | undefined,
  lang: TemplateLanguage,
): Promise<CollectedFeishu | null> {
  output.write(style.boxHeader("Feishu Setup"));
  output.write(
    style.boxLine(
      style.dim(
        "飞书直连专用部署：/chat 在配置目录创建 opencode 会话（无需 Jira）。详见 docs/feishu-quickstart.md",
      ),
    ),
  );
  const edition = await selectFeishuEdition(prompts, output, style, lang);
  const app_id = await prompts.ask(
    `${style.bold("Feishu app_id")} (${feishuApiBase(edition)} 应用凭证)`,
  );
  let app_secret = await prompts.ask(
    `${style.bold("Feishu app_secret")} (直接明文写入 WORKFLOW.md；留空则改用 $FEISHU_APP_SECRET 环境变量)`,
  );
  let token: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await fetchTenantTokenFor(app_id, app_secret, fetchImpl, edition);
    if (result.ok) {
      token = result.token;
      output.write(style.boxLine(`${style.statusIcon("ok")} 飞书凭据验证通过`));
      break;
    }
    output.write(style.boxLine(`${style.statusIcon("fail")} 验证未通过：${result.reason}`));
    output.write(style.boxLine(style.dim(`  ${crossRegionHint(edition)}`)));
    if (attempt === 3) break;
    const reEntered = await prompts.ask(
      `${style.bold("Feishu app_secret")}（重输重试；直接回车跳过验证继续）`,
    );
    if (reEntered === "") break;
    app_secret = reEntered;
  }
  if (token === null) {
    output.write(
      style.boxLine(
        `${style.statusIcon("warn")} 已跳过验证，继续配置（tasking start 前请确认凭据可用）`,
      ),
    );
  }
  let intake_chat_id: string;
  if (token === null) {
    intake_chat_id = await prompts.ask(
      `${style.bold("Feishu intake_chat_id")} (承载 /chat 与会话话题的群，oc_ 开头)`,
    );
  } else {
    const { item: chatsItem, chats } = await probeListChats(token, fetchImpl, app_id, edition);
    printProbeItem(output, style, chatsItem);
    if (chats === null || chats.length === 0) {
      printNextStepLinks(output, style, consoleLinks(app_id, edition));
      intake_chat_id = await prompts.ask(
        `${style.bold("Feishu intake_chat_id")} (承载 /chat 与会话话题的群，oc_ 开头)`,
      );
    } else {
      intake_chat_id = await pickOrCreateIntakeChat(
        prompts,
        output,
        style,
        token,
        chats,
        app_id,
        fetchImpl,
        edition,
      );
    }
    if (intake_chat_id !== "") {
      printProbeItem(
        output,
        style,
        await probeListMessages(token, intake_chat_id, fetchImpl, app_id, edition),
      );
    }
    for (const item of await probeTail(token, app_id, null, fetchImpl, edition)) {
      printProbeItem(output, style, item);
    }
    printNextStepLinks(output, style, consoleLinks(app_id, edition));
  }
  printFeishuSecretHint(output, style, app_secret);
  let project: { name: string; path: string } | null = null;
  const projectName = await prompts.ask(
    `${style.bold("常用项目名")}（/chat <项目名> <消息> 使用；直接回车跳过）`,
  );
  if (projectName !== "") {
    for (;;) {
      const projectDir = await prompts.ask(
        `${style.bold("项目目录绝对路径")}（${projectName}；回车放弃）`,
      );
      if (projectDir === "") break;
      const expandedDir = expandHome(projectDir);
      if (!existsSync(expandedDir) || !statSync(expandedDir).isDirectory()) {
        output.write(
          style.boxLine(`${style.statusIcon("fail")} 路径不存在或不是目录: ${projectDir}`),
        );
        continue;
      }
      project = { name: projectName.toLowerCase(), path: realpathSync(expandedDir) };
      break;
    }
  }
  output.write(style.boxFooter());
  return {
    edition,
    app_id,
    app_secret: app_secret === "" ? null : app_secret,
    intake_chat_id,
    create_issue_type: null,
    project,
  };
}

async function collectFeishuConfig(
  prompts: PromptInterface,
  output: Writable,
  style: Style,
  issueTypes: string[],
  fetchImpl: typeof fetch | undefined,
  lang: TemplateLanguage,
): Promise<CollectedFeishu | null> {
  output.write(style.boxHeader("Feishu Setup"));
  output.write(
    style.boxLine(
      style.dim(
        "评论桥：飞书话题 ↔ Jira 评论双向镜像（/issue、/state、/help）。详见 docs/feishu-quickstart.md",
      ),
    ),
  );
  const enable = await prompts.askSelect(`${style.bold("Enable Feishu bridge")}`, [
    { value: "no", label: "no" },
    { value: "yes", label: "yes" },
  ]);
  if (enable !== "yes") {
    output.write(
      style.boxLine(
        `${style.statusIcon("info")} Feishu bridge disabled; 详见 docs/feishu-quickstart.md`,
      ),
    );
    output.write(style.boxFooter());
    return null;
  }
  const edition = await selectFeishuEdition(prompts, output, style, lang);
  const app_id = await prompts.ask(
    `${style.bold("Feishu app_id")} (${feishuApiBase(edition)} 应用凭证)`,
  );
  const app_secret = await prompts.ask(
    `${style.bold("Feishu app_secret")} (直接明文写入 WORKFLOW.md；留空则改用 $FEISHU_APP_SECRET 环境变量)`,
  );
  const intake_chat_id = await prompts.ask(
    `${style.bold("Feishu intake_chat_id")} (承载所有 issue 线程的群)`,
  );
  const tokenResult = await fetchTenantTokenFor(app_id, app_secret, fetchImpl, edition);
  if (!tokenResult.ok) {
    output.write(
      style.boxLine(
        `${style.statusIcon("warn")} 飞书凭据验证未通过：${tokenResult.reason}（不影响生成配置，start 前请修正）`,
      ),
    );
    output.write(style.boxLine(style.dim(`  ${crossRegionHint(edition)}`)));
  } else {
    output.write(style.boxLine(`${style.statusIcon("ok")} 飞书凭据验证通过`));
    printProbeItem(
      output,
      style,
      (await probeListChats(tokenResult.token, fetchImpl, app_id, edition)).item,
    );
    if (intake_chat_id !== "") {
      printProbeItem(
        output,
        style,
        await probeListMessages(tokenResult.token, intake_chat_id, fetchImpl, app_id, edition),
      );
    }
    for (const item of await probeTail(tokenResult.token, app_id, null, fetchImpl, edition)) {
      printProbeItem(output, style, item);
    }
    printNextStepLinks(output, style, consoleLinks(app_id, edition));
  }
  const typeOptions = ["Task", ...issueTypes.filter((t) => t !== "Task")];
  const create_issue_type = await prompts.askSelect(
    `${style.bold("Default issue type for /issue")}`,
    typeOptions.map((t) => ({ value: t, label: t })),
  );
  printFeishuSecretHint(output, style, app_secret);
  output.write(style.boxFooter());
  return {
    edition,
    app_id,
    app_secret: app_secret === "" ? null : app_secret,
    intake_chat_id,
    create_issue_type,
    project: null,
  };
}

function printFeishuSecretHint(output: Writable, style: Style, appSecret: string): void {
  if (appSecret !== "") {
    output.write(
      style.boxLine(
        style.dim(
          "  app_secret 已明文写入 WORKFLOW.md；如需保密可改用环境变量：export FEISHU_APP_SECRET=<secret>，再把该行改回 $FEISHU_APP_SECRET",
        ),
      ),
    );
    return;
  }
  output.write(
    style.boxLine(
      style.dim(
        "Tip: 已保留 $FEISHU_APP_SECRET 引用——export FEISHU_APP_SECRET=<secret> in ~/.bashrc, or set it in env: section of WORKFLOW.md",
      ),
    ),
  );
}

export const VARIANT_ACTIVE_SECTIONS: Record<WorkflowVariant, readonly string[]> = {
  "feishu-direct": ["tracker", "feishu"],
  minimal: ["tracker", "hooks", "feishu"],
  "code-mr": ["tracker", "hooks", "env", "feishu"],
  "grill-openspec": ["tracker", "hooks", "env", "feishu"],
};

export const TEMPLATE_SECTIONS = [
  "tracker",
  "polling",
  "workspace",
  "hooks",
  "agent",
  "opencode",
  "router",
  "feishu",
  "server",
  "logging",
  "env",
] as const;

const OPTIONAL_SECTION_MARKERS: Record<TemplateLanguage, string> = {
  zh: "# —— 可选：以下为默认值，改动才解注释 ——",
  en: "# —— optional: defaults below; uncomment only to change ——",
};
const TOP_LEVEL_KEY = /^([a-z_]+):/;
const ANY_SECTION_KEY = /^(?:# )?([a-z_]+):/;

function frontmatterBounds(lines: string[]): { start: number; end: number } | null {
  if ((lines[0] ?? "").trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") return { start: 1, end: i };
  }
  return null;
}

export function templateTopLevelKeys(content: string): string[] {
  const lines = content.split("\n");
  const bounds = frontmatterBounds(lines);
  if (!bounds) return [];
  const keys = new Set<string>();
  for (let i = bounds.start; i < bounds.end; i++) {
    const m = ANY_SECTION_KEY.exec(lines[i] ?? "");
    if (m?.[1]) keys.add(m[1]);
  }
  return [...keys];
}

function commentOut(line: string): string {
  if (line.trim() === "") return line;
  if (line.trimStart().startsWith("#")) return line;
  return line.replace(/^([ \t]*)/, "$1# ");
}

export function trimFrontmatter(
  content: string,
  opts: { workflow: WorkflowVariant; feishuEnabled: boolean; lang: TemplateLanguage },
): string {
  const lines = content.split("\n");
  const bounds = frontmatterBounds(lines);
  if (!bounds) return content;
  const active = new Set(VARIANT_ACTIVE_SECTIONS[opts.workflow]);
  const out: string[] = [];
  let currentKey: string | null = null;
  let markerFor = "\u0000";
  for (let i = bounds.start; i < bounds.end; i++) {
    const line = lines[i] ?? "";
    const m = TOP_LEVEL_KEY.exec(line);
    if (m?.[1]) currentKey = m[1];
    const sectionActive =
      currentKey === null || active.has(currentKey) || currentKey === "interface_language";
    if (sectionActive) {
      const isKeyLine = m?.[1] === currentKey;
      const feishuDisabled = currentKey === "feishu" && !opts.feishuEnabled;
      if (feishuDisabled && !isKeyLine && !/^ {2}enabled:/.test(line)) {
        out.push(commentOut(line));
      } else {
        out.push(line);
      }
      continue;
    }
    if (markerFor !== currentKey) {
      out.push(OPTIONAL_SECTION_MARKERS[opts.lang]);
      markerFor = currentKey ?? "\u0000";
    }
    out.push(commentOut(line));
  }
  return [lines[0], ...out, ...lines.slice(bounds.end)].join("\n");
}

export const STATE_BUCKETS: Record<"active" | "review" | "terminal", readonly string[]> = {
  active: [
    "待办",
    "to do",
    "todo",
    "处理中",
    "进行中",
    "in progress",
    "合并中",
    "merging",
    "重置处理",
    "reset",
  ],
  review: ["代码评审中", "评审中", "待评审", "in review", "review"],
  terminal: [
    "完成",
    "done",
    "关闭",
    "closed",
    "取消",
    "cancelled",
    "canceled",
    "重复",
    "duplicate",
    "resolved",
  ],
};

export interface ProjectStateBuckets {
  active: string[];
  review: string[];
  terminal: string[];
  unmatched: string[];
}

export interface AutoStates {
  active_states: string[];
  terminal_states: string[];
  review_state: string | null;
}

export function classifyProjectStatuses(names: string[]): ProjectStateBuckets {
  const buckets: ProjectStateBuckets = { active: [], review: [], terminal: [], unmatched: [] };
  for (const name of names) {
    const norm = name.trim().toLowerCase();
    if ((STATE_BUCKETS.review as readonly string[]).includes(norm)) buckets.review.push(name);
    else if ((STATE_BUCKETS.active as readonly string[]).includes(norm)) buckets.active.push(name);
    else if ((STATE_BUCKETS.terminal as readonly string[]).includes(norm))
      buckets.terminal.push(name);
    else buckets.unmatched.push(name);
  }
  return buckets;
}

async function promptStateAutofill(
  statuses: string[],
  prompts: PromptInterface,
  output: Writable,
  style: Style,
  lang: TemplateLanguage,
): Promise<AutoStates | null> {
  const zh = lang === "zh";
  const buckets = classifyProjectStatuses(statuses);
  if (buckets.active.length === 0 || buckets.terminal.length === 0) {
    if (statuses.length > 0) {
      output.write(
        style.boxLine(
          style.dim(
            zh
              ? "  （状态名无法完整映射到 active/terminal，保留模板默认，可在 WORKFLOW.md 手改）"
              : "  (statuses could not be fully mapped to active/terminal; template defaults kept — edit WORKFLOW.md if needed)",
          ),
        ),
      );
      if (buckets.unmatched.length > 0) {
        output.write(
          style.boxLine(
            style.dim(`    ${zh ? "未采用" : "unmatched"}: ${buckets.unmatched.join(" / ")}`),
          ),
        );
      }
    }
    return null;
  }
  output.write(style.boxLine(zh ? "  建议的状态预填：" : "  Suggested state mapping:"));
  output.write(style.boxLine(`    active:   ${buckets.active.join(" / ")}`));
  output.write(
    style.boxLine(`    review:   ${buckets.review.join(" / ") || (zh ? "（无）" : "(none)")}`),
  );
  output.write(style.boxLine(`    terminal: ${buckets.terminal.join(" / ")}`));
  if (buckets.unmatched.length > 0) {
    output.write(
      style.boxLine(
        style.dim(`    ${zh ? "未采用" : "unmatched"}: ${buckets.unmatched.join(" / ")}`),
      ),
    );
  }
  const confirmLabel = zh ? "确认写入（默认）" : "Confirm (default)";
  const choice = await prompts.askSelect(
    `${style.bold(zh ? "写入状态配置" : "Write state config")}`,
    [
      { value: "confirm", label: confirmLabel },
      { value: "keep", label: zh ? "保持模板默认" : "Keep template defaults" },
    ],
  );
  if (choice !== "confirm") return null;
  return {
    active_states: buckets.active,
    terminal_states: buckets.terminal,
    review_state: buckets.review[0] ?? null,
  };
}

function yamlScalar(value: string | null): string {
  if (value === null) return "null";
  return /[:#[\]{},&*!|>'"%@`]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}

function replaceYamlList(content: string, key: string, values: string[]): string {
  const re = new RegExp(`^(\\s*)${key}:\\n(?:[ \\t]*- .*\\n)*`, "m");
  return content.replace(
    re,
    (_m, indent: string) =>
      `${indent}${key}:\n${values.map((v) => `${indent}  - ${yamlScalar(v)}`).join("\n")}\n`,
  );
}

export function applyTemplateTrimming(
  content: string,
  workflow: WorkflowVariant,
  feishuEnabled: boolean,
  lang: TemplateLanguage,
): string {
  const trimmed = trimFrontmatter(content, {
    workflow,
    feishuEnabled: feishuSectionActive(workflow, feishuEnabled),
    lang,
  });
  if (lang === "en") {
    return trimmed.replace(/^interface_language: zh$/m, "interface_language: en");
  }
  return trimmed.replace(/^interface_language: zh\n/m, "");
}

function feishuSectionActive(workflow: WorkflowVariant, feishuEnabled: boolean): boolean {
  return workflow === "feishu-direct" || feishuEnabled;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function generateWorkflowContent(
  creds: CollectedCredentials | null,
  workflow: WorkflowVariant,
  feishu: CollectedFeishu | null = null,
  lang: TemplateLanguage = "zh",
  states: AutoStates | null = null,
): string {
  const template = readFileSync(resolveExampleFile(workflow, lang), "utf8");
  let content = template;
  if (creds !== null) {
    content = content.replace(/endpoint: .*/, `endpoint: ${creds.endpoint}`);
    content = content.replace(/api_key: .*/, "api_key: $JIRA_API_KEY");
    content = content.replace(/auth_mode: .*/, `auth_mode: ${creds.auth_mode}`);
    if (creds.api_user) {
      content = content.replace(/api_user: .*/, `api_user: ${creds.api_user}`);
    } else {
      content = content.replace(/api_user: .*/, "api_user: null");
    }
    content = content.replace(/project_key: .*/, `project_key: ${creds.project_key}`);
  }
  if (feishu) {
    content = content.replace(/^([ \t]*)edition: .*$/m, `$1edition: ${feishu.edition}`);
    content = content.replace(/app_id: \$FEISHU_APP_ID/, `app_id: ${feishu.app_id}`);
    if (feishu.app_secret !== null) {
      content = content.replace(
        /app_secret: \$FEISHU_APP_SECRET/,
        `app_secret: ${feishu.app_secret}`,
      );
    }
    content = content.replace(
      /intake_chat_id: \$FEISHU_INTAKE_CHAT_ID/,
      `intake_chat_id: ${feishu.intake_chat_id}`,
    );
    if (feishu.project) {
      content = content.replace(
        /^([ \t]*)projects:[ \t]*$/m,
        `$1projects:\n$1  ${feishu.project.name}:\n$1    path: ${feishu.project.path}`,
      );
      content = content.replace(
        /path_roots: \[\]/,
        `path_roots: [${JSON.stringify(feishu.project.path)}]`,
      );
    }
    if (feishu.create_issue_type !== null) {
      content = content.replace(
        /create_issue_type: .*/,
        `create_issue_type: ${feishu.create_issue_type}`,
      );
    }
    content = content.replace(/^(feishu:\n(?:\s*#.*\n)*\s*enabled:) false/m, "$1 true");
  }
  if (states !== null) {
    content = replaceYamlList(content, "active_states", states.active_states);
    content = replaceYamlList(content, "terminal_states", states.terminal_states);
    content = content.replace(
      /^(\s*)review_state: .*$/m,
      `$1review_state: ${yamlScalar(states.review_state)}`,
    );
  }
  return applyTemplateTrimming(content, workflow, feishu !== null, lang);
}

function copySkill(wfDir: string, output: Writable, workflow: WorkflowVariant): void {
  copySkills(wfDir, workflow, (status, message) => {
    if (status === "fail") output.write(`Warning: ${message}\n`);
  });
}

function printPrerequisites(style: Style, output: Writable, includeVcs: boolean): void {
  output.write(style.boxHeader("Prerequisites"));

  try {
    const result = spawnSync("which", ["opencode"], { stdio: "pipe" });
    if (result.status === 0) {
      output.write(style.boxLine(`${style.statusIcon("ok")} opencode   found in PATH`));
    } else {
      output.write(
        style.boxLine(
          `${style.statusIcon("fail")} opencode   not found in PATH, daemon cannot execute tasks`,
        ),
      );
    }
  } catch {
    output.write(style.boxLine(`${style.statusIcon("fail")} opencode   could not check`));
  }

  if (!includeVcs) {
    output.write(style.boxFooter());
    return;
  }

  try {
    const result = spawnSync("which", ["glab"], { stdio: "pipe" });
    if (result.status === 0) {
      output.write(style.boxLine(`${style.statusIcon("ok")} glab       found in PATH`));
    } else {
      output.write(
        style.boxLine(
          `${style.statusIcon("fail")} glab       not found in PATH, agent cannot create or merge MRs`,
        ),
      );
      output.write(
        style.boxLine(
          style.dim(
            "    Install: brew install glab  (or run the install-glab skill in the workspace to self-install)",
          ),
        ),
      );
    }
  } catch {
    output.write(style.boxLine(`${style.statusIcon("fail")} glab       could not check`));
  }

  if (process.env.GITLAB_TOKEN && process.env.GITLAB_HOST) {
    output.write(
      style.boxLine(`${style.statusIcon("ok")} GitLab     GITLAB_TOKEN and GITLAB_HOST set`),
    );
  } else {
    if (!process.env.GITLAB_TOKEN) {
      output.write(style.boxLine(`${style.statusIcon("warn")} GitLab     GITLAB_TOKEN not set`));
    }
    if (!process.env.GITLAB_HOST) {
      output.write(style.boxLine(`${style.statusIcon("warn")} GitLab     GITLAB_HOST not set`));
    }
    output.write(
      style.boxLine(
        style.dim(
          "    Set GITLAB_TOKEN and GITLAB_HOST — export in ~/.bashrc or fill env: in WORKFLOW.md",
        ),
      ),
    );
  }

  output.write(style.boxFooter());
}

function printInitialization(
  style: Style,
  output: Writable,
  wfPath: string,
  workflow: WorkflowVariant,
  lang: TemplateLanguage,
): void {
  output.write(style.boxHeader("Initialization"));

  output.write(style.boxLine(`${style.statusIcon("ok")} ${basename(wfPath)} written`));
  output.write(style.boxLine(`${style.statusIcon("info")} Workflow: ${workflow}`));
  output.write(style.boxLine(`${style.statusIcon("info")} Language: ${lang}`));
  copySkillStyled(dirname(wfPath), output, style, workflow);

  const wsRoot = resolve(homedir(), "tasking_workspaces");
  if (existsSync(wsRoot)) {
    output.write(style.boxLine(`${style.statusIcon("info")} Workspace root already exists`));
  } else {
    mkdirSync(wsRoot, { recursive: true });
    output.write(style.boxLine(`${style.statusIcon("ok")} Workspace root created`));
  }

  output.write(style.boxFooter());
}

function copySkillStyled(
  wfDir: string,
  output: Writable,
  style: Style,
  workflow: WorkflowVariant,
): void {
  copySkills(wfDir, workflow, (status, message) => {
    output.write(style.boxLine(`${style.statusIcon(status)} ${message}`));
  });
}

function openEditor(filePath: string): boolean {
  const visual = process.env.VISUAL;
  const editor = process.env.EDITOR;
  const candidates = [visual, editor, "code"].filter((c): c is string => Boolean(c));

  for (const cmd of candidates) {
    try {
      if (spawnSync("which", [cmd], { stdio: "pipe" }).status !== 0) continue;
      const child = spawn(cmd, [filePath], { detached: true, stdio: "ignore" });
      child.once("error", () => {});
      child.unref();
      return true;
    } catch {
      // try next
    }
  }

  return false;
}

function printCompletionHint(
  output: Writable,
  style: Style,
  editorOk: boolean,
  workflow: WorkflowVariant,
  projectName: string | null,
  statesApplied: boolean,
  lang: TemplateLanguage,
): void {
  output.write(style.boxHeader("Next Steps"));
  if (workflow === "feishu-direct") {
    output.write(style.boxLine(`${style.statusIcon("ok")} ${translate("配置完成！")}`));
    output.write(
      style.boxLine(`  ${translate("运行：")}${style.green(style.bold("tasking start"))}`),
    );
    if (projectName !== null) {
      output.write(
        style.boxLine(
          translate(
            `  然后在群里发：/chat <项目名> <消息>（如 /chat ${projectName} 帮我看个报错）`,
          ),
        ),
      );
    } else {
      output.write(style.boxLine("  然后在群里发：/chat /绝对路径 <消息>"));
      output.write(
        style.boxLine(
          `${style.statusIcon("warn")} ${translate(
            "path 模式当前不限制目录（path_roots: []），建议在 WORKFLOW.md 配置 projects 或 path_roots",
          )}`,
        ),
      );
    }
    if (editorOk) {
      output.write(style.boxLine(`${style.statusIcon("ok")} Config file opened in editor`));
    }
  } else {
    output.write(style.boxLine("Edit these fields in WORKFLOW.md:"));
    if (statesApplied) {
      output.write(
        style.boxLine(
          `${style.statusIcon("ok")} ${
            lang === "zh"
              ? "状态已按项目实际预填（active/terminal/review）"
              : "states prefilled from your project (active/terminal/review)"
          }`,
        ),
      );
    } else {
      output.write(
        style.boxLine(`  ${style.dim("· active_states     Jira states that trigger dispatch")}`),
      );
      output.write(
        style.boxLine(`  ${style.dim("· terminal_states   Jira states that trigger cleanup")}`),
      );
      output.write(
        style.boxLine(`  ${style.dim("· review_state      intermediate review state name")}`),
      );
    }
    output.write(
      style.boxLine(`  ${style.dim("· after_create      workspace setup hook (git clone, deps)")}`),
    );
    if (workflow === "code-mr" || workflow === "grill-openspec") {
      output.write(
        style.boxLine(
          `  ${style.dim(
            lang === "zh"
              ? "· env.GITLAB_TOKEN / GITLAB_HOST   供 agent 建 MR（glab）"
              : "· env.GITLAB_TOKEN / GITLAB_HOST   used by the agent to create MRs (glab)",
          )}`,
        ),
      );
    }
    output.write(style.boxLine(""));
    if (editorOk) {
      output.write(style.boxLine(`${style.statusIcon("ok")} Config file opened in editor`));
    } else {
      output.write(
        style.boxLine(`${style.statusIcon("info")} Config file: edit WORKFLOW.md manually`),
      );
    }
    output.write(style.boxLine(""));
    output.write(style.boxLine(`Then run: ${style.green(style.bold("tasking start"))}`));
  }
  output.write(style.boxFooter());
}

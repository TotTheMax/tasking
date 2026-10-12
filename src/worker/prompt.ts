import { TaskingError } from "../shared/errors.js";
import type { Task } from "../shared/types.js";

export interface RenderContext {
  task: Task;
  attempt: number | null;
  terminal_states: string;
  active_states: string;
  review_state: string;
}

const DEFAULT_PROMPT = "You are working on an issue from the tracker.";

export function renderPrompt(template: string, ctx: RenderContext): string {
  const body = template.trim() === "" ? DEFAULT_PROMPT : template;
  return renderLiquidStrict(body, ctx);
}

function renderLiquidStrict(template: string, ctx: RenderContext): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === undefined) break;

    if (ch === "{" && template[i + 1] === "{") {
      const end = template.indexOf("}}", i + 2);
      if (end === -1) {
        throw new TaskingError("template_render_error", "unclosed {{ }} in template");
      }
      const expr = template.slice(i + 2, end).trim();
      out += resolveExpression(expr, ctx);
      i = end + 2;
      continue;
    }

    if (ch === "{" && template[i + 1] === "%") {
      const end = template.indexOf("%}", i + 2);
      if (end === -1) {
        throw new TaskingError("template_render_error", "unclosed {% %} in template");
      }
      const tag = template.slice(i + 2, end).trim();
      const { consumed, output } = processTag(tag, template, end + 2, ctx);
      out += output;
      i = consumed;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

function resolveExpression(expr: string, ctx: RenderContext): string {
  const parts = expr.split("|").map((p) => p.trim());
  const varPath = parts[0];
  if (varPath === undefined) {
    throw new TaskingError("template_render_error", "empty expression in template");
  }
  let value: unknown = resolveVariable(varPath, ctx);

  for (let f = 1; f < parts.length; f++) {
    const filterName = parts[f];
    if (filterName === undefined) continue;
    value = applyFilter(filterName, value);
  }
  return stringify(value);
}

function resolveVariable(path: string, ctx: RenderContext): unknown {
  const segments = path.split(".");
  const root = segments[0];
  if (root === undefined) {
    throw new TaskingError("template_render_error", "empty variable path");
  }

  let current: unknown;
  if (root === "task" || root === "issue") {
    current = ctx.task;
  } else if (root === "attempt") {
    current = ctx.attempt;
  } else if (root === "terminal_states") {
    current = ctx.terminal_states;
  } else if (root === "active_states") {
    current = ctx.active_states;
  } else if (root === "review_state") {
    current = ctx.review_state;
  } else {
    throw new TaskingError("template_render_error", `unknown variable: ${root}`);
  }

  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s];
    if (seg === undefined) break;
    current = getIndex(current, seg);
  }
  return current;
}

function getIndex(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === "object") {
    return (obj as Record<string, unknown>)[key] ?? null;
  }
  throw new TaskingError("template_render_error", `cannot index ${typeof obj} with ${key}`);
}

function applyFilter(name: string, value: unknown): unknown {
  switch (name) {
    case "default":
      return value;
    case "upcase":
      return typeof value === "string" ? value.toUpperCase() : value;
    case "downcase":
      return typeof value === "string" ? value.toLowerCase() : value;
    case "trim":
      return typeof value === "string" ? value.trim() : value;
    default:
      throw new TaskingError("template_render_error", `unknown filter: ${name}`);
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

interface TagResult {
  consumed: number;
  output: string;
}

function processTag(
  tag: string,
  template: string,
  startIdx: number,
  ctx: RenderContext,
): TagResult {
  const ifMatch = /^if\s+(.+)$/.exec(tag);
  if (ifMatch && ifMatch[1] !== undefined) {
    return processIf(ifMatch[1], template, startIdx, ctx);
  }
  throw new TaskingError("template_render_error", `unsupported tag: ${tag}`);
}

function processIf(
  condition: string,
  template: string,
  startIdx: number,
  ctx: RenderContext,
): TagResult {
  const elseTag = "{% else %}";
  const endTag = "{% endif %}";

  const endifIdx = template.indexOf(endTag, startIdx);
  if (endifIdx === -1) {
    throw new TaskingError("template_render_error", "unclosed {% if %} block");
  }

  const blockContent = template.slice(startIdx, endifIdx);
  const elseIdx = blockContent.indexOf(elseTag);

  const trueBranch = elseIdx === -1 ? blockContent : blockContent.slice(0, elseIdx);
  const falseBranch = elseIdx === -1 ? "" : blockContent.slice(elseIdx + elseTag.length);

  const cond = evaluateCondition(condition, ctx);
  const chosen = cond ? trueBranch : falseBranch;
  const afterEnd = endifIdx + endTag.length;

  const rendered = renderLiquidStrict(chosen, ctx);
  return { consumed: afterEnd, output: rendered };
}

function evaluateCondition(expr: string, ctx: RenderContext): boolean {
  const negated = expr.startsWith("!");
  const path = negated ? expr.slice(1).trim() : expr.trim();
  const value = resolveVariable(path, ctx);
  const truthy = value !== null && value !== undefined && value !== false && value !== "";
  return negated ? !truthy : truthy;
}

export function buildContinuationGuidance(task: Task, attempt: number, turn: number): string {
  return `Continue working on ${task.identifier} (attempt ${attempt}, turn ${turn}). Check \`git log\` and \`git status\` to see what was done. Check the current Jira state — if in an initial active state, do incremental fixes on the same branch, push, ensure CI green, then transition back to review; if in a rework active state, do a full reset (close old MR, new branch from origin/main). Resume from where you left off. If stuck, check \`tasking.log\` for execution failures. If you have an open merge request and need to merge, read the \`land\` skill.`;
}

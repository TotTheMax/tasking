import { readFileSync } from "node:fs";
import { TaskingError } from "../shared/errors.js";
import type { WorkflowDefinition } from "../shared/types.js";

const FRONT_MATTER_DELIMITER = "---";

export function loadWorkflowFile(path: string): WorkflowDefinition {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    throw new TaskingError("missing_workflow_file", `cannot read workflow file: ${path}`, {
      path,
    });
  }

  return parseWorkflowContent(content, path);
}

export function parseWorkflowContent(content: string, path: string): WorkflowDefinition {
  const lines = content.split("\n");
  let config: Record<string, unknown> = {};
  let bodyStart = 0;

  if (lines[0]?.trim() === FRONT_MATTER_DELIMITER) {
    const closeIdx = findFrontMatterClose(lines);
    if (closeIdx === -1) {
      throw new TaskingError("workflow_parse_error", "front matter not closed", { path });
    }
    const yamlText = lines.slice(1, closeIdx).join("\n");
    config = parseYamlFrontMatter(yamlText, path);
    bodyStart = closeIdx + 1;
  }

  const prompt_template = lines.slice(bodyStart).join("\n").trim();

  return { config, prompt_template, path };
}

function findFrontMatterClose(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.trim() === FRONT_MATTER_DELIMITER) {
      return i;
    }
  }
  return -1;
}

function parseYamlFrontMatter(yamlText: string, path: string): Record<string, unknown> {
  const trimmed = yamlText.trim();
  if (trimmed === "") return {};

  try {
    return parseSimpleYaml(trimmed);
  } catch (e) {
    throw new TaskingError(
      "workflow_parse_error",
      `failed to parse front matter: ${e instanceof Error ? e.message : String(e)}`,
      { path },
    );
  }
}

export function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(trimmed);
    if (!match || match[1] === undefined || match[2] === undefined) {
      i++;
      continue;
    }
    const key = match[1];
    const rest = match[2];

    if (rest === "") {
      const [nested, nextIdx] = parseBlock(lines, i + 1, indent);
      result[key] = nested;
      i = nextIdx;
    } else if (rest === "|" || rest === ">") {
      const [scalar, nextIdx] = parseMultiline(lines, i + 1, indent);
      result[key] = scalar;
      i = nextIdx;
    } else {
      result[key] = parseScalar(rest);
      i++;
    }
  }

  return result;
}

function parseBlock(lines: string[], start: number, parentIndent: number): [unknown, number] {
  const arr: unknown[] = [];
  const obj: Record<string, unknown> = {};
  let isArray = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= parentIndent) break;

    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      isArray = true;
      arr.push(parseScalar(trimmed.slice(2)));
      i++;
    } else if (trimmed === "-") {
      isArray = true;
      arr.push("");
      i++;
    } else {
      const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(trimmed);
      if (match && match[1] !== undefined && match[2] !== undefined) {
        const rest = match[2];
        if (rest === "|" || rest === ">") {
          const [scalar, nextIdx] = parseMultiline(lines, i + 1, indent);
          obj[match[1]] = scalar;
          i = nextIdx;
        } else if (rest === "") {
          const [nested, nextIdx] = parseBlock(lines, i + 1, indent);
          obj[match[1]] = nested;
          i = nextIdx;
        } else {
          obj[match[1]] = parseScalar(rest);
          i++;
        }
      } else {
        i++;
      }
    }
  }

  return [isArray ? arr : obj, i];
}

function parseMultiline(lines: string[], start: number, parentIndent: number): [string, number] {
  const parts: string[] = [];
  let i = start;
  let contentIndent: number | null = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === "") {
      parts.push("");
      i++;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= parentIndent) break;
    if (contentIndent === null) contentIndent = indent;
    const sliceAt = Math.min(contentIndent, line.length);
    parts.push(line.slice(sliceAt));
    i++;
  }
  return [parts.join("\n"), i];
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "") return "";
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    return parseFlow(value);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

interface FlowCursor {
  index: number;
}

function parseFlow(value: string): unknown {
  const cursor: FlowCursor = { index: 0 };
  const parsed = parseFlowValue(value, cursor);
  skipFlowWhitespace(value, cursor);
  if (cursor.index < value.length) {
    throw new Error(`unexpected trailing characters in flow value: ${value}`);
  }
  return parsed;
}

function parseFlowValue(src: string, cursor: FlowCursor): unknown {
  skipFlowWhitespace(src, cursor);
  const ch = src[cursor.index];
  if (ch === "{") return parseFlowMapping(src, cursor);
  if (ch === "[") return parseFlowSequence(src, cursor);
  return parseScalar(parseFlowToken(src, cursor, false));
}

function parseFlowMapping(src: string, cursor: FlowCursor): Record<string, unknown> {
  cursor.index++;
  const result: Record<string, unknown> = {};
  for (;;) {
    skipFlowWhitespace(src, cursor);
    const ch = src[cursor.index];
    if (ch === "}") {
      cursor.index++;
      return result;
    }
    if (ch === undefined) throw new Error(`unterminated flow mapping: ${src}`);
    const key = unquoteFlowKey(parseFlowToken(src, cursor, true));
    skipFlowWhitespace(src, cursor);
    if (src[cursor.index] !== ":") {
      throw new Error(`expected ":" after flow mapping key "${key}" in: ${src}`);
    }
    cursor.index++;
    result[key] = parseFlowValue(src, cursor);
    skipFlowWhitespace(src, cursor);
    const sep = src[cursor.index];
    if (sep === ",") {
      cursor.index++;
      continue;
    }
    if (sep === "}") {
      cursor.index++;
      return result;
    }
    throw new Error(`unterminated flow mapping: ${src}`);
  }
}

function parseFlowSequence(src: string, cursor: FlowCursor): unknown[] {
  cursor.index++;
  const result: unknown[] = [];
  for (;;) {
    skipFlowWhitespace(src, cursor);
    const ch = src[cursor.index];
    if (ch === "]") {
      cursor.index++;
      return result;
    }
    if (ch === undefined) throw new Error(`unterminated flow sequence: ${src}`);
    result.push(parseFlowValue(src, cursor));
    skipFlowWhitespace(src, cursor);
    const sep = src[cursor.index];
    if (sep === ",") {
      cursor.index++;
      continue;
    }
    if (sep === "]") {
      cursor.index++;
      return result;
    }
    throw new Error(`unterminated flow sequence: ${src}`);
  }
}

function parseFlowToken(src: string, cursor: FlowCursor, isKey: boolean): string {
  skipFlowWhitespace(src, cursor);
  const start = cursor.index;
  const quote = src[cursor.index];
  if (quote === '"' || quote === "'") {
    cursor.index++;
    while (cursor.index < src.length && src[cursor.index] !== quote) cursor.index++;
    if (cursor.index >= src.length) throw new Error(`unterminated quoted string in: ${src}`);
    cursor.index++;
    return src.slice(start, cursor.index);
  }
  while (cursor.index < src.length) {
    const ch = src[cursor.index];
    if (ch === undefined || ch === "," || ch === "}" || ch === "]") break;
    if (isKey && ch === ":") break;
    cursor.index++;
  }
  return src.slice(start, cursor.index).trim();
}

function skipFlowWhitespace(src: string, cursor: FlowCursor): void {
  while (cursor.index < src.length) {
    const ch = src[cursor.index];
    if (ch === undefined || !/\s/.test(ch)) break;
    cursor.index++;
  }
}

function unquoteFlowKey(key: string): string {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

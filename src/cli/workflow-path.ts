import { statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export const DEFAULT_WORKFLOW_FILE = "WORKFLOW.md";

export interface ResolvedWorkflowPath {
  path: string;
  dir: string;
  name: string;
}

export class WorkflowPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowPathError";
  }
}

export function resolveWorkflowPath(cwd: string, positional?: string): ResolvedWorkflowPath {
  const path = resolve(cwd, positional ?? DEFAULT_WORKFLOW_FILE);
  if (isDirectory(path)) {
    throw new WorkflowPathError(`workflow path must be a file, not a directory: ${path}`);
  }
  return { path, dir: dirname(path), name: basename(path) };
}

export function resolveWorkflowPathOrReport(
  cwd: string,
  positional: string | undefined,
  report: (message: string) => void,
): ResolvedWorkflowPath | null {
  try {
    return resolveWorkflowPath(cwd, positional);
  } catch (err) {
    if (err instanceof WorkflowPathError) {
      report(err.message);
      return null;
    }
    throw err;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

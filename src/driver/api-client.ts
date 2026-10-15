import { execFile } from "node:child_process";
import { type ErrorCategory, TaskingError } from "../shared/errors.js";

export interface ApiCallSpec {
  command: string;
  operation: string;
  serverUrl?: string | null;
  params?: Record<string, string>;
  data?: unknown;
  timeoutMs?: number;
}

export interface ApiExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ApiExecFn = (args: string[], timeoutMs: number) => Promise<ApiExecResult>;

export function buildApiArgs(spec: {
  command: string;
  operation: string;
  serverUrl?: string | null;
  params?: Record<string, string>;
  data?: unknown;
}): string[] {
  const base = spec.command.split(/\s+/).filter(Boolean);
  const args = [...base, "api"];
  if (spec.serverUrl) {
    args.push("--server", spec.serverUrl);
  }
  args.push(spec.operation);
  for (const [key, value] of Object.entries(spec.params ?? {})) {
    args.push("--param", `${key}=${value}`);
  }
  if (spec.data !== undefined) {
    args.push("--data", JSON.stringify(spec.data));
  }
  return args;
}

export class ApiError extends TaskingError {}

export async function execApi(
  spec: ApiCallSpec,
  exec: ApiExecFn,
): Promise<Record<string, unknown> | null> {
  const args = buildApiArgs(spec);
  const timeoutMs = spec.timeoutMs ?? 15000;
  const res = await exec(args, timeoutMs);
  if (res.timedOut) {
    throw new ApiError("opencode_api_timeout", `opencode api ${spec.operation} timed out`, {
      timedOut: true,
    });
  }
  if (res.exitCode !== 0) {
    throw new ApiError(
      "opencode_api_error",
      `opencode api ${spec.operation} failed (exit ${res.exitCode ?? "?"}): ${res.stderr.trim().slice(0, 500)}`,
      { stderr: res.stderr, exitCode: res.exitCode },
    );
  }
  const stdout = res.stdout.trim();
  if (stdout === "") return null;
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new ApiError(
      "opencode_api_parse",
      `opencode api ${spec.operation} returned non-JSON output: ${stdout.slice(0, 200)}`,
      { stderr: res.stderr },
    );
  }
}

export function defaultApiExec(): ApiExecFn {
  return (args, timeoutMs) =>
    new Promise<ApiExecResult>((resolve) => {
      execFile(
        args[0] ?? "opencode",
        args.slice(1),
        { timeout: timeoutMs, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const errnoErr = err as (NodeJS.ErrnoException & { killed?: boolean }) | undefined;
          const timedOut = errnoErr?.killed === true;
          const exitCode =
            err && typeof (err as { code?: number | string }).code === "number"
              ? ((err as { code?: number }).code ?? null)
              : err
                ? null
                : 0;
          resolve({
            exitCode,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            timedOut,
          });
        },
      );
    });
}

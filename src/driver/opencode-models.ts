import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { buildApiArgs } from "./api-client.js";
import type { ResolvedModel } from "./session-ops.js";

export interface AvailableModelRef {
  providerID: string;
  id: string;
  name?: string;
  releasedMs?: number;
  free?: boolean;
}

export interface OpencodeModelsProbe {
  status: "ok" | "unreachable";
  defaultModel?: ResolvedModel | null;
  available?: AvailableModelRef[];
  error?: string;
}

export type ModelProbeRunner = (
  args: string[],
  cwd: string,
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>;

const PROBE_TIMEOUT_MS = 15000;

export const defaultModelProbeRunner: ModelProbeRunner = (args, cwd, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      args[0] ?? "opencode",
      args.slice(1),
      { cwd, timeout: timeoutMs, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

function parseModelRef(value: unknown): ResolvedModel | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id === "") return null;
  return {
    id: record.id,
    ...(typeof record.providerID === "string" ? { providerID: record.providerID } : {}),
  };
}

function parseCatalogEntry(value: unknown): AvailableModelRef | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.providerID !== "string") return null;
  const entry: AvailableModelRef = { providerID: record.providerID, id: record.id };
  if (typeof record.name === "string") entry.name = record.name;
  const time = record.time as Record<string, unknown> | undefined;
  if (time && typeof time.released === "number") entry.releasedMs = time.released;
  if (Array.isArray(record.cost)) {
    entry.free = record.cost.every((tier) => {
      if (typeof tier !== "object" || tier === null) return false;
      const item = tier as Record<string, unknown>;
      const cache = item.cache as Record<string, unknown> | undefined;
      return item.input === 0 && item.output === 0 && cache?.read === 0 && cache?.write === 0;
    });
  }
  return entry;
}

export const unavailableModelsProbe = (): Promise<OpencodeModelsProbe> =>
  Promise.resolve({ status: "unreachable", error: "scripted environment" });

export async function probeOpencodeModels(
  command: string,
  cwd: string,
  run: ModelProbeRunner = defaultModelProbeRunner,
): Promise<OpencodeModelsProbe> {
  const base = { command, serverUrl: null };
  const safeCwd = existsSync(cwd) ? cwd : process.cwd();
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  const remaining = () => Math.max(1, deadline - Date.now());
  try {
    const defaultArgs = buildApiArgs({ ...base, operation: "model.default" });
    const { stdout: defaultOut } = await run(defaultArgs, safeCwd, remaining());
    const defaultEnvelope = JSON.parse(defaultOut) as { data?: unknown };
    const defaultModel = parseModelRef(defaultEnvelope.data);
    let available: AvailableModelRef[] | undefined;
    try {
      const listArgs = buildApiArgs({ ...base, operation: "model.list" });
      const { stdout: listOut } = await run(listArgs, safeCwd, remaining());
      const listEnvelope = JSON.parse(listOut) as { data?: unknown[] };
      available = (listEnvelope.data ?? []).flatMap((entry) => {
        const parsed = parseCatalogEntry(entry);
        return parsed ? [parsed] : [];
      });
    } catch {
      void 0;
    }
    return { status: "ok", defaultModel, ...(available !== undefined ? { available } : {}) };
  } catch (e) {
    return { status: "unreachable", error: e instanceof Error ? e.message : String(e) };
  }
}

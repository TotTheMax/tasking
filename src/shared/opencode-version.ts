import { spawnSync } from "node:child_process";

export interface VersionGateResult {
  status: "unsupported" | "validated" | "unvalidated";
  normalized: string | null;
  hardFail: boolean;
  message?: string;
}

export const SUPPORTED_RANGE = { minMajor: 2, maxMajorExclusive: 3 };
export const VALIDATED_MINOR = 0;

export function parseOpencodeVersion(raw: string): string | null {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function classifyOpencodeVersion(raw: string): VersionGateResult {
  const normalized = parseOpencodeVersion(raw);
  if (normalized === null) {
    return {
      status: "unsupported",
      normalized: null,
      hardFail: true,
      message: `无法识别 opencode 版本（${raw || "空输出"}），tasking 0.7 需要 opencode >=2.0 <3`,
    };
  }
  const [majorRaw, minorRaw] = normalized.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  if (major < SUPPORTED_RANGE.minMajor || major >= SUPPORTED_RANGE.maxMajorExclusive) {
    return {
      status: "unsupported",
      normalized,
      hardFail: true,
      message: `opencode 版本不支持：检测到 ${normalized}，tasking 0.7 需要 opencode >=2.0 <3，请运行 opencode upgrade --major 升级`,
    };
  }
  if (minor !== VALIDATED_MINOR) {
    return {
      status: "unvalidated",
      normalized,
      hardFail: false,
      message: `opencode ${normalized} 未经验证（已验证：2.${VALIDATED_MINOR}.x），如遇异常请反馈`,
    };
  }
  return { status: "validated", normalized, hardFail: false };
}

export interface OpencodeServiceProbe {
  status: "running" | "stopped" | "unreachable";
  url?: string;
}

export interface OpencodeAuthProbe {
  ok: boolean;
  detail: string;
}

export function probeOpencodeVersion(): string | null {
  try {
    const res = spawnSync("opencode", ["--version"], { timeout: 5000, encoding: "utf8" });
    if (res.status !== 0 || res.error !== undefined) return null;
    const text = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    if (text === "") return null;
    return text.split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

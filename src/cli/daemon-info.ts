import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DaemonInfo {
  pid: number;
  port: number | null;
  host: string | null;
  started_at: number;
  workflow_path: string | null;
  log_path: string | null;
}

const DAEMON_JSON = () => resolve(process.cwd(), ".tasking", "daemon.json");
const DAEMON_PID = () => resolve(process.cwd(), ".tasking", "daemon.pid");

export function writeDaemonInfo(info: DaemonInfo): void {
  const dir = resolve(process.cwd(), ".tasking");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DAEMON_JSON(), JSON.stringify(info, null, 2));
  rmSync(DAEMON_PID(), { force: true });
}

export function readDaemonInfo(): DaemonInfo | null {
  const jsonPath = DAEMON_JSON();
  if (existsSync(jsonPath)) {
    try {
      const data = JSON.parse(readFileSync(jsonPath, "utf8")) as Partial<DaemonInfo>;
      if (typeof data.pid === "number") {
        return {
          pid: data.pid,
          port: typeof data.port === "number" ? data.port : null,
          host: typeof data.host === "string" ? data.host : null,
          started_at: typeof data.started_at === "number" ? data.started_at : Date.now(),
          workflow_path: typeof data.workflow_path === "string" ? data.workflow_path : null,
          log_path: typeof data.log_path === "string" ? data.log_path : null,
        };
      }
    } catch {
      // fall through to pid file
    }
  }
  const pidPath = DAEMON_PID();
  if (existsSync(pidPath)) {
    try {
      const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
      if (!Number.isNaN(pid)) {
        return {
          pid,
          port: null,
          host: null,
          started_at: Date.now(),
          workflow_path: null,
          log_path: null,
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function removeDaemonInfo(): void {
  rmSync(DAEMON_JSON(), { force: true });
  rmSync(DAEMON_PID(), { force: true });
}

export interface TuiTarget {
  host: string;
  port: number;
}

export function resolveTuiTarget(
  portOverride: number | undefined,
  info: DaemonInfo | null,
): TuiTarget {
  const host = info?.host ?? "127.0.0.1";
  if (portOverride !== undefined) {
    return { host, port: portOverride };
  }
  return { host, port: info?.port ?? 8080 };
}

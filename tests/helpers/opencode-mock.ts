import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

export interface OpencodeMockResponse {
  op: string;
  stdout?: string;
  exitCode?: number;
  stderr?: string;
}

export interface OpencodeMockScript {
  responses: OpencodeMockResponse[];
  version?: string;
}

const RUNNER_SOURCE = `
const fs = require("node:fs");
const path = require("node:path");
const stateFile = path.join(__dirname, ".used.json");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write((process.env.TASKING_OC_MOCK_VERSION ?? "opencode v2.0.29") + "\\n");
  process.exit(0);
}
let responses = [];
try {
  responses = JSON.parse(process.env.TASKING_OC_MOCK_RESPONSES ?? "[]");
} catch {}
function findOperation(argv) {
  const apiIdx = argv.indexOf("api");
  if (apiIdx === -1) return null;
  for (let i = apiIdx + 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const flagTakesValue =
        a === "--server" || a === "--param" || a === "--data" || a === "-H" || a === "--header";
      if (flagTakesValue) i += 1;
      continue;
    }
    return a;
  }
  return null;
}
const op = findOperation(args);
let used = {};
try {
  used = JSON.parse(fs.readFileSync(stateFile, "utf8"));
} catch {}
if (op === null) {
  process.stdout.write("{}\\n");
  process.exit(0);
}
const usedCount = used[op] ?? 0;
used[op] = usedCount + 1;
try {
  fs.writeFileSync(stateFile, JSON.stringify(used));
} catch {}
const candidates = responses.filter((r) => r.op === op);
const script = candidates[Math.min(usedCount, candidates.length - 1)];
if (script === undefined) {
  process.stderr.write("mock: no response for op " + op + "\\n");
  process.exit(1);
}
if (script.stderr) process.stderr.write(script.stderr);
process.stdout.write((script.stdout ?? "") + "\\n");
process.exit(script.exitCode ?? 0);
`;

export interface OpencodeMock {
  binDir: string;
  env: Record<string, string>;
  usedCounts: () => Record<string, number>;
}

export function createOpencodeMock(script: OpencodeMockScript): OpencodeMock {
  const binDir =
    process.env.TASKING_OC_MOCK_DIR ??
    join(tmpdir(), `tasking-oc-mock-${process.pid}-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "opencode"), `#!/usr/bin/env node\n${RUNNER_SOURCE}`, "utf8");
  chmodSync(join(binDir, "opencode"), 0o755);
  const stateFile = join(binDir, ".used.json");
  return {
    binDir,
    env: {
      TASKING_OC_MOCK_RESPONSES: JSON.stringify(script.responses),
      TASKING_OC_MOCK_VERSION: script.version ?? "opencode v2.0.29",
    },
    usedCounts: () => {
      try {
        return JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, number>;
      } catch {
        return {};
      }
    },
  };
}

export function mockPathEnv(mock: OpencodeMock): string {
  return `${mock.binDir}:${process.env.PATH ?? ""}`;
}

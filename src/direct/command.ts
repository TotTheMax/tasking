export interface DirectCommandOptions {
  opencodeCommand: string;
  dir: string;
  message: string;
  sessionId: string | null;
  autoApprove: boolean;
  agent?: string | null;
  model?: string | null;
  variant?: string | null;
}

export function buildDirectCommand(opts: DirectCommandOptions): string[] {
  const parts = opts.opencodeCommand.split(/\s+/).filter(Boolean);
  parts.push("--format", "json");
  if (opts.autoApprove) {
    parts.push("--auto");
  }
  if (opts.sessionId) {
    parts.push("-s", opts.sessionId);
  }
  parts.push("--dir", opts.dir);
  if (opts.agent) {
    parts.push("--agent", opts.agent);
  }
  if (opts.model) {
    parts.push("--model", opts.model);
  }
  if (opts.variant) {
    parts.push("--variant", opts.variant);
  }
  parts.push(opts.message);
  return parts;
}

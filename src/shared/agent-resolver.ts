import type { OpencodeConfig } from "../config/config-types.js";
import type { Task } from "./types.js";

const AGENT_LABEL_PREFIX = "agent:";

export interface ResolvedAgent {
  agent: string;
  warned: boolean;
}

export interface AgentResolverConfig {
  opencode: OpencodeConfig;
}

export function resolveAgent(task: Task, config: AgentResolverConfig): ResolvedAgent {
  const defaultAgent = config.opencode.agent;
  const label = task.labels.find((l) => l.startsWith(AGENT_LABEL_PREFIX));
  if (label === undefined) {
    return { agent: defaultAgent, warned: false };
  }
  const name = label.slice(AGENT_LABEL_PREFIX.length);
  const catalogue = config.opencode.agents;
  if (catalogue.length === 0) {
    return { agent: name, warned: false };
  }
  const lower = name.toLowerCase();
  const match = catalogue.find((entry) => entry.toLowerCase() === lower);
  if (match !== undefined) {
    return { agent: match, warned: false };
  }
  return { agent: defaultAgent, warned: true };
}

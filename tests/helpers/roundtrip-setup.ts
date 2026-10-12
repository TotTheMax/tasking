import { JiraTracker } from "../../src/adapters/jira/tracker.js";
import type {
  EffectiveConfig,
  FeishuConfig,
  TrackerConfig,
} from "../../src/config/config-types.js";
import { resolveConfig } from "../../src/config/resolver.js";

export interface HttpServerLike {
  baseUrl: string;
}

export function makeRoundTripConfig(server?: HttpServerLike, direct = false): EffectiveConfig {
  const tracker: Partial<TrackerConfig> = server
    ? {
        kind: "jira",
        api_key: "tok",
        api_user: "you@example.com",
        project_key: "ENG",
        endpoint: `${server.baseUrl}/rest/api/2`,
      }
    : { kind: "jira", api_key: "tok", api_user: "you@example.com", project_key: "ENG" };
  const directBlock = direct
    ? { enabled: true, projects: { tasking: "/tmp" }, verbosity: "detailed" as const }
    : undefined;
  const feishu: Partial<FeishuConfig> = {
    enabled: true,
    app_id: "c",
    app_secret: "s",
    intake_chat_id: "oc_intake",
    forward_interval_ms: 5000,
    sweep_interval_ms: 60000,
    create_issue_type: "Task",
    ...(directBlock === undefined ? {} : { direct: directBlock }),
  };
  return resolveConfig(
    { tracker, feishu } as Parameters<typeof resolveConfig>[0],
    "/tmp",
    "prompt",
  );
}

export function trackerFor(server: HttpServerLike): JiraTracker {
  return new JiraTracker(makeRoundTripConfig(server).tracker);
}

export function makeIssue(
  id: string,
  key: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, key, fields: { status: { name: "To Do" }, ...fields } };
}

export function searchResponse(issues: unknown[], total?: number): unknown {
  return { total: total ?? issues.length, issues };
}

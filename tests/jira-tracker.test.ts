import { describe, expect, it } from "vitest";
import {
  JiraTracker,
  isActiveState,
  isTerminalState,
  normalizeIssue,
} from "../src/adapters/jira/tracker.js";
import type { TrackerConfig } from "../src/config/config-types.js";
import { TaskingError } from "../src/shared/errors.js";

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    kind: "jira",
    endpoint: "https://example.atlassian.net/rest/api/3",
    api_key: "token",
    api_user: "you@example.com",
    auth_mode: "basic" as const,
    review_state: null,
    project_key: "ENG",
    project_slug: null,
    assignee: null,
    required_labels: [],
    active_states: ["To Do", "In Progress"],
    terminal_states: ["Done", "Closed", "Cancelled"],
    ...overrides,
  };
}

function mockFetch(responses: Array<{ status?: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function mockFetchCapturing(responses: Array<{ status?: number; body: unknown }>): {
  fetch: typeof fetch;
  bodies: unknown[];
} {
  let i = 0;
  const bodies: unknown[] = [];
  const f = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    if (init?.body) {
      try {
        bodies.push(JSON.parse(init.body as string));
      } catch {
        bodies.push(init.body);
      }
    }
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: f, bodies };
}

describe("normalizeIssue", () => {
  const issue = {
    id: "10001",
    key: "ENG-42",
    fields: {
      summary: "Fix the thing",
      priority: { id: "2", name: "High" },
      status: { name: "In Progress" },
      labels: ["Bug", " High "],
      issuelinks: [
        {
          type: { name: "Blocks" },
          inwardIssue: { id: "10002", key: "ENG-9", fields: { status: { name: "To Do" } } },
        },
      ],
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-02-01T00:00:00.000Z",
    },
  };

  it("normalizes labels to lowercase trimmed", () => {
    const task = normalizeIssue(issue, [], []);
    expect(task.labels).toEqual(["bug", "high"]);
  });

  it("normalizes priority to integer", () => {
    const task = normalizeIssue(issue, [], []);
    expect(task.priority).toBe(2);
  });

  it("normalizes non-integer priority to null", () => {
    const task = normalizeIssue(
      { ...issue, fields: { ...issue.fields, priority: "weird" } },
      [],
      [],
    );
    expect(task.priority).toBeNull();
  });

  it("derives blockers from issue links", () => {
    const task = normalizeIssue(issue, [], []);
    expect(task.blocked_by).toHaveLength(1);
    expect(task.blocked_by[0]?.identifier).toBe("ENG-9");
    expect(task.blocked_by[0]?.state).toBe("To Do");
  });

  it("parses ISO timestamps", () => {
    const task = normalizeIssue(issue, [], []);
    expect(task.created_at).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
});

describe("JiraTracker", () => {
  it("builds JQL filtering by project and active states", async () => {
    const fetched: Array<{ body: unknown }> = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      fetched.push(body);
      return new Response(JSON.stringify({ total: 0, issues: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    await tracker.fetchCandidateIssues();
    expect(fetched[0]?.jql).toContain("project = ENG");
    expect(fetched[0]?.jql).toContain('"To Do", "In Progress"');
  });

  it("fetchIssuesByStates([]) makes no API call", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    const result = await tracker.fetchIssuesByStates([]);
    expect(called).toBe(false);
    expect(result).toEqual([]);
  });

  it("paginates and preserves order", async () => {
    let page = 0;
    const fetchImpl = (async () => {
      page++;
      const issues =
        page === 1
          ? [{ id: "1", key: "ENG-1", fields: { status: { name: "To Do" } } }]
          : [{ id: "2", key: "ENG-2", fields: { status: { name: "To Do" } } }];
      return new Response(JSON.stringify({ total: 2, issues }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    const result = await tracker.fetchCandidateIssues({ pageSize: 1 });
    expect(result.map((t) => t.identifier)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("fetchIssueStatesByIds([]) makes no API call", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    const result = await tracker.fetchIssueStatesByIds([]);
    expect(called).toBe(false);
    expect(result).toEqual([]);
  });

  it("maps non-200 to jira_api_status", async () => {
    const fetchImpl = mockFetch([{ status: 401, body: { errorMessages: ["unauthorized"] } }]);
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    await expect(tracker.fetchCandidateIssues()).rejects.toThrow(TaskingError);
    try {
      await tracker.fetchCandidateIssues();
    } catch (e) {
      expect((e as TaskingError).category).toBe("jira_api_status");
    }
  });

  it("maps transport failure to jira_api_request", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    await expect(tracker.fetchCandidateIssues()).rejects.toThrow(TaskingError);
    try {
      await tracker.fetchCandidateIssues();
    } catch (e) {
      expect((e as TaskingError).category).toBe("jira_api_request");
    }
  });

  it("fetchServerInfo returns server version info", async () => {
    const fetchImpl = mockFetch([{ body: { version: "8.20.0", deploymentType: "Server" } }]);
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    const info = await tracker.fetchServerInfo();
    expect(info.version).toBe("8.20.0");
  });

  it("fetchProjectStatuses returns unique status names", async () => {
    const fetchImpl = mockFetch([
      {
        body: [
          {
            id: "10002",
            name: "Task",
            statuses: [
              { name: "To Do" },
              { name: "In Progress" },
              { name: "To Do" },
              { name: "Done" },
            ],
          },
        ],
      },
    ]);
    const tracker = new JiraTracker(makeConfig(), fetchImpl);
    const statuses = await tracker.fetchProjectStatuses();
    expect(statuses).toContain("To Do");
    expect(statuses).toContain("In Progress");
    expect(statuses).toContain("Done");
    expect(statuses.length).toBe(3);
  });

  it("fetchProjectStatuses returns empty array when no project key", async () => {
    const tracker = new JiraTracker(makeConfig({ project_key: null, project_slug: null }));
    const result = await tracker.fetchProjectStatuses();
    expect(result).toEqual([]);
  });
});

describe("state helpers", () => {
  it("isActiveState is case-insensitive", () => {
    expect(isActiveState("in progress", ["In Progress"])).toBe(true);
  });

  it("isTerminalState is case-insensitive", () => {
    expect(isTerminalState("DONE", ["Done"])).toBe(true);
  });
});

describe("normalizeIssue url and blockers", () => {
  it("fills url from endpoint", () => {
    const issue = { id: "123", key: "ENG-42", fields: { summary: "Test" } };
    const task = normalizeIssue(issue, [], [], "https://example.atlassian.net/rest/api/3");
    expect(task.url).toBe("https://example.atlassian.net/browse/ENG-42");
  });

  it("fills url from endpoint with trailing slash", () => {
    const issue = { id: "123", key: "ENG-42", fields: { summary: "Test" } };
    const task = normalizeIssue(issue, [], [], "https://example.atlassian.net/rest/api/3/");
    expect(task.url).toBe("https://example.atlassian.net/browse/ENG-42");
  });

  it("url is null when no endpoint", () => {
    const issue = { id: "123", key: "ENG-42", fields: { summary: "Test" } };
    const task = normalizeIssue(issue, [], []);
    expect(task.url).toBeNull();
  });

  it("blocked_by matches case-insensitive relation type", () => {
    const issue = {
      id: "1",
      key: "ENG-1",
      fields: {
        summary: "Test",
        issuelinks: [
          {
            type: { name: "blocks" },
            inwardIssue: { id: "2", key: "ENG-2", fields: { status: { name: "Done" } } },
          },
          {
            type: { name: "BLOCKED" },
            inwardIssue: { id: "3", key: "ENG-3", fields: { status: { name: "To Do" } } },
          },
        ],
      },
    };
    const task = normalizeIssue(issue, [], []);
    expect(task.blocked_by.length).toBe(2);
    expect(task.blocked_by[0]?.identifier).toBe("ENG-2");
    expect(task.blocked_by[1]?.identifier).toBe("ENG-3");
  });

  it("extracts assignee accountId", () => {
    const issue = {
      id: "1",
      key: "ENG-1",
      fields: { summary: "Test", assignee: { accountId: "abc123", displayName: "Bob" } },
    };
    const task = normalizeIssue(issue, [], []);
    expect(task.assignee).toBe("abc123");
  });

  it("extracts assignee name on Server/DC (no accountId, only name)", () => {
    const issue = {
      id: "1",
      key: "ENG-1",
      fields: {
        summary: "Test",
        assignee: { name: "bob", emailAddress: "bob@x", displayName: "Bob" },
      },
    };
    const task = normalizeIssue(issue, [], []);
    expect(task.assignee).toBe("bob");
  });

  it("falls back to emailAddress when only that is present", () => {
    const issue = {
      id: "1",
      key: "ENG-1",
      fields: { summary: "Test", assignee: { emailAddress: "bob@x" } },
    };
    const task = normalizeIssue(issue, [], []);
    expect(task.assignee).toBe("bob@x");
  });

  it("assignee is null when unassigned", () => {
    const issue = { id: "1", key: "ENG-1", fields: { summary: "Test" } };
    const task = normalizeIssue(issue, [], []);
    expect(task.assignee).toBeNull();
  });
});

describe("JQL assignee filter", () => {
  it("includes assignee filter when configured", async () => {
    const config = makeConfig({ assignee: "bob@example.com" });
    const { fetch: f, bodies } = mockFetchCapturing([{ body: { total: 0, issues: [] } }]);
    const tracker = new JiraTracker(config, f);
    await tracker.fetchCandidateIssues();
    const body = bodies[0] as { jql?: string } | undefined;
    expect(body?.jql).toContain('assignee = "bob@example.com"');
  });

  it("uses currentUser() when assignee is 'me'", async () => {
    const config = makeConfig({ assignee: "me" });
    const { fetch: f, bodies } = mockFetchCapturing([{ body: { total: 0, issues: [] } }]);
    const tracker = new JiraTracker(config, f);
    await tracker.fetchCandidateIssues();
    const body = bodies[0] as { jql?: string } | undefined;
    expect(body?.jql).toContain("assignee = currentUser()");
  });

  it("omits assignee filter when not configured", async () => {
    const config = makeConfig({ assignee: null });
    const { fetch: f, bodies } = mockFetchCapturing([{ body: { total: 0, issues: [] } }]);
    const tracker = new JiraTracker(config, f);
    await tracker.fetchCandidateIssues();
    const body = bodies[0] as { jql?: string } | undefined;
    expect(body?.jql).not.toContain("assignee");
  });
});

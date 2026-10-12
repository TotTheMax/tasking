import { afterEach, describe, expect, it } from "vitest";
import { JiraTracker } from "../src/adapters/jira/tracker.js";
import type { TrackerConfig } from "../src/config/config-types.js";
import { TaskingError } from "../src/shared/errors.js";
import {
  type MockHandler,
  type MockServer,
  createMockJiraServer,
} from "./helpers/mock-http-server.js";

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    kind: "jira",
    endpoint: "http://127.0.0.1:0/rest/api/2",
    api_key: "token",
    api_user: "you@example.com",
    auth_mode: "basic",
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

function makeIssue(id: string, key: string, fields: Record<string, unknown> = {}): unknown {
  return { id, key, fields: { status: { name: "To Do" }, ...fields } };
}

function searchResponse(issues: unknown[], total?: number): unknown {
  return { total: total ?? issues.length, issues };
}

function jqlOf(req: unknown): string {
  const body = req as { jql?: string } | undefined;
  return body?.jql ?? "";
}

function startArrayOf(req: unknown): number {
  const body = req as { startAt?: number } | undefined;
  return body?.startAt ?? 0;
}

describe("Mock HTTP Server helper", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("records request method, url, headers, and body", async () => {
    const handler: MockHandler = () => ({ status: 200, body: { ok: true } });
    server = await createMockJiraServer(handler);
    const res = await fetch(`${server.baseUrl}/rest/api/2/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jql: "project = ENG", startAt: 0 }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);

    expect(server.requests).toHaveLength(1);
    const req = server.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/search");
    expect((req.body as { jql: string }).jql).toBe("project = ENG");
  });

  it("close releases the port", async () => {
    const handler: MockHandler = () => ({ status: 200, body: {} });
    const s = await createMockJiraServer(handler);
    await s.close();
    await expect(fetch(`${s.baseUrl}/test`)).rejects.toThrow();
  });
});

describe("Fallback paths", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("fetchCandidateIssues falls back to all-project query on jira_api_status", async () => {
    const issues = [
      makeIssue("1", "ENG-1", { status: { name: "To Do" } }),
      makeIssue("2", "ENG-2", { status: { name: "In Progress" } }),
      makeIssue("3", "ENG-3", { status: { name: "Done" } }),
    ];
    const handler: MockHandler = (req) => {
      if (jqlOf(req.body).includes("status in")) {
        return { status: 400, body: { errorMessages: ["JQL too complex"] } };
      }
      return { status: 200, body: searchResponse(issues) };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(server.requests).toHaveLength(2);
  });

  it("fetchIssuesByStates falls back to all-project query on jira_api_status", async () => {
    const issues = [
      makeIssue("1", "ENG-1", { status: { name: "In Review" } }),
      makeIssue("2", "ENG-2", { status: { name: "In Review" } }),
      makeIssue("3", "ENG-3", { status: { name: "Done" } }),
    ];
    const handler: MockHandler = (req) => {
      if (jqlOf(req.body).includes("status in")) {
        return { status: 500, body: { error: "server error" } };
      }
      return { status: 200, body: searchResponse(issues) };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchIssuesByStates(["In Review"]);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.identifier)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("non-jira_api_status error does not trigger fallback", async () => {
    const handler: MockHandler = () => ({ status: 200, body: {}, delayMs: 500 });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const err = await tracker.fetchCandidateIssues({ timeoutMs: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TaskingError);
    expect((err as TaskingError).category).toBe("jira_api_request");
    expect(server.requests).toHaveLength(1);
  });
});

describe("Candidate field enumeration", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("requests the enumerated field set, not *all", async () => {
    const handler: MockHandler = () => ({ status: 200, body: searchResponse([]) });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    await tracker.fetchCandidateIssues();
    expect(server.requests).toHaveLength(1);
    const body = server.requests[0]?.body as { fields?: string[] };
    expect(body.fields).toEqual([
      "summary",
      "description",
      "priority",
      "status",
      "labels",
      "assignee",
      "issuelinks",
      "created",
      "updated",
    ]);
    expect(body.fields).not.toContain("*all");
  });

  it("still normalizes all Task fields from the enumerated response", async () => {
    const issue = makeIssue("10001", "ENG-1", {
      summary: "s",
      description: "d",
      priority: { id: "2" },
      status: { name: "In Progress" },
      labels: ["Agent-Review"],
      assignee: { accountId: "u1" },
      created: "2024-01-01T00:00:00.000+0000",
      updated: "2024-01-02T00:00:00.000+0000",
    });
    const handler: MockHandler = () => ({ status: 200, body: searchResponse([issue]) });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const [t] = await tracker.fetchCandidateIssues();
    expect(t?.title).toBe("s");
    expect(t?.description).toBe("d");
    expect(t?.priority).toBe(2);
    expect(t?.state).toBe("In Progress");
    expect(t?.labels).toEqual(["agent-review"]);
    expect(t?.assignee).toBe("u1");
    expect(t?.created_at).toBeTypeOf("number");
  });
});

describe("fetchIssueStatesByIds real ID queries", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("numeric IDs have no quotes in JQL", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    await tracker.fetchIssueStatesByIds(["10001", "10002"]);
    expect(jqlOf(server.requests[0]?.body)).toContain("id in (10001, 10002)");
  });

  it("non-numeric IDs are quoted in JQL", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    await tracker.fetchIssueStatesByIds(["ENG-1", "ENG-2"]);
    expect(jqlOf(server.requests[0]?.body)).toContain('id in ("ENG-1", "ENG-2")');
  });

  it("mixed numeric and non-numeric IDs", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    await tracker.fetchIssueStatesByIds(["10001", "ENG-2"]);
    expect(jqlOf(server.requests[0]?.body)).toContain('id in (10001, "ENG-2")');
  });

  it("returns normalized tasks", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([makeIssue("10001", "ENG-1", { status: { name: "In Progress" } })]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchIssueStatesByIds(["10001"]);
    expect(result).toHaveLength(1);
    const task = result[0];
    expect(task.id).toBe("10001");
    expect(task.identifier).toBe("ENG-1");
    expect(task.state).toBe("In Progress");
  });
});

describe("Authentication headers", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("bearer mode sends Authorization: Bearer <token>", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(
      makeConfig({
        endpoint: `${server.baseUrl}/rest/api/2`,
        auth_mode: "bearer",
        api_key: "tok123",
        api_user: null,
      }),
    );
    await tracker.fetchCandidateIssues();
    const auth = server.requests[0]?.headers.authorization;
    expect(auth).toBe("Bearer tok123");
  });

  it("basic mode sends Authorization: Basic <base64(user:token)>", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(
      makeConfig({
        endpoint: `${server.baseUrl}/rest/api/2`,
        auth_mode: "basic",
        api_user: "alice",
        api_key: "secret",
      }),
    );
    await tracker.fetchCandidateIssues();
    const expected = `Basic ${Buffer.from("alice:secret").toString("base64")}`;
    expect(server.requests[0]?.headers.authorization).toBe(expected);
  });

  it("sends Content-Type and Accept headers", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    await tracker.fetchCandidateIssues();
    const headers = server.requests[0]?.headers;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.accept).toBe("application/json");
  });
});

describe("Endpoint URL construction", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("strips trailing single slash", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2/` }));
    await tracker.fetchCandidateIssues();
    expect(server.requests[0]?.url).toBe("/rest/api/2/search");
  });

  it("strips trailing multiple slashes", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2//` }));
    await tracker.fetchCandidateIssues();
    expect(server.requests[0]?.url).toBe("/rest/api/2/search");
  });
});

describe("Pagination boundaries", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("terminates after first page when total field is missing", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: { issues: [makeIssue("1", "ENG-1")] },
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result).toHaveLength(1);
    expect(result[0]?.identifier).toBe("ENG-1");
    expect(server.requests).toHaveLength(1);
  });

  it("stops after one request when issues < pageSize", async () => {
    const issues = Array.from({ length: 10 }, (_, i) => makeIssue(String(i + 1), `ENG-${i + 1}`));
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse(issues, 10),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues({ pageSize: 50 });
    expect(result).toHaveLength(10);
    expect(server.requests).toHaveLength(1);
  });

  it("merges multi-page results in order", async () => {
    const handler: MockHandler = (req) => {
      const startAt = startArrayOf(req.body);
      if (startAt === 0) {
        return {
          status: 200,
          body: searchResponse([makeIssue("1", "ENG-1")], 2),
        };
      }
      return {
        status: 200,
        body: searchResponse([makeIssue("2", "ENG-2")], 2),
      };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues({ pageSize: 1 });
    expect(result.map((t) => t.id)).toEqual(["1", "2"]);
  });
});

describe("Malformed responses", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("non-JSON body maps to jira_api_request error", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: "<html>error</html>",
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const err = await tracker.fetchCandidateIssues().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TaskingError);
    expect((err as TaskingError).category).toBe("jira_api_request");
  });

  it("missing issues field returns empty result", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: { total: 5 },
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result).toEqual([]);
  });

  it("empty issues array terminates loop", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([], 0),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result).toEqual([]);
    expect(server.requests).toHaveLength(1);
  });
});

describe("updateIssue", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("PUTs fields to /issue/<key> on success", async () => {
    const handler: MockHandler = (req) => ({ status: 204, body: "" });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    await tracker.updateIssue("ENG-1", { labels: ["bug", "agent:review"] });
    const req = server.requests[0];
    expect(req?.method).toBe("PUT");
    expect(req?.url).toBe("/rest/api/2/issue/ENG-1");
    expect((req?.body as { fields?: { labels?: string[] } }).fields?.labels).toEqual([
      "bug",
      "agent:review",
    ]);
  });

  it("maps non-2xx to jira_api_status", async () => {
    const handler: MockHandler = () => ({ status: 400, body: { errors: { labels: "bad" } } });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const err = await tracker.updateIssue("ENG-1", { labels: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TaskingError);
    expect((err as TaskingError).category).toBe("jira_api_status");
  });
});

describe("Normalization edge cases", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("assignee emailAddress fallback", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([
        makeIssue("1", "ENG-1", {
          assignee: { emailAddress: "bob@example.com", displayName: "Bob" },
        }),
      ]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result[0]?.assignee).toBe("bob@example.com");
  });

  it("assignee key fallback", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([makeIssue("1", "ENG-1", { assignee: { key: "userkey123" } })]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result[0]?.assignee).toBe("userkey123");
  });

  it("assignee name preferred over email (Jira Server/DC)", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([
        makeIssue("1", "ENG-1", {
          assignee: { name: "haha66", emailAddress: "bob@example.com", key: "haha66" },
        }),
      ]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result[0]?.assignee).toBe("haha66");
  });

  it("numeric priority is preserved", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([makeIssue("1", "ENG-1", { priority: 3 })]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result[0]?.priority).toBe(3);
  });

  it("non-Blocks relation types are filtered out", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([
        makeIssue("1", "ENG-1", {
          issuelinks: [
            {
              type: { name: "Relates" },
              inwardIssue: { id: "9", key: "ENG-9", fields: { status: { name: "Done" } } },
            },
            {
              type: { name: "Blocks" },
              inwardIssue: { id: "2", key: "ENG-2", fields: { status: { name: "To Do" } } },
            },
          ],
        }),
      ]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result[0]?.blocked_by).toHaveLength(1);
    expect(result[0]?.blocked_by[0]?.identifier).toBe("ENG-2");
  });

  it("Blocks link without inwardIssue is skipped", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: searchResponse([
        makeIssue("1", "ENG-1", {
          issuelinks: [{ type: { name: "Blocks" } }],
        }),
      ]),
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    const result = await tracker.fetchCandidateIssues();
    expect(result[0]?.blocked_by).toEqual([]);
  });
});

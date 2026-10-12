import { afterEach, describe, expect, it } from "vitest";
import {
  JiraTracker,
  flattenAdfText,
  wrapCommentBody,
  wrapDescription,
} from "../src/adapters/jira/tracker.js";
import type { TrackerConfig } from "../src/config/config-types.js";
import {
  type MockHandler,
  type MockServer,
  createMockJiraServer,
} from "./helpers/mock-http-server.js";

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    kind: "jira",
    endpoint: "http://127.0.0.1:0/rest/api/3",
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

function adf(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("JiraTracker comment/issue/state operations", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("fetchComments returns flattened text + authorName, filtered by id > afterId", async () => {
    const handler: MockHandler = (req) => {
      expect(req.url).toBe("/rest/api/3/issue/ENG-1/comment");
      return {
        status: 200,
        body: {
          comments: [
            { id: "10001", author: { displayName: "Alice" }, body: adf("first"), created: "t1" },
            { id: "10002", author: { emailAddress: "bob@x" }, body: adf("second"), created: "t2" },
            { id: "10003", author: null, body: "plain v2", created: "t3" },
          ],
        },
      };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    const result = await tracker.fetchComments("ENG-1", "10001");
    expect(result.map((c) => c.id)).toEqual(["10002", "10003"]);
    expect(result[0]?.authorName).toBe("bob@x");
    expect(result[0]?.text).toBe("second");
    expect(result[1]?.authorName).toBeNull();
    expect(result[1]?.text).toBe("plain v2");
  });

  it("fetchComments returns all when afterCommentId is null", async () => {
    const handler: MockHandler = () => ({
      status: 200,
      body: { comments: [{ id: "1", author: null, body: "x", created: "t" }] },
    });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    const result = await tracker.fetchComments("ENG-1", null);
    expect(result).toHaveLength(1);
  });

  it("postComment wraps body as ADF on v3 endpoint", async () => {
    const handler: MockHandler = (req) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/rest/api/3/issue/ENG-1/comment");
      const body = req.body as { body?: { type: string } };
      expect(body.body?.type).toBe("doc");
      return { status: 201, body: { id: "100" } };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    await tracker.postComment("ENG-1", "💬 张三 via 飞书 [msg:om_1]:\nhi");
  });

  it("postComment sends bare string on v2 endpoint", async () => {
    const handler: MockHandler = (req) => {
      const body = req.body as { body?: unknown };
      expect(body.body).toBe("just text");
      return { status: 201, body: { id: "100" } };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    await tracker.postComment("ENG-1", "just text");
  });

  it("createIssue POSTs fields and returns key", async () => {
    const handler: MockHandler = (req) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/rest/api/3/issue");
      const body = req.body as { fields?: { summary?: string } };
      expect(body.fields?.summary).toBe("title");
      return { status: 201, body: { key: "ENG-42", id: "10042" } };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    const created = await tracker.createIssue({
      project: { key: "ENG" },
      summary: "title",
      issuetype: { name: "Task" },
    });
    expect(created.key).toBe("ENG-42");
    expect(created.id).toBe("10042");
  });

  it("createIssue throws when key missing", async () => {
    const handler: MockHandler = () => ({ status: 201, body: {} });
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    await expect(tracker.createIssue({ summary: "x" })).rejects.toThrow();
  });

  it("fetchTransitions returns id + toName", async () => {
    const handler: MockHandler = (req) => {
      expect(req.url).toBe("/rest/api/3/issue/ENG-1/transitions");
      return {
        status: 200,
        body: {
          transitions: [
            { id: "11", name: "To Done", to: { name: "Done" } },
            { id: "21", name: "In Review", to: { name: "In Review" } },
          ],
        },
      };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    const result = await tracker.fetchTransitions("ENG-1");
    expect(result.map((t) => t.toName)).toEqual(["Done", "In Review"]);
    expect(result[0]?.id).toBe("11");
  });

  it("transitionIssue POSTs transition id", async () => {
    const handler: MockHandler = (req) => {
      expect(req.method).toBe("POST");
      const body = req.body as { transition?: { id?: string } };
      expect(body.transition?.id).toBe("11");
      return { status: 204, body: {} };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    await tracker.transitionIssue("ENG-1", "11");
  });

  it("fetchIssueTypes returns issueType names from project", async () => {
    const handler: MockHandler = (req) => {
      expect(req.url).toBe("/rest/api/3/project/ENG");
      return { status: 200, body: { issueTypes: [{ name: "Story" }, { name: "Bug" }] } };
    };
    server = await createMockJiraServer(handler);
    const tracker = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    const result = await tracker.fetchIssueTypes();
    expect(result).toEqual(["Story", "Bug"]);
  });

  it("isApiV3 detects version from endpoint", async () => {
    server = await createMockJiraServer(() => ({ status: 200, body: {} }));
    const v3 = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/3` }));
    const v2 = new JiraTracker(makeConfig({ endpoint: `${server.baseUrl}/rest/api/2` }));
    expect(v3.isApiV3()).toBe(true);
    expect(v2.isApiV3()).toBe(false);
  });
});

describe("ADF helpers", () => {
  it("flattenAdfText extracts text from nested ADF", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello " }] },
        { type: "paragraph", content: [{ type: "text", text: "world" }] },
      ],
    };
    expect(flattenAdfText(doc)).toBe("hello world");
  });

  it("flattenAdfText passes strings through", () => {
    expect(flattenAdfText("just a string")).toBe("just a string");
  });

  it("wrapCommentBody builds ADF doc when useAdf", () => {
    const body = wrapCommentBody("hi", true) as {
      type: string;
      content: Array<{ content: Array<{ text: string }> }>;
    };
    expect(body.type).toBe("doc");
    expect(body.content[0]?.content[0]?.text).toBe("hi");
  });

  it("wrapCommentBody returns bare string when not useAdf", () => {
    expect(wrapCommentBody("hi", false)).toBe("hi");
  });

  it("wrapDescription returns bare string with newlines when not useAdf", () => {
    expect(wrapDescription("line1\nline2", false)).toBe("line1\nline2");
  });

  it("wrapDescription builds ADF doc with one paragraph per line when useAdf", () => {
    const doc = wrapDescription("line1\nline2\n\nline3", true) as {
      type: string;
      content: Array<{ type: string; content: Array<{ type: string; text: string }> }>;
    };
    expect(doc.type).toBe("doc");
    expect(doc.content.map((p) => p.content[0]?.text)).toEqual(["line1", "line2", "line3"]);
  });
});

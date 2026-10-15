import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerConfig } from "../src/config/config-types.js";
import { buildMcpConfig, injectMcpConfig } from "../src/mcp/inject.js";
import {
  buildMultipartBody,
  executeJiraUploadAttachment,
  handleToolsCall,
  handleToolsList,
} from "../src/mcp/jira-server.js";

function makeTracker(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    kind: "jira",
    endpoint: "http://example.net/rest/api/2",
    api_key: "tok",
    api_user: "user@e.com",
    auth_mode: "basic",
    review_state: null,
    project_key: "ENG",
    project_slug: null,
    assignee: null,
    required_labels: [],
    active_states: ["To Do"],
    terminal_states: ["Done"],
    ...overrides,
  };
}

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "tasking-mcp-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("buildMcpConfig", () => {
  it("builds config with jira MCP server under mcp.servers (v2)", () => {
    const config = buildMcpConfig(makeTracker({ auth_mode: "bearer", api_key: "mytoken" }));
    const servers = (config.mcp as Record<string, unknown>).servers as Record<string, unknown>;
    const jira = servers.jira as Record<string, unknown>;
    expect(jira.type).toBe("local");
    expect(jira.command).toBeDefined();
    expect(jira.codemode).toBe(false);
    const env = jira.environment as Record<string, string>;
    expect(env.JIRA_ENDPOINT).toBe("http://example.net/rest/api/2");
    expect(env.JIRA_AUTH_MODE).toBe("bearer");
    expect(env.JIRA_API_KEY).toBe("mytoken");
  });

  it("includes basic auth env vars", () => {
    const config = buildMcpConfig(makeTracker({ auth_mode: "basic", api_user: "u@e.com" }));
    const servers = (config.mcp as Record<string, unknown>).servers as Record<string, unknown>;
    const env = (servers.jira as Record<string, unknown>).environment as Record<string, string>;
    expect(env.JIRA_AUTH_MODE).toBe("basic");
    expect(env.JIRA_API_USER).toBe("u@e.com");
  });

  it("does not place servers directly under mcp (v2 rule)", () => {
    const config = buildMcpConfig(makeTracker());
    const mcp = config.mcp as Record<string, unknown>;
    expect(mcp.servers).toBeDefined();
    expect(mcp.jira).toBeUndefined();
  });
});

describe("injectMcpConfig", () => {
  it("creates .opencode/opencode.json with jira MCP config under mcp.servers", () => {
    injectMcpConfig(workspace, makeTracker());
    const configPath = join(workspace, ".opencode", "opencode.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.mcp.servers.jira).toBeDefined();
    expect(config.mcp.servers.jira.codemode).toBe(false);
    expect(config.mcp.servers.jira.environment.JIRA_ENDPOINT).toBe("http://example.net/rest/api/2");
  });

  it("merges with existing .opencode/opencode.json preserving other servers", () => {
    const dir = join(workspace, ".opencode");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "opencode.json"),
      JSON.stringify({ mcp: { servers: { "other-tool": { type: "local", command: ["echo"] } } } }),
    );

    injectMcpConfig(workspace, makeTracker());

    const config = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8"));
    expect(config.mcp.servers["other-tool"]).toBeDefined();
    expect(config.mcp.servers.jira).toBeDefined();
  });

  it("never writes a permissions key", () => {
    injectMcpConfig(workspace, makeTracker());
    const config = JSON.parse(readFileSync(join(workspace, ".opencode", "opencode.json"), "utf8"));
    expect(config.permissions).toBeUndefined();
  });

  it("preserves a user-written permissions key untouched", () => {
    const dir = join(workspace, ".opencode");
    mkdirSync(dir, { recursive: true });
    const userPerms = [{ action: "shell", resource: "*", effect: "ask" }];
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ permissions: userPerms }));

    injectMcpConfig(workspace, makeTracker());

    const config = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8"));
    expect(config.permissions).toEqual(userPerms);
    expect(config.mcp.servers.jira).toBeDefined();
  });
});

describe("handleToolsList", () => {
  it("returns both jira_rest and jira_upload_attachment tools", () => {
    const result = handleToolsList() as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("jira_rest");
    expect(names).toContain("jira_upload_attachment");
    expect(result.tools).toHaveLength(2);
  });

  it("jira_upload_attachment inputSchema has required issue_key, filename, content", () => {
    const result = handleToolsList() as {
      tools: Array<{ name: string; inputSchema: { required: string[] } }>;
    };
    const uploadTool = result.tools.find((t) => t.name === "jira_upload_attachment");
    expect(uploadTool).toBeDefined();
    expect(uploadTool?.inputSchema.required).toEqual(
      expect.arrayContaining(["issue_key", "filename", "content"]),
    );
  });
});

describe("buildMultipartBody", () => {
  it("constructs multipart body with correct boundary and filename", () => {
    const boundary = "testboundary123";
    const filename = "report.pdf";
    const content = Buffer.from("hello world").toString("base64");
    const body = buildMultipartBody(filename, content, boundary);
    const text = body.toString("utf8");
    expect(text).toContain(`--${boundary}`);
    expect(text).toContain(`name="file"`);
    expect(text).toContain(`filename="${filename}"`);
    expect(text).toContain(`--${boundary}--`);
  });
});

describe("executeJiraUploadAttachment", () => {
  beforeEach(() => {
    process.env.JIRA_ENDPOINT = "http://example.net/rest/api/2";
    process.env.JIRA_AUTH_MODE = "basic";
    process.env.JIRA_API_KEY = "tok";
    process.env.JIRA_API_USER = "user@e.com";
  });

  afterEach(() => {
    delete process.env.JIRA_ENDPOINT;
    delete process.env.JIRA_AUTH_MODE;
    delete process.env.JIRA_API_KEY;
    delete process.env.JIRA_API_USER;
  });

  it("rejects oversized content (>10MB) without calling fetch", async () => {
    const oversized = "a".repeat(10 * 1024 * 1024 + 1);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await executeJiraUploadAttachment("OS-1", "big.txt", oversized);
    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("exceeds 10MB limit");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("accepts normal-sized content and calls fetch", async () => {
    const content = Buffer.from("small file").toString("base64");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: "att-1", filename: "small.txt" }]),
    } as Response);
    const result = await executeJiraUploadAttachment("OS-1", "small.txt", content);
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});

describe("handleToolsCall with two registered tools", () => {
  it("returns error for unknown tool name", async () => {
    const result = (await handleToolsCall({ name: "nonexistent_tool", arguments: {} })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("unknown tool");
  });
});

describe("MCP notification handling", () => {
  it("handleRequest returns null for notifications/initialized (no id)", async () => {
    const { handleRequest } = await import("../src/mcp/jira-server.js");
    const res = await (handleRequest as unknown as (req: unknown) => Promise<unknown>)({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(res).toBeNull();
  });

  it("handleRequest returns null for unknown notification (no id)", async () => {
    const { handleRequest } = await import("../src/mcp/jira-server.js");
    const res = await (handleRequest as unknown as (req: unknown) => Promise<unknown>)({
      jsonrpc: "2.0",
      method: "notifications/unknown_thing",
    });
    expect(res).toBeNull();
  });

  it("handleRequest returns result for ping (has id)", async () => {
    const { handleRequest } = await import("../src/mcp/jira-server.js");
    const res = (await (handleRequest as unknown as (req: unknown) => Promise<unknown>)({
      jsonrpc: "2.0",
      id: 42,
      method: "ping",
    })) as { id: number; result: unknown };
    expect(res.id).toBe(42);
    expect(res.result).toEqual({});
  });

  it("handleRequest returns error for unknown method with id", async () => {
    const { handleRequest } = await import("../src/mcp/jira-server.js");
    const res = (await (handleRequest as unknown as (req: unknown) => Promise<unknown>)({
      jsonrpc: "2.0",
      id: 99,
      method: "nonexistent",
    })) as { id: number; error: { code: number } };
    expect(res.id).toBe(99);
    expect(res.error.code).toBe(-32601);
  });
});

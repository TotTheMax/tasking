import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const TOOL_NAME = "jira_rest";
const TOOL_DESCRIPTION =
  "Execute a Jira REST API call. Uses the tracker credentials configured in WORKFLOW.md (agent never sees tokens).";

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    method: {
      type: "string",
      description: "HTTP method (GET, POST, PUT, DELETE)",
      enum: ["GET", "POST", "PUT", "DELETE"],
    },
    path: {
      type: "string",
      description:
        "Jira REST API path (e.g. /issue/OS-262, /issue/OS-262/transitions, /issue/OS-262/comment)",
    },
    body: {
      type: "object",
      description: "Optional JSON request body",
    },
  },
  required: ["method", "path"],
};

const UPLOAD_TOOL_NAME = "jira_upload_attachment";
const UPLOAD_TOOL_DESCRIPTION =
  "Upload a file attachment to a Jira issue. Uses the tracker credentials configured in WORKFLOW.md (agent never sees tokens).";

const UPLOAD_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    issue_key: {
      type: "string",
      description: "Jira issue key (e.g. OS-262)",
    },
    filename: {
      type: "string",
      description: "Name of the attachment file (e.g. screenshot.png)",
    },
    content: {
      type: "string",
      description: "Base64-encoded file content",
    },
  },
  required: ["issue_key", "filename", "content"],
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function getEnv(key: string): string | null {
  const v = process.env[key];
  return v && v !== "" ? v : null;
}

function buildAuthHeader(): string {
  const authMode = getEnv("JIRA_AUTH_MODE") ?? "basic";
  const apiKey = getEnv("JIRA_API_KEY") ?? "";
  if (authMode === "bearer") {
    return `Bearer ${apiKey}`;
  }
  const apiUser = getEnv("JIRA_API_USER") ?? "";
  const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");
  return `Basic ${credentials}`;
}

function buildBaseUrl(): string {
  const endpoint = getEnv("JIRA_ENDPOINT") ?? "";
  return endpoint.replace(/\/+$/, "");
}

export function generateBoundary(): string {
  return randomBytes(16).toString("hex");
}

export function buildMultipartBody(
  filename: string,
  contentBase64: string,
  boundary: string,
): Buffer {
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const fileContent = Buffer.from(contentBase64, "base64");
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return Buffer.concat([header, fileContent, footer]);
}

export async function executeJiraUploadAttachment(
  issueKey: string,
  filename: string,
  contentBase64: string,
): Promise<{ success: boolean; status: number; data?: unknown; error?: string }> {
  if (Buffer.byteLength(contentBase64, "utf8") > MAX_ATTACHMENT_BYTES) {
    return {
      success: false,
      status: 0,
      error: "attachment exceeds 10MB limit",
    };
  }
  const base = buildBaseUrl();
  const path = `/issue/${encodeURIComponent(issueKey)}/attachments`;
  const url = `${base}${path}`;
  const boundary = generateBoundary();
  const body = buildMultipartBody(filename, contentBase64, boundary);
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(),
    Accept: "application/json",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "X-Atlassian-Token": "no-check",
  };
  try {
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep as text
    }
    if (!res.ok) {
      return { success: false, status: res.status, error: `Jira API returned ${res.status}`, data };
    }
    return { success: true, status: res.status, data };
  } catch (e) {
    return {
      success: false,
      status: 0,
      error: `Jira API request failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function executeJiraRest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ success: boolean; status: number; data?: unknown; error?: string }> {
  const base = buildBaseUrl();
  const url = `${base}${path}`;
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(),
    Accept: "application/json",
  };
  let requestBody: string | undefined;
  if (body && method !== "GET") {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, { method, headers, body: requestBody });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep as text
    }
    if (!res.ok) {
      return { success: false, status: res.status, error: `Jira API returned ${res.status}`, data };
    }
    return { success: true, status: res.status, data };
  } catch (e) {
    return {
      success: false,
      status: 0,
      error: `Jira API request failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function handleToolsList(): JsonRpcResponse["result"] {
  return {
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: TOOL_INPUT_SCHEMA,
      },
      {
        name: UPLOAD_TOOL_NAME,
        description: UPLOAD_TOOL_DESCRIPTION,
        inputSchema: UPLOAD_TOOL_INPUT_SCHEMA,
      },
    ],
  };
}

export async function handleToolsCall(
  params: Record<string, unknown>,
): Promise<JsonRpcResponse["result"]> {
  const toolName = params.name as string | undefined;
  const args = (params.arguments as Record<string, unknown>) ?? {};

  if (toolName === UPLOAD_TOOL_NAME) {
    const issueKey = typeof args.issue_key === "string" ? args.issue_key : "";
    const filename = typeof args.filename === "string" ? args.filename : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!issueKey || !filename || !content) {
      return {
        content: [
          {
            type: "text",
            text: "Error: issue_key, filename, and content are required",
          },
        ],
        isError: true,
      };
    }
    const result = await executeJiraUploadAttachment(issueKey, filename, content);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: !result.success,
    };
  }

  if (toolName !== TOOL_NAME) {
    return {
      content: [{ type: "text", text: `Error: unknown tool "${toolName}"` }],
      isError: true,
    };
  }
  const method = typeof args.method === "string" ? args.method.toUpperCase() : "GET";
  const path = typeof args.path === "string" ? args.path : "";
  const body =
    typeof args.body === "object" && args.body !== null
      ? (args.body as Record<string, unknown>)
      : undefined;
  if (!path) {
    return {
      content: [{ type: "text", text: "Error: path is required" }],
      isError: true,
    };
  }
  const result = await executeJiraRest(method, path, body);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: !result.success,
  };
}

export async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const isNotification = req.id === undefined || req.id === null;

  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: req.id ?? 0,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "tasking-jira-rest", version: "1.0.0" },
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id: req.id ?? 0, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: req.id ?? 0, result: handleToolsList() };
    case "tools/call":
      return {
        jsonrpc: "2.0",
        id: req.id ?? 0,
        result: await handleToolsCall(req.params ?? {}),
      };
    default:
      if (isNotification) return null;
      return {
        jsonrpc: "2.0",
        id: req.id ?? 0,
        error: { code: -32601, message: `unknown method: ${req.method}` },
      };
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    try {
      const req = JSON.parse(line) as JsonRpcRequest;
      const res = await handleRequest(req);
      if (res !== null) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
      }
    } catch (e) {
      const hasId = line.includes('"id"');
      if (!hasId) continue;
      const errorRes: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: -32700,
          message: `parse error: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
      process.stdout.write(`${JSON.stringify(errorRes)}\n`);
    }
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  void main();
}

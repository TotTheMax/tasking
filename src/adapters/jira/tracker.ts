import type { TrackerConfig } from "../../config/config-types.js";
import { TaskingError, toTaskingError } from "../../shared/errors.js";
import type { BlockerRef, Task } from "../../shared/types.js";

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
}

export interface FetchOptions {
  pageSize?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface JiraComment {
  id: string;
  authorName: string | null;
  text: string;
  created: string;
}

export function flattenAdfText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || typeof body !== "object") return "";
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { text?: unknown; content?: unknown[] };
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(body);
  return parts.join("");
}

function adfParagraph(text: string): {
  type: string;
  content: Array<{ type: string; text: string }>;
} {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

export function wrapCommentBody(text: string, useAdf: boolean): unknown {
  if (!useAdf) return text;
  return { type: "doc", version: 1, content: [adfParagraph(text)] };
}

export function wrapDescription(text: string, useAdf: boolean): unknown {
  if (!useAdf) return text;
  const paragraphs = text.split(/\n+/).filter((p) => p.trim() !== "");
  const content =
    paragraphs.length > 0 ? paragraphs.map((p) => adfParagraph(p)) : [adfParagraph("")];
  return { type: "doc", version: 1, content };
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 30000;

const CANDIDATE_FIELDS = [
  "summary",
  "description",
  "priority",
  "status",
  "labels",
  "assignee",
  "issuelinks",
  "created",
  "updated",
];

export class JiraTracker {
  private readonly config: TrackerConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TrackerConfig, fetchImpl?: typeof fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  private authHeader(): string {
    const token = this.config.api_key ?? "";
    if (this.config.auth_mode === "bearer") {
      return `Bearer ${token}`;
    }
    const user = this.config.api_user ?? "";
    const credentials = Buffer.from(`${user}:${token}`).toString("base64");
    return `Basic ${credentials}`;
  }

  private buildJql(states: string[]): string {
    const project = this.config.project_key ?? this.config.project_slug ?? "";
    const stateList = states.map((s) => `"${s}"`).join(", ");
    let jql = `project = ${project} AND status in (${stateList})`;
    if (this.config.assignee) {
      if (this.config.assignee === "me") {
        jql += " AND assignee = currentUser()";
      } else {
        jql += ` AND assignee = "${this.config.assignee}"`;
      }
    }
    jql += " ORDER BY priority ASC, created ASC";
    return jql;
  }

  private buildAllProjectJql(): string {
    const project = this.config.project_key ?? this.config.project_slug ?? "";
    return `project = ${project} ORDER BY priority ASC, created ASC`;
  }

  private matchStateNames(states: string[], target: string): boolean {
    const lower = target.toLowerCase();
    return states.some((s) => s.toLowerCase() === lower);
  }

  async fetchCandidateIssues(opts: FetchOptions = {}): Promise<Task[]> {
    const states = this.config.active_states;
    if (states.length === 0) return [];
    const jql = this.buildJql(states);
    try {
      return await this.searchIssues(jql, opts);
    } catch (e) {
      if (e instanceof TaskingError && e.category === "jira_api_status") {
        const all = await this.searchIssues(this.buildAllProjectJql(), opts);
        return all.filter((t) => this.matchStateNames(states, t.state));
      }
      throw e;
    }
  }

  async fetchIssuesByStates(states: string[], opts: FetchOptions = {}): Promise<Task[]> {
    if (states.length === 0) return [];
    const jql = this.buildJql(states);
    try {
      return await this.searchIssues(jql, opts);
    } catch (e) {
      if (e instanceof TaskingError && e.category === "jira_api_status") {
        const all = await this.searchIssues(this.buildAllProjectJql(), opts);
        return all.filter((t) => this.matchStateNames(states, t.state));
      }
      throw e;
    }
  }

  async fetchIssueStatesByIds(ids: string[], opts: FetchOptions = {}): Promise<Task[]> {
    if (ids.length === 0) return [];
    const idList = ids
      .map((id) => {
        const trimmed = id.trim();
        return /^\d+$/.test(trimmed) ? trimmed : `"${trimmed}"`;
      })
      .join(", ");
    const project = this.config.project_key ?? this.config.project_slug ?? "";
    const jql = `project = ${project} AND id in (${idList})`;
    return this.searchIssues(jql, opts);
  }

  async fetchServerInfo(opts: FetchOptions = {}): Promise<Record<string, unknown>> {
    const timeoutMs = opts.timeoutMs ?? 5000;
    return (await this.request("/serverInfo", "GET", null, timeoutMs)) as Record<string, unknown>;
  }

  async fetchMyself(
    opts: FetchOptions = {},
  ): Promise<{ accountId: string | null; name: string | null }> {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const res = await this.request("/myself", "GET", null, timeoutMs);
    const data = res as { accountId?: string; name?: string };
    return { accountId: data.accountId ?? null, name: data.name ?? null };
  }

  async fetchProjectStatuses(opts: FetchOptions = {}): Promise<string[]> {
    const project = this.config.project_key ?? this.config.project_slug ?? "";
    if (!project) return [];
    const timeoutMs = opts.timeoutMs ?? 5000;
    const path = `/project/${project}/statuses`;
    const res = await this.request(path, "GET", null, timeoutMs);
    const data = res as Array<{ statuses?: Array<{ name?: string }> }>;
    if (!Array.isArray(data)) return [];
    const names = new Set<string>();
    for (const issueType of data) {
      const statuses = Array.isArray(issueType.statuses) ? issueType.statuses : [];
      for (const s of statuses) {
        if (typeof s.name === "string") names.add(s.name);
      }
    }
    return [...names];
  }

  isApiV3(): boolean {
    return /\/rest\/api\/3\b/.test(this.config.endpoint);
  }

  async fetchComments(
    issueKey: string,
    afterCommentId: string | null,
    opts: FetchOptions = {},
  ): Promise<JiraComment[]> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const path = `/issue/${encodeURIComponent(issueKey)}/comment`;
    const res = await this.request(path, "GET", null, timeoutMs);
    const data = res as {
      comments?: Array<{
        id: string;
        author?: { displayName?: string; emailAddress?: string; name?: string } | null;
        body?: unknown;
        created?: string;
      }>;
    };
    const comments = Array.isArray(data.comments) ? data.comments : [];
    const normalized: JiraComment[] = comments.map((c) => ({
      id: c.id,
      authorName: c.author?.displayName ?? c.author?.emailAddress ?? c.author?.name ?? null,
      text: flattenAdfText(c.body),
      created: c.created ?? "",
    }));
    if (afterCommentId === null) return normalized;
    const after = Number(afterCommentId);
    if (!Number.isFinite(after)) return normalized;
    return normalized.filter((c) => {
      const n = Number(c.id);
      return Number.isFinite(n) && n > after;
    });
  }

  async postComment(issueKey: string, text: string, opts: FetchOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const body = { body: wrapCommentBody(text, this.isApiV3()) };
    await this.request(`/issue/${encodeURIComponent(issueKey)}/comment`, "POST", body, timeoutMs);
  }

  async createIssue(
    fields: Record<string, unknown>,
    opts: FetchOptions = {},
  ): Promise<{ key: string; id: string }> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this.request("/issue", "POST", { fields }, timeoutMs);
    const data = res as { key?: string; id?: string };
    if (!data.key) {
      throw new TaskingError("jira_api_status", "createIssue response missing key");
    }
    return { key: data.key, id: data.id ?? "" };
  }

  async updateIssue(
    issueKey: string,
    fields: Record<string, unknown>,
    opts: FetchOptions = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    await this.request(`/issue/${encodeURIComponent(issueKey)}`, "PUT", { fields }, timeoutMs);
  }

  async fetchTransitions(
    issueKey: string,
    opts: FetchOptions = {},
  ): Promise<Array<{ id: string; name: string; toName: string }>> {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const res = await this.request(
      `/issue/${encodeURIComponent(issueKey)}/transitions`,
      "GET",
      null,
      timeoutMs,
    );
    const data = res as {
      transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
    };
    const list = Array.isArray(data.transitions) ? data.transitions : [];
    return list.map((t) => ({ id: t.id, name: t.name, toName: t.to?.name ?? t.name }));
  }

  async transitionIssue(
    issueKey: string,
    transitionId: string,
    opts: FetchOptions = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    await this.request(
      `/issue/${encodeURIComponent(issueKey)}/transitions`,
      "POST",
      { transition: { id: transitionId } },
      timeoutMs,
    );
  }

  async fetchIssueTypes(opts: FetchOptions = {}): Promise<string[]> {
    const project = this.config.project_key ?? this.config.project_slug ?? "";
    if (!project) return [];
    const timeoutMs = opts.timeoutMs ?? 5000;
    const res = await this.request(`/project/${project}`, "GET", null, timeoutMs);
    const data = res as { issueTypes?: Array<{ name?: string }> };
    if (!Array.isArray(data.issueTypes)) return [];
    const names: string[] = [];
    for (const t of data.issueTypes) {
      if (typeof t.name === "string") names.push(t.name);
    }
    return names;
  }

  private async searchIssues(jql: string, opts: FetchOptions): Promise<Task[]> {
    const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const results: Task[] = [];
    let startAt = 0;
    let total = Number.POSITIVE_INFINITY;

    while (startAt < total) {
      const body = { jql, startAt, maxResults: pageSize, fields: CANDIDATE_FIELDS };
      const res = await this.request("/search", "POST", body, timeoutMs);
      const data = res as { total?: number; issues?: JiraIssue[] };
      total = typeof data.total === "number" ? data.total : startAt;
      const issues = Array.isArray(data.issues) ? data.issues : [];
      for (const issue of issues) {
        results.push(
          normalizeIssue(
            issue,
            this.config.active_states,
            this.config.terminal_states,
            this.config.endpoint,
          ),
        );
      }
      if (issues.length < pageSize) break;
      startAt += pageSize;
    }

    return results;
  }

  private async request(
    path: string,
    method: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const base = this.config.endpoint.replace(/\/+$/, "");
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new TaskingError("jira_api_status", `jira api returned ${res.status}`, {
          status: res.status,
          body: text.slice(0, 500),
        });
      }
      const text = await res.text();
      if (text === "" || res.status === 204) return null;
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new TaskingError(
          "jira_api_request",
          `jira response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } catch (e) {
      if (e instanceof TaskingError) throw e;
      throw new TaskingError(
        "jira_api_request",
        `jira api request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function jiraBrowseUrl(
  endpoint: string | null | undefined,
  issueKey: string,
): string | null {
  const baseUrl = endpoint ? endpoint.replace(/\/rest\/api\/\d+\/?$/, "").replace(/\/+$/, "") : "";
  return baseUrl === "" ? null : `${baseUrl}/browse/${issueKey}`;
}

export function normalizeIssue(
  issue: JiraIssue,
  _activeStates: string[],
  _terminalStates: string[],
  endpoint?: string,
): Task {
  const fields = issue.fields ?? {};
  const url = jiraBrowseUrl(endpoint, issue.key);
  return {
    id: String(issue.id),
    identifier: issue.key,
    title: typeof fields.summary === "string" ? fields.summary : issue.key,
    description: typeof fields.description === "string" ? fields.description : null,
    priority: normalizePriority(fields.priority),
    state: normalizeState(fields.status),
    branch_name: null,
    url,
    labels: normalizeLabels(fields.labels),
    assignee: normalizeAssignee(fields.assignee),
    blocked_by: normalizeBlockers(fields.issuelinks),
    created_at: normalizeTimestamp(fields.created),
    updated_at: normalizeTimestamp(fields.updated),
    source: "jira",
  };
}

function normalizePriority(raw: unknown): number | null {
  if (typeof raw === "object" && raw !== null && "id" in raw) {
    const id = (raw as Record<string, unknown>).id;
    if (typeof id === "string") return Number.parseInt(id, 10) || null;
    if (typeof id === "number") return id;
  }
  if (typeof raw === "number") return raw;
  return null;
}

function normalizeState(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "name" in raw) {
    const name = (raw as Record<string, unknown>).name;
    return typeof name === "string" ? name : "";
  }
  return typeof raw === "string" ? raw : "";
}

function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => (typeof l === "string" ? l.trim().toLowerCase() : ""))
    .filter((l) => l !== "");
}

function normalizeAssignee(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.accountId === "string" && a.accountId !== "") return a.accountId;
  if (typeof a.name === "string" && a.name !== "") return a.name;
  if (typeof a.key === "string" && a.key !== "") return a.key;
  if (typeof a.emailAddress === "string" && a.emailAddress !== "") return a.emailAddress;
  return null;
}

function normalizeBlockers(raw: unknown): BlockerRef[] {
  if (!Array.isArray(raw)) return [];
  const blockers: BlockerRef[] = [];
  for (const link of raw) {
    if (typeof link !== "object" || link === null) continue;
    const type = (link as Record<string, unknown>).type;
    const typeName =
      typeof type === "object" && type !== null ? (type as Record<string, unknown>).name : null;
    const typeNameLower = typeof typeName === "string" ? typeName.toLowerCase() : "";
    if (typeNameLower !== "blocks" && typeNameLower !== "blocked") continue;
    const inward = (link as Record<string, unknown>).inwardIssue;
    if (typeof inward === "object" && inward !== null) {
      const i = inward as Record<string, unknown>;
      const fields =
        typeof i.fields === "object" && i.fields !== null
          ? (i.fields as Record<string, unknown>)
          : {};
      blockers.push({
        id: typeof i.id === "string" ? i.id : null,
        identifier: typeof i.key === "string" ? i.key : null,
        state: normalizeState(fields.status),
      });
    }
  }
  return blockers;
}

function normalizeTimestamp(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

export function isActiveState(state: string, activeStates: string[]): boolean {
  const lower = state.toLowerCase();
  return activeStates.some((s) => s.toLowerCase() === lower);
}

export function isTerminalState(state: string, terminalStates: string[]): boolean {
  const lower = state.toLowerCase();
  return terminalStates.some((s) => s.toLowerCase() === lower);
}

export { toTaskingError };

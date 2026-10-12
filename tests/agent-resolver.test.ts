import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolver.js";
import { resolveAgent } from "../src/shared/agent-resolver.js";
import type { Task } from "../src/shared/types.js";

function makeTask(labels: string[]): Task {
  return {
    id: "1",
    identifier: "TAS-1",
    title: "t",
    description: null,
    priority: null,
    state: "To Do",
    branch_name: null,
    url: null,
    labels,
    blocked_by: [],
    assignee: null,
    created_at: null,
    updated_at: null,
    source: "jira",
  };
}

function cfg(agent: string, agents: string[] = []) {
  return resolveConfig({ opencode: { agent, agents } }, "/tmp", "p");
}

describe("resolveAgent", () => {
  it("uses the catalogue's original casing for a case-insensitive match", () => {
    const r = resolveAgent(makeTask(["agent:review"]), cfg("build", ["Build", "Review"]));
    expect(r).toEqual({ agent: "Review", warned: false });
  });

  it("warns and falls back to the default when the name is not in a non-empty catalogue", () => {
    const r = resolveAgent(makeTask(["agent:foo"]), cfg("build", ["build"]));
    expect(r).toEqual({ agent: "build", warned: true });
  });

  it("passes the lowercased label value through when the catalogue is empty", () => {
    const r = resolveAgent(makeTask(["agent:review"]), cfg("build", []));
    expect(r).toEqual({ agent: "review", warned: false });
  });

  it("falls back to the default when there is no agent label", () => {
    const r = resolveAgent(makeTask(["bug", "ops"]), cfg("build", ["build", "review"]));
    expect(r).toEqual({ agent: "build", warned: false });
  });

  it("deterministically picks the first agent label when several exist", () => {
    const r = resolveAgent(
      makeTask(["agent:build", "agent:review"]),
      cfg("build", ["Build", "Review"]),
    );
    expect(r).toEqual({ agent: "Build", warned: false });
  });

  it("matches a lowercase catalogue entry", () => {
    const r = resolveAgent(makeTask(["agent:build"]), cfg("build", ["build"]));
    expect(r).toEqual({ agent: "build", warned: false });
  });
});

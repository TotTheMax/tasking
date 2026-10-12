import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = join(process.cwd(), "assets", "skills");

function readSkill(name: string): string {
  const path = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(path)) {
    throw new Error(`skill file not found: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function parseFrontMatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) {
    throw new Error("no YAML front matter found");
  }
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*\n?((?:\s+.+\n?)+)/m);
  const descRaw = descMatch?.[1] ?? "";
  const description = descRaw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  return {
    name: nameMatch?.[1]?.trim() ?? "",
    description,
  };
}

describe("land skill", () => {
  const content = readSkill("land");

  it("has valid YAML front matter with name and description", () => {
    const fm = parseFrontMatter(content);
    expect(fm.name).toBe("land");
    expect(fm.description.length).toBeGreaterThan(10);
  });

  it("description instructs to read only when needed", () => {
    const fm = parseFrontMatter(content);
    expect(fm.description.toLowerCase()).toContain("only read");
  });

  it("contains glab pre-authentication note", () => {
    expect(content).toContain("GITLAB_TOKEN");
    expect(content).toContain("预认证");
  });

  it("does not contain Codex Review logic", () => {
    expect(content).not.toContain("## Codex Review");
    expect(content).not.toContain("[codex]");
    expect(content).not.toContain("CODEX_BOTS");
  });

  it("uses glab mr merge not gh pr merge", () => {
    expect(content).toContain("glab mr merge");
    expect(content).not.toContain("gh pr merge");
  });

  it("uses squash merge", () => {
    expect(content).toContain("--squash");
  });

  it("references land_watch.py", () => {
    expect(content).toContain("land_watch.py");
  });

  it("documents exit code protocol", () => {
    expect(content).toContain("Exit 0");
    expect(content).toContain("Exit 2");
    expect(content).toContain("Exit 3");
    expect(content).toContain("Exit 4");
    expect(content).toContain("Exit 5");
  });

  it("contains glab api commands for review discussions", () => {
    expect(content).toContain("glab api");
    expect(content).toContain("discussions");
  });

  it("does not reference deleted skills", () => {
    expect(content).not.toContain("`commit` skill");
    expect(content).not.toContain("`push` skill");
    expect(content).not.toContain("`pull` skill");
  });
});

describe("install-glab skill", () => {
  const content = readSkill("install-glab");

  it("has valid YAML front matter with name and description", () => {
    const fm = parseFrontMatter(content);
    expect(fm.name).toBe("install-glab");
    expect(fm.description.length).toBeGreaterThan(10);
  });

  it("is idempotent: checks command -v glab first", () => {
    expect(content).toContain("command -v glab");
  });

  it("installs via GitLab releases API to ~/.local/bin", () => {
    expect(content).toContain("gitlab-org");
    expect(content).toContain("releases");
    expect(content).toContain("~/.local/bin");
  });

  it("falls back to package-manager commands", () => {
    expect(content).toContain("brew install glab");
    expect(content).toContain("snap install glab");
  });

  it("verifies auth without interactive login", () => {
    expect(content).toContain("glab auth status");
    expect(content).toContain("GITLAB_TOKEN");
    expect(content).not.toContain("gh auth");
  });

  it("does not reference deleted skills", () => {
    expect(content).not.toContain("`commit` skill");
    expect(content).not.toContain("`push` skill");
  });
});

describe("land_watch.py", () => {
  const path = join(SKILLS_DIR, "land", "land_watch.py");
  const content = readFileSync(path, "utf8");

  it("uses glab api not gh api", () => {
    expect(content).toContain("glab");
    expect(content).not.toContain('"gh"');
  });

  it("does not contain CODEX_BOTS", () => {
    expect(content).not.toContain("CODEX_BOTS");
  });

  it("does not contain Codex Review filtering", () => {
    expect(content).not.toContain("## Codex Review");
    expect(content).not.toContain("is_codex_review");
    expect(content).not.toContain("filter_codex_review");
  });

  it("uses GitLab API endpoints", () => {
    expect(content).toContain("merge_requests");
    expect(content).toContain("discussions");
    expect(content).toContain("pipelines");
  });

  it("has exit code protocol", () => {
    expect(content).toContain("SystemExit(2)");
    expect(content).toContain("SystemExit(3)");
    expect(content).toContain("SystemExit(4)");
    expect(content).toContain("SystemExit(5)");
    expect(content).toContain("Exit codes");
  });

  it("has asyncio concurrent monitoring", () => {
    expect(content).toContain("asyncio");
    expect(content).toContain("create_task");
    expect(content).toContain("FIRST_COMPLETED");
  });
});

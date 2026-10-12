import { describe, expect, it } from "vitest";
import {
  HELP_TEXT,
  buildBridgedCommentBody,
  hasSentinel,
  isCommand,
  isHelp,
  parseAgent,
  parseChat,
  parseIssue,
  parseState,
  renderForwardedComment,
} from "../src/bridge/commands.js";

describe("command parsing", () => {
  it("isCommand detects slash prefix", () => {
    expect(isCommand("/issue x")).toBe(true);
    expect(isCommand("hello")).toBe(false);
    expect(isCommand("  /state")).toBe(true);
  });

  it("isHelp", () => {
    expect(isHelp("/help")).toBe(true);
    expect(isHelp("/?")).toBe(true);
    expect(isHelp("/issue")).toBe(false);
  });

  it("HELP_TEXT lists all three commands", () => {
    expect(HELP_TEXT).toContain("/issue");
    expect(HELP_TEXT).toContain("/state");
    expect(HELP_TEXT).toContain("/help");
  });

  it("HELP_TEXT documents /agent usage", () => {
    expect(HELP_TEXT).toContain("/agent");
    expect(HELP_TEXT).toContain("--agent");
  });
});

describe("parseIssue", () => {
  it("rejects glued variants like /issues", () => {
    expect(parseIssue("/issues")).toBeNull();
    expect(parseIssue("/issuefoo 标题")).toBeNull();
    expect(parseIssue("  /issues ")).toBeNull();
  });

  it("still accepts /issue with newline-separated title", () => {
    const r = parseIssue("/issue\n标题");
    expect(r?.kind).toBe("create");
    expect(r?.title).toBe("标题");
  });

  it("discovers when no args", () => {
    expect(parseIssue("/issue")).toEqual({
      kind: "discover",
      title: null,
      description: "",
      typeOverride: null,
      agentOverride: null,
    });
  });

  it("parses title + description positionally", () => {
    const r = parseIssue("/issue 给登录加暗色模式\n用户希望暗色主题切换");
    expect(r).toEqual({
      kind: "create",
      title: "给登录加暗色模式",
      description: "用户希望暗色主题切换",
      typeOverride: null,
      agentOverride: null,
    });
  });

  it("parses multi-line description", () => {
    const r = parseIssue("/issue T\nline1\nline2");
    expect(r?.description).toBe("line1\nline2");
  });

  it("parses --type override before title", () => {
    const r = parseIssue("/issue --type Bug my title\nthe desc");
    expect(r?.kind).toBe("create");
    expect(r?.typeOverride).toBe("Bug");
    expect(r?.title).toBe("my title");
    expect(r?.description).toBe("the desc");
  });

  it("parses --agent override before title", () => {
    const r = parseIssue("/issue --agent review my title\nthe desc");
    expect(r?.kind).toBe("create");
    expect(r?.agentOverride).toBe("review");
    expect(r?.title).toBe("my title");
    expect(r?.description).toBe("the desc");
  });

  it("parses --type and --agent together in any order", () => {
    const r = parseIssue("/issue --type Bug --agent review my title\nthe desc");
    expect(r?.typeOverride).toBe("Bug");
    expect(r?.agentOverride).toBe("review");
    expect(r?.title).toBe("my title");
    const r2 = parseIssue("/issue --agent review --type Bug my title\nthe desc");
    expect(r2?.typeOverride).toBe("Bug");
    expect(r2?.agentOverride).toBe("review");
  });

  it("creates with empty description when title but no description", () => {
    const r = parseIssue("/issue only a title");
    expect(r?.kind).toBe("create");
    expect(r?.title).toBe("only a title");
    expect(r?.description).toBe("");
  });

  it("returns null for non-issue text", () => {
    expect(parseIssue("hello world")).toBeNull();
    expect(parseIssue("/state 1")).toBeNull();
  });
});

describe("parseAgent", () => {
  it("list when no arg", () => {
    expect(parseAgent("/agent")).toEqual({ kind: "list", name: null });
    expect(parseAgent("/agent   ")).toEqual({ kind: "list", name: null });
  });

  it("switch with a name", () => {
    expect(parseAgent("/agent review")).toEqual({ kind: "switch", name: "review" });
    expect(parseAgent("/agent Build")).toEqual({ kind: "switch", name: "Build" });
  });

  it("reset on default or dash", () => {
    expect(parseAgent("/agent default")).toEqual({ kind: "reset", name: null });
    expect(parseAgent("/agent -")).toEqual({ kind: "reset", name: null });
  });

  it("returns null for non-agent text", () => {
    expect(parseAgent("/issue x")).toBeNull();
    expect(parseAgent("hello")).toBeNull();
    expect(parseAgent("/state 1")).toBeNull();
  });
});

describe("parseState", () => {
  it("list when no arg", () => {
    expect(parseState("/state")).toEqual({ kind: "list", target: null });
    expect(parseState("/state   ")).toEqual({ kind: "list", target: null });
  });

  it("transition with name or number", () => {
    expect(parseState("/state Done")).toEqual({ kind: "transition", target: "Done" });
    expect(parseState("/state 2")).toEqual({ kind: "transition", target: "2" });
  });

  it("returns null for non-state", () => {
    expect(parseState("/issue x")).toBeNull();
    expect(parseState("hi")).toBeNull();
  });
});

describe("sentinel helpers", () => {
  it("buildBridgedCommentBody carries attribution + sentinel via Feishu", () => {
    const body = buildBridgedCommentBody("张三", "hi");
    expect(body).toContain("💬 张三 via Feishu:");
    expect(body).toContain("\nhi");
    expect(hasSentinel(body)).toBe(true);
  });

  it("hasSentinel still recognizes legacy 'via 飞书' comments", () => {
    expect(hasSentinel("💬 张三 via 飞书:\nhi")).toBe(true);
    expect(hasSentinel("💬 Bob via Feishu:\nhello")).toBe(true);
  });

  it("hasSentinel false for plain comment", () => {
    expect(hasSentinel("just a plain comment")).toBe(false);
  });

  it("hasSentinel false for prose that merely mentions 'via 飞书'", () => {
    const prose = "完成：TAS-4 优化集合\n2. sentinel comment 写入（`via 飞书` 防回投）";
    expect(hasSentinel(prose)).toBe(false);
    expect(hasSentinel("随手提到 via 飞书 几个字")).toBe(false);
    expect(hasSentinel("随手提到 via Feishu 几个字")).toBe(false);
  });

  it("renderForwardedComment prefixes agent vs human", () => {
    expect(renderForwardedComment(null, "txt", true)).toBe("🤖 agent:\ntxt");
    expect(renderForwardedComment("Bob", "txt", false)).toBe("💬 Bob (Jira):\ntxt");
  });
});

describe("parseChat", () => {
  it("returns null for non-/chat text", () => {
    expect(parseChat("/issue fix bug")).toBeNull();
    expect(parseChat("chat with me")).toBeNull();
  });

  it("parses bare /chat as list", () => {
    const list = { kind: "list", target: null, isPath: false, message: "" };
    expect(parseChat("/chat")).toEqual(list);
    expect(parseChat("/chat  ")).toEqual(list);
  });

  it("parses /chat list as list", () => {
    expect(parseChat("/chat list")).toEqual({
      kind: "list",
      target: null,
      isPath: false,
      message: "",
    });
  });

  it("parses /chat help as help", () => {
    expect(parseChat("/chat help")).toEqual({
      kind: "help",
      target: null,
      isPath: false,
      message: "",
    });
  });

  it("parses project form with message", () => {
    expect(parseChat("/chat tasking 帮我跑一下测试")).toEqual({
      kind: "start",
      target: "tasking",
      isPath: false,
      message: "帮我跑一下测试",
    });
  });

  it("parses project form without message", () => {
    expect(parseChat("/chat tasking")).toEqual({
      kind: "start",
      target: "tasking",
      isPath: false,
      message: "",
    });
  });

  it("parses absolute path form with message", () => {
    expect(parseChat("/chat /home/me/notes 整理目录")).toEqual({
      kind: "start",
      target: "/home/me/notes",
      isPath: true,
      message: "整理目录",
    });
  });

  it("keeps multi-line message content", () => {
    expect(parseChat("/chat app line1\nline2")).toEqual({
      kind: "start",
      target: "app",
      isPath: false,
      message: "line1\nline2",
    });
  });
});

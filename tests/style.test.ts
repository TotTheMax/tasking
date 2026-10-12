import { describe, expect, it } from "vitest";
import {
  BOLD,
  CYAN,
  DIM,
  GRAY,
  GREEN,
  RED,
  RESET,
  YELLOW,
  createStyle,
  stripAnsi,
} from "../src/cli/style.js";

describe("style constants", () => {
  it("RESET is the reset escape sequence", () => {
    expect(RESET).toBe("\x1b[0m");
  });

  it("BOLD is the bold escape sequence", () => {
    expect(BOLD).toBe("\x1b[1m");
  });

  it("DIM is the dim escape sequence", () => {
    expect(DIM).toBe("\x1b[2m");
  });

  it("CYAN is the cyan escape sequence", () => {
    expect(CYAN).toBe("\x1b[36m");
  });

  it("GREEN is the green escape sequence", () => {
    expect(GREEN).toBe("\x1b[32m");
  });

  it("YELLOW is the yellow escape sequence", () => {
    expect(YELLOW).toBe("\x1b[33m");
  });

  it("RED is the red escape sequence", () => {
    expect(RED).toBe("\x1b[31m");
  });

  it("GRAY is the gray escape sequence", () => {
    expect(GRAY).toBe("\x1b[90m");
  });
});

describe("stripAnsi", () => {
  it("removes ANSI escape codes from a string", () => {
    const styled = `${GREEN}${BOLD}hello${RESET}`;
    expect(stripAnsi(styled)).toBe("hello");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("removes multiple escape sequences", () => {
    const styled = `${CYAN}╭─ ${RESET}${BOLD}Title${RESET}`;
    expect(stripAnsi(styled)).toBe("╭─ Title");
  });
});

describe("createStyle", () => {
  it("wraps text with ANSI codes when useColor is true", () => {
    const style = createStyle(true);
    expect(style.bold("hello")).toBe(`${BOLD}hello${RESET}`);
  });

  it("returns plain text when useColor is false", () => {
    const style = createStyle(false);
    expect(style.bold("hello")).toBe("hello");
  });

  it("green wraps with green color when useColor is true", () => {
    const style = createStyle(true);
    expect(style.green("ok")).toBe(`${GREEN}ok${RESET}`);
  });

  it("green returns plain text when useColor is false", () => {
    const style = createStyle(false);
    expect(style.green("ok")).toBe("ok");
  });

  it("dim wraps with dim when useColor is true", () => {
    const style = createStyle(true);
    expect(style.dim("hint")).toBe(`${DIM}hint${RESET}`);
  });

  it("cyan wraps with cyan when useColor is true", () => {
    const style = createStyle(true);
    expect(style.cyan("header")).toBe(`${CYAN}header${RESET}`);
  });

  it("red wraps with red when useColor is true", () => {
    const style = createStyle(true);
    expect(style.red("error")).toBe(`${RED}error${RESET}`);
  });

  it("yellow wraps with yellow when useColor is true", () => {
    const style = createStyle(true);
    expect(style.yellow("warn")).toBe(`${YELLOW}warn${RESET}`);
  });

  it("gray wraps with gray when useColor is true", () => {
    const style = createStyle(true);
    expect(style.gray("muted")).toBe(`${GRAY}muted${RESET}`);
  });
});

describe("style box helpers", () => {
  it("boxHeader produces ╭─ title with color when useColor is true", () => {
    const style = createStyle(true);
    const result = style.boxHeader("Prerequisites");
    expect(stripAnsi(result)).toBe("╭─ Prerequisites\n");
    expect(result).toContain(CYAN);
    expect(result).toContain(BOLD);
  });

  it("boxHeader produces plain ╭─ title when useColor is false", () => {
    const style = createStyle(false);
    expect(style.boxHeader("Jira Setup")).toBe("╭─ Jira Setup\n");
  });

  it("boxLine produces │  text with gray border when useColor is true", () => {
    const style = createStyle(true);
    const result = style.boxLine("hello");
    expect(stripAnsi(result)).toBe("│  hello\n");
    expect(result).toContain(GRAY);
  });

  it("boxLine produces plain │  text when useColor is false", () => {
    const style = createStyle(false);
    expect(style.boxLine("hello")).toBe("│  hello\n");
  });

  it("boxFooter produces ╰── with color when useColor is true", () => {
    const style = createStyle(true);
    const result = style.boxFooter();
    expect(stripAnsi(result)).toBe("╰──\n");
    expect(result).toContain(CYAN);
  });

  it("boxFooter produces plain ╰── when useColor is false", () => {
    const style = createStyle(false);
    expect(style.boxFooter()).toBe("╰──\n");
  });

  it("boxPrefix produces │  with gray border when useColor is true", () => {
    const style = createStyle(true);
    const result = style.boxPrefix();
    expect(stripAnsi(result)).toBe("│  ");
    expect(result).toContain(GRAY);
  });

  it("boxPrefix produces plain │  when useColor is false", () => {
    const style = createStyle(false);
    expect(style.boxPrefix()).toBe("│  ");
  });
});

describe("style statusIcon", () => {
  it("statusIcon ok returns ✓ with green when useColor is true", () => {
    const style = createStyle(true);
    const result = style.statusIcon("ok");
    expect(stripAnsi(result)).toBe("✓");
    expect(result).toContain(GREEN);
  });

  it("statusIcon fail returns ✗ with red when useColor is true", () => {
    const style = createStyle(true);
    const result = style.statusIcon("fail");
    expect(stripAnsi(result)).toBe("✗");
    expect(result).toContain(RED);
  });

  it("statusIcon warn returns ⚠ with yellow when useColor is true", () => {
    const style = createStyle(true);
    const result = style.statusIcon("warn");
    expect(stripAnsi(result)).toBe("⚠");
    expect(result).toContain(YELLOW);
  });

  it("statusIcon info returns · with gray when useColor is true", () => {
    const style = createStyle(true);
    const result = style.statusIcon("info");
    expect(stripAnsi(result)).toBe("·");
    expect(result).toContain(GRAY);
  });

  it("statusIcon returns plain icon when useColor is false", () => {
    const style = createStyle(false);
    expect(style.statusIcon("ok")).toBe("✓");
    expect(style.statusIcon("fail")).toBe("✗");
    expect(style.statusIcon("warn")).toBe("⚠");
    expect(style.statusIcon("info")).toBe("·");
  });
});

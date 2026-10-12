import { describe, expect, it } from "vitest";
import { displayWidth, truncateToWidth, wrapToWidth } from "../src/observability/wrap.js";

describe("displayWidth", () => {
  it("counts ASCII as 1 per char", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("hello world")).toBe(11);
  });

  it("counts CJK as 2 per char", () => {
    expect(displayWidth("你好")).toBe(4);
    expect(displayWidth("中文123")).toBe(7);
    expect(displayWidth("a你b")).toBe(4);
  });

  it("counts fullwidth forms and emoji as 2", () => {
    expect(displayWidth("Ａ")).toBe(2);
    expect(displayWidth("🔧")).toBe(2);
  });

  it("counts control chars as 0", () => {
    expect(displayWidth("a\u0000b")).toBe(2);
    expect(displayWidth("\u001b")).toBe(0);
  });
});

describe("truncateToWidth", () => {
  it("returns unchanged when it fits", () => {
    expect(truncateToWidth("abc", 5)).toBe("abc");
  });

  it("truncates ASCII with ellipsis", () => {
    expect(truncateToWidth("abcdefgh", 5)).toBe("abcd…");
  });

  it("truncates CJK by display width", () => {
    expect(truncateToWidth("你好世界", 5)).toBe("你好…");
  });

  it("handles width smaller than ellipsis", () => {
    expect(truncateToWidth("abcdef", 1)).toBe("…");
  });

  it("returns empty for empty or zero width", () => {
    expect(truncateToWidth("", 5)).toBe("");
    expect(truncateToWidth("abc", 0)).toBe("");
  });
});

describe("wrapToWidth", () => {
  it("wraps long single line into width-bounded lines", () => {
    expect(wrapToWidth("hello world", 5)).toEqual(["hello", "world"]);
  });

  it("wraps CJK by display width", () => {
    expect(wrapToWidth("你好世界你好", 6)).toEqual(["你好世", "界你好"]);
  });

  it("splits on newlines first", () => {
    expect(wrapToWidth("a\nbc\ndefgh", 3)).toEqual(["a", "bc", "def", "gh"]);
  });

  it("returns empty for empty string or zero width", () => {
    expect(wrapToWidth("", 5)).toEqual([]);
    expect(wrapToWidth("abc", 0)).toEqual([]);
  });

  it("exact fit stays one line", () => {
    expect(wrapToWidth("你好", 4)).toEqual(["你好"]);
  });
});

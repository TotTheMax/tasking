import { afterEach, describe, expect, it } from "vitest";
import { translateCard } from "../src/translate/card.js";
import { setLocale } from "../src/translate/locale.js";

afterEach(() => {
  setLocale("zh");
});

const CARD = {
  schema: "2.0",
  header: { title: { tag: "plain_text", content: "空闲" } },
  body: {
    elements: [
      {
        tag: "column_set",
        columns: [
          {
            elements: [
              {
                tag: "button",
                text: { tag: "plain_text", content: "✖ 取消" },
                action_type: "default",
                value: { action: "cancel", turn: 3 },
                url: "https://example.com/取消",
              },
            ],
          },
        ],
      },
    ],
  },
};

describe("translateCard", () => {
  it("returns the card unchanged when locale is zh", () => {
    expect(translateCard(CARD)).toEqual(CARD);
  });

  it("translates label leaves but keeps protocol fields when locale is en", () => {
    setLocale("en");
    const out = translateCard(CARD) as typeof CARD;
    expect(out.header.title.content).toBe("Idle");
    const button = out.body.elements[0]?.columns[0]?.elements[0] as Record<string, unknown>;
    expect((button.text as { content: string }).content).toBe("✖ Cancel");
    expect(button.value).toEqual({ action: "cancel", turn: 3 });
    expect(button.url).toBe("https://example.com/取消");
    expect(button.tag).toBe("button");
  });

  it("passes through strings with no dictionary entry", () => {
    setLocale("en");
    const out = translateCard({ content: "agent 自由输出内容" }) as { content: string };
    expect(out.content).toBe("agent 自由输出内容");
  });
});

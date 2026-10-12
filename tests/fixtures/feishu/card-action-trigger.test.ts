import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = join(import.meta.dirname, "card-action-trigger.json");

function loadFixture(): {
  provenance: string;
  withOperatorName: Record<string, unknown>;
  withoutOperatorName: Record<string, unknown>;
} {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

describe("card-action-trigger fixture", () => {
  it("exists with provenance captured or documented", () => {
    const f = loadFixture();
    expect(["captured", "documented"]).toContain(f.provenance);
  });

  const shape = (name: "withOperatorName" | "withoutOperatorName") => {
    it(`${name}: carries the canonical trigger envelope`, () => {
      const env = loadFixture()[name] as {
        header?: { event_type?: string };
        event?: {
          operator?: { open_id?: string; name?: string };
          action?: { tag?: string; value?: Record<string, unknown> };
          context?: { open_message_id?: string; open_chat_id?: string };
        };
      };
      expect(env.header?.event_type).toBe("card.action.trigger");
      expect(env.event?.operator?.open_id).toBeTruthy();
      expect(env.event?.action?.tag).toBe("button");
      expect(typeof env.event?.action?.value).toBe("object");
      expect(env.event?.context?.open_message_id).toBeTruthy();
      expect(env.event?.context?.open_chat_id).toBeTruthy();
    });
  };
  shape("withOperatorName");
  shape("withoutOperatorName");

  it("withoutOperatorName truly lacks a display name", () => {
    const env = loadFixture().withoutOperatorName as {
      event?: { operator?: { name?: string } };
    };
    const name = env.event?.operator?.name ?? "";
    expect(name).toBe("");
  });
});

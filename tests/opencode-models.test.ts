import { describe, expect, it } from "vitest";
import { type ModelProbeRunner, probeOpencodeModels } from "../src/driver/opencode-models.js";
import { modelDefaultResponse, modelListResponse } from "./helpers/opencode-fixtures.js";

function scriptedRunner(routes: Record<string, string>): ModelProbeRunner {
  return async (args) => {
    const op = args.find((a) => a.includes(".")) ?? "";
    const stdout = routes[op];
    if (stdout === undefined) throw new Error(`unexpected op ${op}`);
    return { stdout, stderr: "" };
  };
}

describe("probeOpencodeModels", () => {
  it("parses the default model and the catalog from fixture payloads", async () => {
    const probe = await probeOpencodeModels(
      "opencode",
      "/w",
      scriptedRunner({
        "model.default": modelDefaultResponse(),
        "model.list": modelListResponse(),
      }),
    );
    expect(probe.status).toBe("ok");
    const entry = probe.available?.[0];
    expect(entry?.providerID).toBe("opencode");
    expect(typeof entry?.releasedMs).toBe("number");
    const free = probe.available?.find((m) => m.free);
    expect(free).toBeDefined();
  });

  it("degrades to unreachable when the CLI fails", async () => {
    const probe = await probeOpencodeModels("opencode", "/w", async () => {
      throw new Error("spawn timeout");
    });
    expect(probe.status).toBe("unreachable");
    expect(probe.error).toContain("spawn timeout");
  });

  it("falls back to the process cwd when the requested directory does not exist", async () => {
    const seen: string[] = [];
    const probe = await probeOpencodeModels("opencode", "/definitely/not/a/dir", async (_args, cwd) => {
      seen.push(cwd);
      return { stdout: modelDefaultResponse(), stderr: "" };
    });
    expect(probe.status).toBe("ok");
    expect(seen).toContain(process.cwd());
  });

  it("still reports ok with a default when the list call fails", async () => {
    const probe = await probeOpencodeModels(
      "opencode",
      "/w",
      scriptedRunner({ "model.default": modelDefaultResponse() }),
    );
    expect(probe.status).toBe("ok");
    expect(probe.available).toBeUndefined();
  });
});

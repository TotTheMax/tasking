import { describe, expect, it } from "vitest";
import {
  SUPPORTED_RANGE,
  VALIDATED_MINOR,
  classifyOpencodeVersion,
} from "../src/shared/opencode-version.js";

describe("classifyOpencodeVersion", () => {
  it("parses bare version strings", () => {
    expect(classifyOpencodeVersion("1.19.0").normalized).toBe("1.19.0");
    expect(classifyOpencodeVersion("2.0.29").normalized).toBe("2.0.29");
  });

  it("parses 'opencode v2.0.29' prefixed format", () => {
    const r = classifyOpencodeVersion("opencode v2.0.29");
    expect(r.normalized).toBe("2.0.29");
    expect(r.status).toBe("validated");
  });

  it("parses 'v2.0.29' format", () => {
    expect(classifyOpencodeVersion("v2.0.29").normalized).toBe("2.0.29");
  });

  it("rejects v1 as unsupported with guidance", () => {
    const r = classifyOpencodeVersion("1.19.0");
    expect(r.status).toBe("unsupported");
    expect(r.message).toContain("opencode upgrade --major");
  });

  it("rejects v3+ as unsupported", () => {
    expect(classifyOpencodeVersion("3.1.0").status).toBe("unsupported");
  });

  it("accepts validated 2.0.x without warning", () => {
    const r = classifyOpencodeVersion("opencode v2.0.29");
    expect(r.status).toBe("validated");
    expect(r.message).toBeUndefined();
  });

  it("warns but allows unvalidated 2.x minors", () => {
    const r = classifyOpencodeVersion("2.3.1");
    expect(r.status).toBe("unvalidated");
    expect(r.message).toContain("2.3");
    expect(r.hardFail).toBe(false);
  });

  it("treats unparseable output as unsupported", () => {
    expect(classifyOpencodeVersion("unknown").status).toBe("unsupported");
    expect(classifyOpencodeVersion("").status).toBe("unsupported");
  });

  it("exposes supported range and validated minor constants", () => {
    expect(SUPPORTED_RANGE).toEqual({ minMajor: 2, maxMajorExclusive: 3 });
    expect(VALIDATED_MINOR).toBe(0);
  });
});

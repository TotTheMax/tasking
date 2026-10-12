import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotenvIfPresent } from "../src/config/dotenv.js";

const KEYS = ["TASKING_DOTENV_A", "TASKING_DOTENV_B"] as const;

describe("loadDotenvIfPresent", () => {
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("returns false when the dir has no .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "dotenv-missing-"));
    try {
      expect(loadDotenvIfPresent(dir)).toBe(false);
      expect(process.env.TASKING_DOTENV_A).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads vars from an existing .env without overriding real env", () => {
    const dir = mkdtempSync(join(tmpdir(), "dotenv-load-"));
    try {
      writeFileSync(join(dir, ".env"), "TASKING_DOTENV_A=file-a\nTASKING_DOTENV_B=file-b\n");
      process.env.TASKING_DOTENV_A = "real-a";
      expect(loadDotenvIfPresent(dir)).toBe(true);
      expect(process.env.TASKING_DOTENV_A).toBe("real-a");
      expect(process.env.TASKING_DOTENV_B).toBe("file-b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

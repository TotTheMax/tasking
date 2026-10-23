import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/shared/redact.js";

const TOKEN = "redact-test-token-0123456789abcdef0123456789";

describe("redactSecrets", () => {
  it("masks bearer and basic authorization values", () => {
    const cmd = `curl -s -H "Authorization: Bearer ${TOKEN}" http://jira/rest/api/2`;
    const out = redactSecrets(cmd);
    expect(out).toContain("Bearer ***");
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("http://jira/rest/api/2");
  });

  it("masks credential-style key/value pairs", () => {
    expect(redactSecrets("api_key=abcdefgh12345678 call")).toBe("api_key=*** call");
    expect(redactSecrets("--data token:deadbeef12345678")).toBe("--data token:***");
    expect(redactSecrets("secret mysecretpassword1")).toBe("secret ***");
  });

  it("masks standalone long token-like runs as a backstop", () => {
    expect(redactSecrets(`jq . ${TOKEN} done`)).toBe("jq . *** done");
  });

  it("leaves ordinary commands, paths, and short words untouched", () => {
    const cmd = "git status --porcelain && npm run build";
    expect(redactSecrets(cmd)).toBe(cmd);
    expect(redactSecrets("command -v mcp-cli && mcp-cli info jira")).toBe(
      "command -v mcp-cli && mcp-cli info jira",
    );
    expect(redactSecrets("echo hello")).toBe("echo hello");
  });

  it("keeps glob save patterns intact", () => {
    const patterns = "curl *、sleep *、curl *";
    expect(redactSecrets(patterns)).toBe(patterns);
  });
});

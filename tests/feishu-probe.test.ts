import { describe, expect, it } from "vitest";
import {
  consoleLinks,
  diagnoseFeishuError,
  probeListChats,
  probeListMessages,
  probeUploadFile,
  sendScopeItem,
} from "../src/adapters/feishu/probe.js";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchReturning(...responses: Response[]): typeof fetch {
  let call = 0;
  return (async () => {
    const res = responses[Math.min(call, responses.length - 1)];
    call++;
    return res;
  }) as typeof fetch;
}

function fetchThrowing(): typeof fetch {
  return (async () => {
    throw new Error("network unreachable");
  }) as typeof fetch;
}

describe("consoleLinks", () => {
  it("embeds the app_id in every link and falls back to a stable root", () => {
    const links = consoleLinks("cli_xxx");
    expect(links.app).toBe("https://open.feishu.cn/app/cli_xxx");
    for (const url of [links.app, links.permission, links.event, links.version]) {
      expect(url).toContain("cli_xxx");
    }
  });

  it("derives lark console links from open.larksuite.com", () => {
    const links = consoleLinks("cli_xxx", "lark");
    expect(links.app).toBe("https://open.larksuite.com/app/cli_xxx");
    expect(links.permission).toBe("https://open.larksuite.com/app/cli_xxx/safe/permission");
    expect(links.version).toBe("https://open.larksuite.com/app/cli_xxx/version");
  });
});

describe("probe edition derivation", () => {
  it("probes and hints with lark domains when edition is lark", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      urls.push(u);
      return jsonResponse(403, { code: 99991672 });
    }) as typeof fetch;
    const item = await probeListMessages("t", "oc_intake", fetchImpl, "cli_xxx", "lark");
    expect(urls[0]?.startsWith("https://open.larksuite.com/")).toBe(true);
    expect(item.hint).toContain("open.larksuite.com/app/cli_xxx");
  });

  it("diagnoseFeishuError hint follows the edition", () => {
    const hint = diagnoseFeishuError(403, "forbidden", "cli_xxx", "lark");
    expect(hint).toContain("open.larksuite.com/app/cli_xxx/version");
  });
});

describe("sendScopeItem", () => {
  it("is marked unprobed without claiming a result", () => {
    const item = sendScopeItem();
    expect(item.status).toBe("unprobed");
    expect(item.scope).toBe("im:message");
    expect(item.hint).toContain("未探测");
  });
});

describe("probeListChats", () => {
  it("reports ok and returns the chats for the picker", async () => {
    const fetchImpl = fetchReturning(
      jsonResponse(200, { data: { items: [{ chat_id: "oc_1", name: "g1" }] } }),
    );
    const { item, chats } = await probeListChats("token", fetchImpl, "cli_xxx");
    expect(item.status).toBe("ok");
    expect(chats).toEqual([{ chat_id: "oc_1", name: "g1" }]);
  });

  it("classifies 403 as missing with publish/permission hint and permission link", async () => {
    const fetchImpl = fetchReturning(jsonResponse(403, { code: 99991661, msg: "no permission" }));
    const { item } = await probeListChats("token", fetchImpl, "cli_xxx");
    expect(item.status).toBe("missing");
    expect(item.hint).toContain("im:chat");
  });

  it("classifies network failure as unknown without blaming a scope", async () => {
    const { item } = await probeListChats("token", fetchThrowing(), "cli_xxx");
    expect(item.status).toBe("unknown");
    expect(item.hint).not.toContain("im:");
  });
});

describe("probeListMessages", () => {
  it("reports ok covering group_msg and readonly", async () => {
    const fetchImpl = fetchReturning(jsonResponse(200, { data: { items: [] } }));
    const item = await probeListMessages("token", "oc_intake", fetchImpl, "cli_xxx");
    expect(item.status).toBe("ok");
    expect(item.scope).toBe("im:message.group_msg + im:message");
  });

  it("classifies body code 230027 as missing im:message.group_msg", async () => {
    const fetchImpl = fetchReturning(jsonResponse(400, { code: 230027, msg: "no scope" }));
    const item = await probeListMessages("token", "oc_intake", fetchImpl, "cli_xxx");
    expect(item.status).toBe("missing");
    expect(item.hint).toContain("im:message.group_msg");
    expect(item.hint).toContain(consoleLinks("cli_xxx").permission);
  });

  it("classifies network failure as unknown", async () => {
    const item = await probeListMessages("token", "oc_intake", fetchThrowing(), "cli_xxx");
    expect(item.status).toBe("unknown");
  });
});

describe("probeUploadFile", () => {
  it("reports ok when upload succeeds", async () => {
    const fetchImpl = fetchReturning(jsonResponse(200, { data: { file_key: "fk" } }));
    const item = await probeUploadFile("token", fetchImpl, "cli_xxx");
    expect(item.status).toBe("ok");
    expect(item.scope).toBe("im:resource");
  });

  it("classifies 99991672 / access denied as missing im:resource", async () => {
    const fetchImpl = fetchReturning(jsonResponse(403, { code: 99991672, msg: "Access denied" }));
    const item = await probeUploadFile("token", fetchImpl, "cli_xxx");
    expect(item.status).toBe("missing");
    expect(item.hint).toContain("im:resource");
  });

  it("classifies network failure as unknown", async () => {
    const item = await probeUploadFile("token", fetchThrowing(), "cli_xxx");
    expect(item.status).toBe("unknown");
  });
});

describe("diagnoseFeishuError", () => {
  it("maps 403 to publish/approval hint with the version link", () => {
    const hint = diagnoseFeishuError(403, "", "cli_xxx");
    expect(hint).toContain("版本未发布");
    expect(hint).toContain(consoleLinks("cli_xxx").version);
  });

  it("maps 230027 to the missing group_msg scope with the permission link", () => {
    const hint = diagnoseFeishuError(400, JSON.stringify({ code: 230027 }), "cli_xxx");
    expect(hint).toContain("im:message.group_msg");
    expect(hint).toContain("permission");
  });

  it("maps 99991672 to missing im:resource", () => {
    const hint = diagnoseFeishuError(403, JSON.stringify({ code: 99991672 }), "cli_xxx");
    expect(hint).toContain("im:resource");
  });

  it("returns null for unknown statuses", () => {
    expect(diagnoseFeishuError(500, "", "cli_xxx")).toBeNull();
  });
});

describe("probe error-code handling (HTTP 200 with body code)", () => {
  it("classifies body code 230027 as missing even on HTTP 200", async () => {
    const fetchImpl = fetchReturning(
      jsonResponse(200, { code: 230027, msg: "no scope", data: {} }),
    );
    const item = await probeListMessages("token", "oc_intake", fetchImpl, "cli_xxx");
    expect(item.status).toBe("missing");
    expect(item.hint).toContain("im:message.group_msg");
  });

  it("classifies body code 99991672 as missing even on HTTP 200", async () => {
    const fetchImpl = fetchReturning(
      jsonResponse(200, { code: 99991672, msg: "Access denied", data: {} }),
    );
    const item = await probeUploadFile("token", fetchImpl, "cli_xxx");
    expect(item.status).toBe("missing");
    expect(item.hint).toContain("im:resource");
  });

  it("treats 401 as unknown (credentials), not a missing scope", async () => {
    const fetchImpl = fetchReturning(jsonResponse(401, { code: 99991663, msg: "bad token" }));
    const { item } = await probeListChats("token", fetchImpl, "cli_xxx");
    expect(item.status).toBe("unknown");
    expect(item.hint).not.toContain("im:");
  });
});

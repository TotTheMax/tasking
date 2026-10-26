import { describe, expect, it, vi } from "vitest";
import { ApprovalCoordinator } from "../src/driver/approval.js";
import type { PendingPermission } from "../src/driver/session-ops.js";

function pending(id: string, sessionId = "ses_1"): PendingPermission {
  return {
    id,
    sessionID: sessionId,
    action: "shell",
    resources: [`echo ${id}`],
    save: ["echo *"],
    source: { type: "tool", messageID: "msg_1", id: "call_1" },
  };
}

function coordinator() {
  const replyPermission = vi.fn(async () => {});
  const onCardRequested = vi.fn();
  const onCardResolved = vi.fn();
  const c = new ApprovalCoordinator({ replyPermission, onCardRequested, onCardResolved });
  return { c, replyPermission, onCardRequested, onCardResolved };
}

describe("ApprovalCoordinator", () => {
  it("requests a card for newly pending approvals", () => {
    const { c, onCardRequested } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    expect(onCardRequested).toHaveBeenCalledWith(
      expect.objectContaining({ requestID: "per_1", sessionId: "ses_1", action: "shell" }),
    );
    expect(c.state("per_1")).toBe("pending");
  });

  it("does not re-request cards for already-known approvals", () => {
    const { c, onCardRequested } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    c.ingest("ses_1", [pending("per_1")]);
    expect(onCardRequested).toHaveBeenCalledTimes(1);
  });

  it("reply submits once and marks replied", async () => {
    const { c, replyPermission, onCardResolved } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    const res = await c.reply("per_1", "once");
    expect(res).toBe("replied");
    expect(replyPermission).toHaveBeenCalledWith("ses_1", "per_1", "once");
    expect(onCardResolved).toHaveBeenCalledWith("per_1", "replied", "once");
    expect(c.state("per_1")).toBe("replied");
  });

  it("second click on a replied approval returns already", async () => {
    const { c, replyPermission } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    await c.reply("per_1", "once");
    replyPermission.mockClear();
    const res = await c.reply("per_1", "reject");
    expect(res).toBe("already");
    expect(replyPermission).not.toHaveBeenCalled();
  });

  it("reply for unknown approval returns unknown", async () => {
    const { c, replyPermission } = coordinator();
    const res = await c.reply("per_ghost", "once");
    expect(res).toBe("unknown");
    expect(replyPermission).not.toHaveBeenCalled();
  });

  it("disappeared pending approvals resolve as externally-handled", () => {
    const { c, onCardResolved } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    c.ingest("ses_1", []);
    expect(c.state("per_1")).toBe("external");
    expect(onCardResolved).toHaveBeenCalledWith("per_1", "external", undefined);
  });

  it("markExpired stamps the card without double reply", async () => {
    const { c, onCardResolved } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    c.markExpired("per_1");
    expect(c.state("per_1")).toBe("expired");
    expect(onCardResolved).toHaveBeenCalledWith("per_1", "expired", undefined);
    const res = await c.reply("per_1", "once");
    expect(res).toBe("already");
  });

  it("reply failure leaves approval pending", async () => {
    const { c, replyPermission } = coordinator();
    replyPermission.mockRejectedValue(new Error("api down"));
    c.ingest("ses_1", [pending("per_1")]);
    const res = await c.reply("per_1", "once");
    expect(res).toBe("failed");
    expect(c.state("per_1")).toBe("pending");
  });

  it("ingesting two pendings at once keeps both pending", () => {
    const { c, onCardRequested } = coordinator();
    c.ingest("ses_1", [pending("per_1"), pending("per_2")]);
    expect(c.state("per_1")).toBe("pending");
    expect(c.state("per_2")).toBe("pending");
    expect(onCardRequested).toHaveBeenCalledTimes(2);
  });

  it("cancelled approvals (turn interrupted) reject further replies", async () => {
    const { c } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    c.cancelAll("ses_1");
    expect(c.state("per_1")).toBe("cancelled");
    const res = await c.reply("per_1", "once");
    expect(res).toBe("already");
  });

  it("revives a cancelled approval that is still pending server-side on the next turn", async () => {
    const { c, onCardRequested, replyPermission } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    c.cancelAll("ses_1");
    expect(c.state("per_1")).toBe("cancelled");
    c.ingest("ses_1", [pending("per_1")]);
    expect(c.state("per_1")).toBe("pending");
    expect(onCardRequested).toHaveBeenCalledTimes(2);
    const res = await c.reply("per_1", "once");
    expect(res).toBe("replied");
    expect(replyPermission).toHaveBeenCalled();
  });

  it("revives an externally-resolved approval when the same id is pending again", async () => {
    const { c, onCardRequested } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    c.ingest("ses_1", []);
    expect(c.state("per_1")).toBe("external");
    c.ingest("ses_1", [pending("per_1")]);
    expect(c.state("per_1")).toBe("pending");
    expect(onCardRequested).toHaveBeenCalledTimes(2);
    const res = await c.reply("per_1", "once");
    expect(res).toBe("replied");
  });

  it("exposes the request and resolution for card re-rendering", async () => {
    const { c } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    expect(c.requestOf("per_1")).toEqual({
      requestID: "per_1",
      sessionId: "ses_1",
      action: "shell",
      resources: ["echo per_1"],
      save: ["echo *"],
    });
    expect(c.resolutionOf("per_1")).toEqual({ state: "pending" });
    await c.reply("per_1", "always");
    expect(c.resolutionOf("per_1")).toEqual({ state: "replied", decision: "always" });
    expect(c.requestOf("per_ghost")).toBeUndefined();
    expect(c.resolutionOf("per_ghost")).toBeUndefined();
  });

  it("prunes resolved entries once it exceeds the cap, keeping pending ones", async () => {
    const { c } = coordinator();
    for (let i = 0; i < 5; i++) {
      c.ingest("ses_1", [pending(`old_${i}`)]);
      await c.reply(`old_${i}`, "once");
    }
    for (let i = 0; i < 500; i++) {
      c.ingest("ses_1", [pending(`new_${i}`)]);
    }
    expect(c.state("old_0")).toBeUndefined();
    expect(c.state("new_499")).toBe("pending");
  });
});

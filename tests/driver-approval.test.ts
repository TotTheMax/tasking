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

  it("cancelled approvals (turn interrupted) reject further replies", async () => {
    const { c } = coordinator();
    c.ingest("ses_1", [pending("per_1")]);
    c.cancelAll("ses_1");
    expect(c.state("per_1")).toBe("cancelled");
    const res = await c.reply("per_1", "once");
    expect(res).toBe("already");
  });
});

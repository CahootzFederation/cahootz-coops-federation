import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  proposal: { findUnique: vi.fn() },
  notification: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  userCoopMembership: { findMany: vi.fn() },
}));
const push = vi.hoisted(() => vi.fn());
vi.mock("@repo/db", () => ({ db }));
vi.mock("../services/push-notification-service.js", () => ({ createNotificationAndPush: push }));

const { notifyProposalOpenForVote, voteOpenText } = await import("../services/proposal-notifications.js");

const PROPOSAL = {
  id: "prop-1", coopId: "harbor", status: "VOTABLE", title: "Shared tool library", proposerWallet: "0xabc",
  proposerDisplayName: "Maya", votingEndsAt: new Date("2026-10-25T19:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.proposal.findUnique.mockResolvedValue(PROPOSAL);
  db.notification.findFirst.mockResolvedValue(null);
  db.user.findFirst.mockResolvedValue({ id: "maya" });
  db.userCoopMembership.findMany.mockResolvedValue([{ userId: "dev" }, { userId: "rosa" }]);
  push.mockResolvedValue({ id: "n" });
});

describe("telling members a proposal is open for a vote", () => {
  it("says who put it up and when voting closes, in plain words", () => {
    expect(voteOpenText(PROPOSAL)).toEqual({ title: "New vote: Shared tool library", body: "Maya put up a proposal. Take a look and vote. Voting closes Sun, Oct 25." });
    expect(voteOpenText({ ...PROPOSAL, proposerWallet: "sage:bot", proposerDisplayName: "Sage", votingEndsAt: null }).body).toBe("Sage put up a proposal. Take a look and vote.");
  });

  it("tells every active member except the proposer, with a link to the proposal", async () => {
    await expect(notifyProposalOpenForVote("prop-1", db as never)).resolves.toBe(2);
    expect(db.userCoopMembership.findMany).toHaveBeenCalledWith({ where: { coopId: "harbor", status: "ACTIVE", user: { isBot: false }, userId: { not: "maya" } }, select: { userId: true } });
    expect(push).toHaveBeenCalledWith(db, expect.objectContaining({ userId: "dev", type: "PROPOSAL_CREATED", data: { proposalId: "prop-1", coopId: "harbor" } }));
  });

  it("tells everyone about Sage's proposal, since Sage isn't a member", async () => {
    db.proposal.findUnique.mockResolvedValue({ ...PROPOSAL, proposerWallet: "sage:bot" });
    await notifyProposalOpenForVote("prop-1", db as never);
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.userCoopMembership.findMany).toHaveBeenCalledWith({ where: { coopId: "harbor", status: "ACTIVE", user: { isBot: false } }, select: { userId: true } });
  });

  it("only once per proposal, and only when it's open for a vote", async () => {
    db.notification.findFirst.mockResolvedValueOnce({ id: "sent" });
    await expect(notifyProposalOpenForVote("prop-1", db as never)).resolves.toBe(0);
    db.proposal.findUnique.mockResolvedValueOnce({ ...PROPOSAL, status: "SUBMITTED" });
    await expect(notifyProposalOpenForVote("prop-1", db as never)).resolves.toBe(0);
    expect(push).not.toHaveBeenCalled();
  });
});

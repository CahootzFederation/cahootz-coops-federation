import { db as defaultDb } from "@repo/db";

import { createNotificationAndPush } from "./push-notification-service.js";

/**
 * Tells a Commons' members when a proposal opens for a vote, so people know to vote. It covers every
 * proposal, whether a member or Sage put it up, and whether it opened at creation, after a rewrite, or
 * when an admin opened it. It goes to every active member except the proposer, once per proposal, in the
 * Governance notification category (members can turn its push off in their settings).
 */
export const PROPOSAL_VOTE_OPEN_TYPE = "PROPOSAL_CREATED";
const SAGE_WALLET = "sage:bot";

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The alert members get. Plain and exact: who put it up and when voting closes. */
export function voteOpenText(proposal: { title: string; proposerWallet: string; proposerDisplayName: string | null; votingEndsAt: Date | null }) {
  const who = proposal.proposerWallet === SAGE_WALLET ? "Sage" : clip(proposal.proposerDisplayName || "A member", 40);
  const closes = proposal.votingEndsAt ? ` Voting closes ${DAY_FORMAT.format(proposal.votingEndsAt)}.` : "";
  return {
    title: clip(`New vote: ${proposal.title}`, 70),
    body: clip(`${who} put up a proposal. Take a look and vote.${closes}`, 140),
  };
}

type Db = typeof defaultDb;

/** Sends the alert if the proposal is open for a vote and members haven't been told yet. Returns how many were told. */
export async function notifyProposalOpenForVote(proposalId: string, client: Db = defaultDb): Promise<number> {
  const proposal = await client.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, coopId: true, status: true, title: true, proposerWallet: true, proposerDisplayName: true, votingEndsAt: true },
  });
  if (!proposal?.coopId || proposal.status !== "VOTABLE") return 0;
  const already = await client.notification.findFirst({
    where: { type: PROPOSAL_VOTE_OPEN_TYPE, data: { path: ["proposalId"], equals: proposal.id } },
    select: { id: true },
  });
  if (already) return 0;

  const proposer = proposal.proposerWallet === SAGE_WALLET ? null : await client.user.findFirst({
    where: { walletAddress: { equals: proposal.proposerWallet, mode: "insensitive" } }, select: { id: true },
  });
  const members = await client.userCoopMembership.findMany({
    where: { coopId: proposal.coopId, status: "ACTIVE", user: { isBot: false }, ...(proposer ? { userId: { not: proposer.id } } : {}) },
    select: { userId: true },
  });
  const text = voteOpenText(proposal);
  let notified = 0;
  for (const { userId } of members) {
    try {
      await createNotificationAndPush(client as never, {
        userId, coopId: proposal.coopId, type: PROPOSAL_VOTE_OPEN_TYPE, title: text.title, body: text.body,
        data: { proposalId: proposal.id, coopId: proposal.coopId },
      });
      notified++;
    } catch (error) {
      console.error("Could not send a new-vote notification", { proposalId: proposal.id, error });
    }
  }
  return notified;
}

/** Fire and forget from a request: a failed alert never fails saving the proposal. */
export function announceProposalVote(proposalId: string, client: Db = defaultDb): void {
  void notifyProposalOpenForVote(proposalId, client).catch((error) => console.error("New-vote notification failed", { proposalId, error }));
}

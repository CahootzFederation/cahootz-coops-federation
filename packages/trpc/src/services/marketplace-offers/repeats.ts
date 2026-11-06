import type { Prisma } from "@repo/db";

import type { Tx } from "./shared.js";

type OfferRow = Prisma.MarketplaceOfferGetPayload<Record<string, never>>;

const DAY = 24 * 60 * 60 * 1000;
export const REPEAT_ACTOR = "system:offer-repeat";

/**
 * Posts the next copy of a repeating deal, live right away with nobody in it
 * yet. Called in the same transaction that closes this copy (goal met or time
 * up), and only the run that wins that status change gets here, so each copy is
 * followed by exactly one new one. A cancelled copy is never followed.
 */
export async function postNextRound(tx: Tx, offer: OfferRow, now: Date) {
  if (!offer.repeats) return null;
  const {
    id,
    status,
    committedQuantity,
    publishedAt,
    commitmentDeadline,
    paymentOpensAt,
    paymentDeadline,
    fulfillmentDate,
    expiresAt,
    cancelledAt,
    cancelReason,
    stewardNote,
    stewardApprovedById,
    stewardApprovedAt,
    repeatedFromId,
    createdById,
    createdAt,
    updatedAt,
    ...copy
  } = offer;
  return tx.marketplaceOffer.create({
    data: {
      ...copy,
      status: "LIVE",
      committedQuantity: 0,
      publishedAt: now,
      commitmentDeadline: new Date(now.getTime() + (offer.roundDays ?? 30) * DAY),
      repeatedFromId: offer.id,
      createdById: REPEAT_ACTOR,
    },
  });
}

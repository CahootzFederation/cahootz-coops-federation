import { TRPCError } from "@trpc/server";

import type { OfferStatus, OfferType } from "@repo/validators/marketplace-offers";

import type { Db, Tx } from "./shared.js";

/**
 * Every allowed status change, per offer type. Anything not listed is refused.
 *
 * Member Deal: DRAFT → PENDING_STEWARD → LIVE ⇄ PAUSED → EXPIRED / CANCELLED
 * Group Buy:   DRAFT → PENDING_STEWARD → LIVE → AWAITING_VENDOR → PAYMENT_OPEN
 *              → CONFIRMED → ORDERED → READY → FULFILLED, with EXPIRED (too few
 *              commitments), FAILED (too few payments) and CANCELLED as ends.
 * A steward sending an offer back returns it to DRAFT.
 */
export const OFFER_TRANSITIONS: Record<OfferType, Partial<Record<OfferStatus, readonly OfferStatus[]>>> = {
  MEMBER_DEAL: {
    DRAFT: ["PENDING_STEWARD", "CANCELLED"],
    PENDING_STEWARD: ["LIVE", "DRAFT", "CANCELLED"],
    LIVE: ["PAUSED", "EXPIRED", "CANCELLED"],
    PAUSED: ["LIVE", "EXPIRED", "CANCELLED"],
  },
  GROUP_BUY: {
    DRAFT: ["PENDING_STEWARD", "CANCELLED"],
    PENDING_STEWARD: ["LIVE", "DRAFT", "CANCELLED"],
    LIVE: ["PAUSED", "AWAITING_VENDOR", "EXPIRED", "CANCELLED"],
    PAUSED: ["LIVE", "EXPIRED", "CANCELLED"],
    AWAITING_VENDOR: ["PAYMENT_OPEN", "CANCELLED"],
    PAYMENT_OPEN: ["CONFIRMED", "FAILED", "CANCELLED"],
    CONFIRMED: ["ORDERED", "CANCELLED"],
    ORDERED: ["READY", "CANCELLED"],
    READY: ["FULFILLED", "CANCELLED"],
  },
};

export function canTransition(offerType: OfferType, from: OfferStatus, to: OfferStatus) {
  return OFFER_TRANSITIONS[offerType][from]?.includes(to) ?? false;
}

const STATUS_WORDS: Record<OfferStatus, string> = {
  DRAFT: "a draft",
  PENDING_STEWARD: "waiting for a steward",
  LIVE: "live",
  PAUSED: "paused",
  AWAITING_VENDOR: "waiting for the vendor",
  PAYMENT_OPEN: "open for payment",
  CONFIRMED: "confirmed",
  ORDERED: "ordered",
  READY: "ready",
  FULFILLED: "finished",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  FAILED: "called off",
};

/**
 * Moves an offer from its current status to `to`. The update only matches the
 * status we read, so two admins (or an admin and the sweep) can't both win.
 * Returns false when someone else changed the offer first.
 */
export async function transitionOffer(
  db: Db | Tx,
  offer: { id: string; offerType: OfferType; status: OfferStatus },
  to: OfferStatus,
  data: Record<string, unknown> = {},
) {
  if (!canTransition(offer.offerType, offer.status, to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This offer is ${STATUS_WORDS[offer.status]}, so it can't be ${STATUS_WORDS[to]} right now.`,
    });
  }
  const result = await db.marketplaceOffer.updateMany({
    where: { id: offer.id, status: offer.status },
    data: { ...data, status: to },
  });
  return result.count === 1;
}

export async function requireTransition(
  db: Db | Tx,
  offer: { id: string; offerType: OfferType; status: OfferStatus },
  to: OfferStatus,
  data: Record<string, unknown> = {},
) {
  const moved = await transitionOffer(db, offer, to, data);
  if (!moved) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Someone else just changed this offer. Refresh and try again.",
    });
  }
}

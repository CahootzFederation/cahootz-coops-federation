import { TRPCError } from "@trpc/server";

import type { ShippingAddress } from "@repo/validators/marketplace-offers";

import { auditLogEntry } from "../../lib/audit.js";
import { requireActiveMember } from "../commons-membership.js";
import { requireSavedCard, saveShippingAddress } from "./charges.js";
import { contactFor } from "./checkout.js";
import {
  ACTIVE_COMMITMENT_STATUSES,
  type Db,
  formatCents,
  lockOffer,
  notFound,
  notifyCommitters,
  sumActiveUnits,
} from "./shared.js";

type CommitResult = {
  committedQuantity: number;
  quantity: number;
  thresholdReached: boolean;
};

/**
 * A member commits to a Group Buy with a saved card and a delivery address.
 * Nothing is charged yet: the card is charged only if the goal is met.
 * Committing shares the member's name, phone and address with the vendor, which
 * the app asks them to agree to. The address is saved for their next order.
 *
 * Runs under the offer lock: the cap, the running total and the threshold check
 * all see the same numbers, and the unique (offer, member) key means a double
 * tap updates one row instead of creating two.
 */
export async function commitToOffer(
  db: Db,
  params: { userId: string; offerId: string; quantity: number; contactPhone?: string; shippingAddress: ShippingAddress },
  now = new Date(),
): Promise<CommitResult> {
  const offer = await db.marketplaceOffer.findUnique({ where: { id: params.offerId } });
  if (!offer || offer.offerType !== "GROUP_BUY") notFound();
  await requireActiveMember(db, params.userId, offer.coopId);

  const card = await requireSavedCard(db, params.userId);
  const { contactName, contactPhone } = await contactFor(db, params.userId, params.contactPhone);
  await saveShippingAddress(db, params.userId, params.shippingAddress);
  const orderDetails = {
    contactName,
    contactPhone,
    shippingAddress: params.shippingAddress,
    stripePaymentMethodId: card.stripePaymentMethodId,
    chargeError: null,
  };

  const result = await db.$transaction(async (tx) => {
    await lockOffer(tx, offer.id);
    const current = await tx.marketplaceOffer.findUniqueOrThrow({ where: { id: offer.id } });
    if (current.status !== "LIVE" || !current.commitmentDeadline || current.commitmentDeadline <= now) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This group deal isn't taking commitments anymore." });
    }
    if (params.quantity > current.quantityPerMember) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `You can commit to up to ${current.quantityPerMember} for your household.`,
      });
    }

    const existing = await tx.offerCommitment.findUnique({
      where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
    });
    if (existing && existing.status !== "COMMITTED" && existing.status !== "CANCELLED") {
      throw new TRPCError({ code: "CONFLICT", message: "You're already in this group deal." });
    }

    const othersUnits = await sumActiveUnits(tx, offer.id, params.userId);
    if (current.maximumQuantity != null && othersUnits + params.quantity > current.maximumQuantity) {
      const left = Math.max(0, current.maximumQuantity - othersUnits);
      throw new TRPCError({
        code: "CONFLICT",
        message: left > 0 ? `Only ${left} left. Try a smaller amount.` : "This group deal is full.",
      });
    }

    await tx.offerCommitment.upsert({
      where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
      create: {
        offerId: offer.id,
        userId: params.userId,
        quantity: params.quantity,
        status: "COMMITTED",
        ...orderDetails,
        regularUnitCents: current.regularPriceCents,
        memberUnitCents: current.memberPriceCents,
        committedAt: now,
      },
      update: {
        quantity: params.quantity,
        status: "COMMITTED",
        ...orderDetails,
        cancelledAt: null,
        ...(existing?.status === "CANCELLED" ? { committedAt: now } : {}),
      },
    });

    const before = current.committedQuantity;
    const after = othersUnits + params.quantity;
    await tx.marketplaceOffer.update({ where: { id: offer.id }, data: { committedQuantity: after } });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.userId,
        action: existing?.status === "COMMITTED" ? "OFFER_COMMITMENT_UPDATED" : "OFFER_COMMITMENT_CREATED",
        resource: "MarketplaceOffer",
        resourceId: offer.id,
        metadata: { quantity: params.quantity },
      }),
    });
    const minimum = current.minimumCommitments ?? Number.POSITIVE_INFINITY;
    return {
      committedQuantity: after,
      quantity: params.quantity,
      thresholdReached: before < minimum && after >= minimum,
    };
  });

  if (result.thresholdReached) {
    await notifyCommitters(db, offer, ACTIVE_COMMITMENT_STATUSES, {
      kind: "threshold-reached",
      type: "GROUP_BUY_THRESHOLD_REACHED",
      title: "Your group deal is happening",
      body: `${offer.title} hit its goal. When commitments close, we'll charge your saved card ${formatCents(offer.memberPriceCents)} each. You haven't been charged yet.`,
    });
  }

  return { committedQuantity: result.committedQuantity, quantity: result.quantity, thresholdReached: result.thresholdReached };
}

/** A member backs out before the commitment deadline. Nothing was charged, so nothing to refund. */
export async function cancelCommitment(
  db: Db,
  params: { userId: string; offerId: string },
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    await lockOffer(tx, params.offerId);
    const offer = await tx.marketplaceOffer.findUnique({ where: { id: params.offerId } });
    if (!offer) notFound();
    const commitment = await tx.offerCommitment.findUnique({
      where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
    });
    if (!commitment || commitment.status !== "COMMITTED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You don't have a spot to cancel." });
    }
    if (offer.status !== "LIVE" || !offer.commitmentDeadline || offer.commitmentDeadline <= now) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The commitment deadline has passed, so you can't cancel in the app. Reply to your order notice and we'll help.",
      });
    }
    await tx.offerCommitment.update({
      where: { id: commitment.id },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    const committedQuantity = await sumActiveUnits(tx, offer.id);
    await tx.marketplaceOffer.update({ where: { id: offer.id }, data: { committedQuantity } });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.userId,
        action: "OFFER_COMMITMENT_CANCELLED",
        resource: "MarketplaceOffer",
        resourceId: offer.id,
      }),
    });
    return { committedQuantity };
  });
}

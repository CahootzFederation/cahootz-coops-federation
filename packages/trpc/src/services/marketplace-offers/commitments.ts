import { TRPCError } from "@trpc/server";

import { auditLogEntry } from "../../lib/audit.js";
import { requireActiveMember } from "../commons-membership.js";
import { createNotificationAndPush } from "../push-notification-service.js";
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
 * A member commits to a Group Buy. Nothing is charged. Committing shares the
 * member's name and phone with the vendor, which the app asks them to agree to.
 *
 * Runs under the offer lock: the cap, the running total and the threshold check
 * all see the same numbers, and the unique (offer, member) key means a double
 * tap updates one row instead of creating two.
 */
export async function commitToOffer(
  db: Db,
  params: { userId: string; offerId: string; quantity: number; contactPhone?: string },
  now = new Date(),
): Promise<CommitResult> {
  const offer = await db.marketplaceOffer.findUnique({
    where: { id: params.offerId },
    include: { store: { select: { ownerId: true, name: true } } },
  });
  if (!offer || offer.offerType !== "GROUP_BUY") notFound();
  await requireActiveMember(db, params.userId, offer.coopId);

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { name: true, nickname: true, handle: true, phone: true },
  });
  const contactName = user?.name || user?.nickname || user?.handle || "A member";
  const contactPhone = params.contactPhone?.trim() || user?.phone || null;

  const result = await db.$transaction(async (tx) => {
    await lockOffer(tx, offer.id);
    const current = await tx.marketplaceOffer.findUniqueOrThrow({ where: { id: offer.id } });
    if (current.status !== "LIVE" || !current.commitmentDeadline || current.commitmentDeadline <= now) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This group buy isn't taking commitments anymore." });
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
      throw new TRPCError({ code: "CONFLICT", message: "You're already in this group buy." });
    }

    const othersUnits = await sumActiveUnits(tx, offer.id, params.userId);
    if (current.maximumQuantity != null && othersUnits + params.quantity > current.maximumQuantity) {
      const left = Math.max(0, current.maximumQuantity - othersUnits);
      throw new TRPCError({
        code: "CONFLICT",
        message: left > 0 ? `Only ${left} left. Try a smaller amount.` : "This group buy is full.",
      });
    }

    await tx.offerCommitment.upsert({
      where: { offerId_userId: { offerId: offer.id, userId: params.userId } },
      create: {
        offerId: offer.id,
        userId: params.userId,
        quantity: params.quantity,
        status: "COMMITTED",
        contactName,
        contactPhone,
        regularUnitCents: current.regularPriceCents,
        memberUnitCents: current.memberPriceCents,
        committedAt: now,
      },
      update: {
        quantity: params.quantity,
        status: "COMMITTED",
        contactName,
        contactPhone,
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
      isNew: existing?.status !== "COMMITTED",
    };
  });

  if (result.isNew) {
    // Inbox only: the vendor gets one push when the goal is met, not one per member.
    await createNotificationAndPush(db, {
      userId: offer.store.ownerId,
      coopId: offer.coopId,
      type: "VENDOR_OFFER_COMMITMENT",
      title: `${contactName} joined your group buy`,
      body: `${offer.title}: ${result.committedQuantity} committed so far.`,
      push: false,
      data: { offerId: offer.id, coopId: offer.coopId },
    }).catch((error) => console.error("Failed to notify vendor of commitment:", error));
  }

  if (result.thresholdReached) {
    await notifyCommitters(db, offer, ACTIVE_COMMITMENT_STATUSES, {
      kind: "threshold-reached",
      type: "GROUP_BUY_THRESHOLD_REACHED",
      title: "Your group buy is happening",
      body: `${offer.title} hit its goal. We'll let you know when it's time to pay ${formatCents(offer.memberPriceCents)} each. You haven't been charged.`,
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
        message: "The commitment deadline has passed, so you can't cancel in the app. Message the vendor or a steward for help.",
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

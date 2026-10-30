import { TRPCError } from "@trpc/server";

import type { Prisma } from "@repo/db";

import type { Context } from "../../context.js";
import { requireActiveMember } from "../commons-membership.js";
import { createNotificationAndPush } from "../push-notification-service.js";

export type Db = Context["db"];
export type Tx = Prisma.TransactionClient;

/** Commitments that hold a unit: they count toward the minimum and the cap. */
export const ACTIVE_COMMITMENT_STATUSES = [
  "COMMITTED",
  "PAYMENT_PENDING",
  "PAID",
  "FULFILLED",
] as const;

/** Commitments that have actually been paid for. Only these carry savings. */
export const PAID_COMMITMENT_STATUSES = ["PAID", "FULFILLED"] as const;

/** Group Buy states a member can see without having joined. */
export const MEMBER_VISIBLE_GROUP_BUY_STATUSES = [
  "LIVE",
  "AWAITING_VENDOR",
  "PAYMENT_OPEN",
  "CONFIRMED",
  "ORDERED",
  "READY",
] as const;

/**
 * Serializes every change to one offer's commitments. Without it, two members
 * committing at the same moment could both squeeze into the last spot.
 */
export async function lockOffer(tx: Tx, offerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`marketplace-offer:${offerId}`}))`;
}

export async function sumActiveUnits(tx: Tx | Db, offerId: string, exceptUserId?: string) {
  const result = await tx.offerCommitment.aggregate({
    where: {
      offerId,
      status: { in: [...ACTIVE_COMMITMENT_STATUSES] },
      ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
    },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

export async function sumPaidUnits(tx: Tx | Db, offerId: string) {
  const result = await tx.offerCommitment.aggregate({
    where: { offerId, status: { in: [...PAID_COMMITMENT_STATUSES] } },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

export function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * Checks the member can join this offer and returns the Commons their payment
 * credits. A deal in one Commons needs membership there. A deal open to every
 * Commons credits the Commons the member joined first.
 */
export async function memberCommonsFor(db: Db | Tx, userId: string, offer: { coopId: string | null }) {
  if (offer.coopId) {
    await requireActiveMember(db, userId, offer.coopId);
    return offer.coopId;
  }
  const memberships = await db.userCoopMembership.findMany({
    where: { userId, status: "ACTIVE" },
    select: { coopId: true },
    orderBy: { createdAt: "asc" },
    take: 1,
  });
  if (memberships[0]) return memberships[0].coopId;
  throw new TRPCError({ code: "FORBIDDEN", message: "Join a Commons first, then you can join this group deal." });
}

export function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that offer. It may have been removed." });
}

export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Words that fit how the member gets the deal: an order that ships, or work
 * Cahootz or the vendor does for them.
 */
export function fulfillmentWords(offer: { fulfillmentMethod: string; vendorName: string }) {
  if (offer.fulfillmentMethod === "SERVICE") {
    return {
      next: `${offer.vendorName} will reach out to get you set up.`,
      confirmed: `Enough people paid, so it's a go. ${offer.vendorName} will reach out to get you set up.`,
    };
  }
  return {
    next: "We'll let you know when it ships.",
    confirmed: "Enough people paid, so we're sending the order to the vendor. We'll tell you when it ships.",
  };
}

export function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
}

/**
 * Sends an offer notice at most once per member and kind. The claim row is
 * written first, so a retried sweep or a double webhook can't send it twice.
 */
export async function notifyOnce(
  db: Db,
  params: {
    offer: { id: string; coopId: string | null };
    userId: string;
    /** The member's Commons, for a deal open to every Commons. */
    coopId?: string | null;
    kind: string;
    type: string;
    title: string;
    body: string;
    push?: boolean;
  },
) {
  const coopId = params.offer.coopId ?? params.coopId ?? (await memberCommonsFor(db, params.userId, params.offer).catch(() => null));
  if (!coopId) return false;
  try {
    await db.offerNotificationSend.create({
      data: { offerId: params.offer.id, userId: params.userId, kind: params.kind },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  await createNotificationAndPush(db, {
    userId: params.userId,
    coopId,
    type: params.type,
    title: params.title,
    body: params.body,
    push: params.push,
    data: { offerId: params.offer.id, coopId },
  }).catch((error) => {
    console.error(`Failed to send offer notice ${params.kind}:`, error);
  });
  return true;
}

/** Notifies every member holding one of the given commitment statuses. */
export async function notifyCommitters(
  db: Db,
  offer: { id: string; coopId: string | null },
  statuses: readonly string[],
  notice: { kind: string; type: string; title: string; body: string },
) {
  const commitments = await db.offerCommitment.findMany({
    where: { offerId: offer.id, status: { in: statuses as any } },
    select: { userId: true, coopId: true },
  });
  for (const { userId, coopId } of commitments) {
    await notifyOnce(db, { offer, userId, coopId, ...notice });
  }
  return commitments.length;
}

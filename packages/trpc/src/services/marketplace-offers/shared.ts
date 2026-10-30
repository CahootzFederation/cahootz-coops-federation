import { TRPCError } from "@trpc/server";

import type { Prisma } from "@repo/db";

import type { Context } from "../../context.js";
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

export function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that offer. It may have been removed." });
}

export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
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
    offer: { id: string; coopId: string };
    userId: string;
    kind: string;
    type: string;
    title: string;
    body: string;
    push?: boolean;
  },
) {
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
    coopId: params.offer.coopId,
    type: params.type,
    title: params.title,
    body: params.body,
    push: params.push,
    data: { offerId: params.offer.id, coopId: params.offer.coopId },
  }).catch((error) => {
    console.error(`Failed to send offer notice ${params.kind}:`, error);
  });
  return true;
}

/** Notifies every member holding one of the given commitment statuses. */
export async function notifyCommitters(
  db: Db,
  offer: { id: string; coopId: string },
  statuses: readonly string[],
  notice: { kind: string; type: string; title: string; body: string },
) {
  const commitments = await db.offerCommitment.findMany({
    where: { offerId: offer.id, status: { in: statuses as any } },
    select: { userId: true },
  });
  for (const { userId } of commitments) {
    await notifyOnce(db, { offer, userId, ...notice });
  }
  return commitments.length;
}

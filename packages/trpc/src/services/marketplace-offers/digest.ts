import { offerSavings } from "@repo/validators/marketplace-offers";

import { createNotificationAndPush } from "../push-notification-service.js";
import { isoWeekKey } from "../sage-community-rhythm.js";
import { type Db, isUniqueViolation } from "./shared.js";

/**
 * Once a week, every active member of a Commons with live deals hears about
 * them in one notification. Stewards get the same notice as everyone else;
 * deals are run by platform admins. Text comes from the records, never a model.
 */
export const DIGEST_MAX_LINES = 3;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (date: Date) =>
  date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

type DigestOffer = {
  title: string;
  offerType: "MEMBER_DEAL" | "GROUP_BUY";
  status: string;
  regularPriceCents: number;
  memberPriceCents: number;
  committedQuantity: number;
  minimumCommitments: number | null;
  commitmentDeadline: Date | null;
  paymentDeadline: Date | null;
  expiresAt: Date | null;
};

/** One short line per deal. */
export function digestLine(offer: DigestOffer): string {
  if (offer.offerType === "GROUP_BUY") {
    if (offer.status === "PAYMENT_OPEN") {
      return `${offer.title}: it's happening. Pay ${money(offer.memberPriceCents)}${offer.paymentDeadline ? ` by ${day(offer.paymentDeadline)}` : ""}`;
    }
    const goal = offer.minimumCommitments ? `${offer.committedQuantity} of ${offer.minimumCommitments} joined` : `${offer.committedQuantity} joined`;
    return `${offer.title} group buy: ${goal}${offer.commitmentDeadline ? `, closes ${day(offer.commitmentDeadline)}` : ""}`;
  }
  const { savingsPercent } = offerSavings(offer.regularPriceCents, offer.memberPriceCents);
  return `${offer.title}: ${money(offer.memberPriceCents)}, save ${savingsPercent}%${offer.expiresAt ? `, ends ${day(offer.expiresAt)}` : ""}`;
}

export function digestText(offers: DigestOffer[]): { title: string; body: string } {
  const lines = offers.slice(0, DIGEST_MAX_LINES).map(digestLine);
  const more = offers.length - lines.length;
  return {
    title: "This week's member deals",
    body: [...lines, ...(more > 0 ? [`Plus ${more} more in the marketplace.`] : [])].join("\n"),
  };
}

/** Sends this week's deals notice to every active member of each Commons that has live deals. Safe to run twice. */
export async function sendWeeklyDealsDigest(db: Db, now = new Date(), options: { coopIds?: string[] } = {}) {
  const offers = await db.marketplaceOffer.findMany({
    where: {
      ...(options.coopIds ? { coopId: { in: options.coopIds } } : {}),
      OR: [{ status: "LIVE" }, { offerType: "GROUP_BUY", status: "PAYMENT_OPEN" }],
    },
    orderBy: { publishedAt: "desc" },
    select: {
      coopId: true, title: true, offerType: true, status: true, regularPriceCents: true, memberPriceCents: true,
      committedQuantity: true, minimumCommitments: true, commitmentDeadline: true, paymentDeadline: true, expiresAt: true,
    },
  });
  const byCommons = new Map<string, DigestOffer[]>();
  for (const offer of offers) byCommons.set(offer.coopId, [...(byCommons.get(offer.coopId) ?? []), offer]);

  const weekKey = isoWeekKey(now);
  let sent = 0;
  for (const [coopId, list] of byCommons) {
    const text = digestText(list);
    const members = await db.userCoopMembership.findMany({
      where: { coopId, status: "ACTIVE", user: { isBot: false } },
      select: { userId: true },
    });
    for (const { userId } of members) {
      // Claim first: one notice per member, Commons and week.
      try {
        await db.offerDigestSend.create({ data: { coopId, userId, weekKey } });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
      await createNotificationAndPush(db, {
        userId,
        coopId,
        type: "OFFER_WEEKLY_DIGEST",
        title: text.title,
        body: text.body,
        data: { coopId, lane: "marketplace" },
      }).catch((error) => console.error("[offers] Weekly deals notice failed:", error));
      sent++;
    }
  }
  return { commons: byCommons.size, sent };
}

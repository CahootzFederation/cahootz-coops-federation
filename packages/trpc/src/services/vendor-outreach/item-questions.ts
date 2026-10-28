import type { Context } from "../../context.js";

import { DEAL_QUESTION_CLOSING, dealCategoriesInText } from "./categories.js";

type Db = Context["db"];

/**
 * Shared pieces for items the product-discovery bot found: their deal
 * category, current price evidence, and the fixed question Sage can post about
 * one. Kept apart from items.ts so the weekly demand check can use it without
 * loading the admin actions.
 */
export type ItemSnapshot = {
  productId: string;
  name: string;
  supplierName: string;
  memberShare: string;
  regularPriceCents: number;
  bulkShareCents: number;
  peopleNeeded: number;
  sourceUrl: string;
  observedAt: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The deal category an item belongs to, from its own words; "other" when none fits. */
export function dealCategoryForItem(item: { category: string; name: string; description?: string | null }) {
  return dealCategoriesInText(`${item.category}\n${item.name}\n${item.description ?? ""}`)[0] ?? "other";
}

/** The newest price evidence that hasn't expired, or null. */
export async function currentObservation(db: Db, productId: string, now: Date) {
  return db.productPriceObservation.findFirst({
    where: { productId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { observedAt: "desc" },
  });
}

export function itemSnapshot(
  product: { id: string; name: string; supplierName: string },
  observation: { memberShare: string; regularPriceCents: number; bulkShareCents: number; peopleNeeded: number; sourceUrl: string; observedAt: Date },
): ItemSnapshot {
  return {
    productId: product.id,
    name: product.name,
    supplierName: product.supplierName,
    memberShare: observation.memberShare,
    regularPriceCents: observation.regularPriceCents,
    bulkShareCents: observation.bulkShareCents,
    peopleNeeded: observation.peopleNeeded,
    sourceUrl: observation.sourceUrl,
    observedAt: observation.observedAt.toISOString(),
  };
}

/**
 * The fixed question Sage posts about one approved item. Prices come straight
 * from the bot's newest evidence and are labeled as what we found online, since
 * the seller we find sets the real price.
 */
export function itemQuestionText(item: ItemSnapshot): { title: string; body: string } {
  return {
    title: `A group buy on ${item.name}?`,
    body: [
      `${item.name} (${item.memberShare}) runs about ${money(item.regularPriceCents)} on its own. If ${item.peopleNeeded} of us buy together, it could come to about ${money(item.bulkShareCents)} each. That's from prices we found online, so the final price depends on the seller.`,
      "Would you buy one?",
      DEAL_QUESTION_CLOSING,
    ].join("\n\n"),
  };
}

/** Approved items for a Commons, best fit first, each with current price evidence. */
export async function approvedItemsForCommons(db: Db, coopId: string, now = new Date()) {
  const matches = await db.commonsProductMatch.findMany({
    where: { status: "APPROVED", profile: { coopId, isEnabled: true }, product: { status: "VERIFIED" } },
    orderBy: [{ fitScore: "desc" }, { displayOrder: "asc" }],
    include: { product: { select: { id: true, name: true, supplierName: true, category: true, description: true } } },
    take: 20,
  });
  const items: Array<ItemSnapshot & { categoryKey: string }> = [];
  for (const match of matches) {
    const observation = await currentObservation(db, match.productId, now);
    if (!observation) continue;
    items.push({ ...itemSnapshot(match.product, observation), categoryKey: dealCategoryForItem(match.product) });
  }
  return items;
}

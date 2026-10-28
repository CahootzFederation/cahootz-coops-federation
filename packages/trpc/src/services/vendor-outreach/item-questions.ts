import { DEFAULT_OFFER_PRICING, suggestItemOfferPrice, type ItemOfferSuggestion, type OfferPricingSettings } from "@repo/validators/marketplace-offers";

import type { Context } from "../../context.js";
import { offerPricingSettings } from "../marketplace-offers/pricing-settings.js";
import { DEAL_QUESTION_CLOSING, dealCategoriesInText } from "./categories.js";

type Db = Context["db"];

/**
 * Shared pieces for items the product-discovery bot found: their deal
 * category, current price evidence, the suggested deal (same price rule as every
 * offer: the vendor gets the bulk price, then Stripe's fee, then the Commons and
 * Cahootz split what's left), and the fixed question Sage can post about one. Kept apart from items.ts so the weekly demand check can use it without
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

/** An item with the suggested deal at the admin's current pricing settings. */
export type PricedItem = ItemSnapshot & {
  packSize: number;
  suggestedMemberPriceCents: number;
  suggestedVendorPayoutCents: number;
  packRegularPriceCents: number;
  /** Members needed when each buys one pack: the bot's group size, spread over the pack. */
  membersNeeded: number;
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

/** The suggested deal for one item's price evidence, or null when it can't save members anything. */
export function suggestionFor(
  observation: { regularPriceCents: number; bulkShareCents: number },
  pricing: OfferPricingSettings = DEFAULT_OFFER_PRICING,
): ItemOfferSuggestion | null {
  return suggestItemOfferPrice({ regularPriceCents: observation.regularPriceCents, bulkPriceCents: observation.bulkShareCents, pricing });
}

export const membersNeededFor = (peopleNeeded: number, packSize: number) => Math.max(2, Math.ceil(peopleNeeded / packSize));

/** "64 pods", or "6 × 64 pods" when the item is sold in packs. */
export const packLabel = (memberShare: string, packSize: number) => (packSize > 1 ? `${packSize} × ${memberShare}` : memberShare);

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

export function pricedItem(
  product: { id: string; name: string; supplierName: string },
  observation: Parameters<typeof itemSnapshot>[1],
  suggestion: ItemOfferSuggestion,
): PricedItem {
  return {
    ...itemSnapshot(product, observation),
    packSize: suggestion.packSize,
    suggestedMemberPriceCents: suggestion.memberPriceCents,
    suggestedVendorPayoutCents: suggestion.vendorPayoutCents,
    packRegularPriceCents: suggestion.regularPriceCents,
    membersNeeded: membersNeededFor(observation.peopleNeeded, suggestion.packSize),
  };
}

/**
 * The fixed question Sage posts about one approved item. The price is the
 * suggested member price (what members would really pay, card fee included),
 * worked out from the bot's newest evidence and labeled as an estimate, since
 * the seller we find sets the real price.
 */
export function itemQuestionText(item: PricedItem): { title: string; body: string } {
  return {
    title: `A group buy on ${item.name}?`,
    body: [
      `${item.name} (${packLabel(item.memberShare, item.packSize)}) runs about ${money(item.packRegularPriceCents)} on its own. If ${item.membersNeeded} of us buy together, it could come to about ${money(item.suggestedMemberPriceCents)} each. That's from prices we found online, so the final price depends on the seller.`,
      "Would you buy one?",
      DEAL_QUESTION_CLOSING,
    ].join("\n\n"),
  };
}

/**
 * Approved items for a Commons, best fit first, each with current price
 * evidence and a deal that saves members enough to be worth asking about.
 */
export async function approvedItemsForCommons(db: Db, coopId: string, now = new Date()) {
  const pricing = await offerPricingSettings(db);
  const matches = await db.commonsProductMatch.findMany({
    where: { status: "APPROVED", profile: { coopId, isEnabled: true }, product: { status: "VERIFIED" } },
    orderBy: [{ fitScore: "desc" }, { displayOrder: "asc" }],
    include: { product: { select: { id: true, name: true, supplierName: true, category: true, description: true } } },
    take: 20,
  });
  const items: Array<PricedItem & { categoryKey: string }> = [];
  for (const match of matches) {
    const observation = await currentObservation(db, match.productId, now);
    if (!observation) continue;
    const suggestion = suggestionFor(observation, pricing);
    // Card fees would eat most of the savings: not worth a question.
    if (!suggestion?.qualifies) continue;
    items.push({ ...pricedItem(match.product, observation, suggestion), categoryKey: dealCategoryForItem(match.product) });
  }
  return items;
}

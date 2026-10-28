import { z } from "zod";

export const offerTypes = ["MEMBER_DEAL", "GROUP_BUY"] as const;
export type OfferType = (typeof offerTypes)[number];

export const offerFulfillmentMethods = ["PICKUP", "DELIVERY"] as const;

export const offerStatuses = [
  "DRAFT",
  "PENDING_STEWARD",
  "LIVE",
  "PAUSED",
  "AWAITING_VENDOR",
  "PAYMENT_OPEN",
  "CONFIRMED",
  "ORDERED",
  "READY",
  "FULFILLED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
] as const;
export type OfferStatus = (typeof offerStatuses)[number];

/** Stripe's standard US card fee, used only for estimates before a payment. The real fee is recorded from Stripe. */
export const STRIPE_FEE_PERCENT_BPS = 290;
export const STRIPE_FEE_FIXED_CENTS = 30;
/** The most Stripe charges on a card payment (international cards add 1.5%). Offers must still pay both sides at this fee. */
export const STRIPE_WORST_FEE_PERCENT_BPS = 440;

/**
 * Pricing rules a platform admin can adjust (PlatformConfig "offers.*").
 * - minShareCents: the least the Commons and Cahootz each get per unit, even at the worst-case card fee.
 * - itemMarginBps: for a discovered item, the share of the discount kept for the Commons and Cahootz.
 * - itemMinOrderCents: cheap items are sold in packs so one payment is at least this much.
 * - itemMinSavingsBps / itemMinSavingsCents: an item only qualifies if members still save this much.
 */
export interface OfferPricingSettings {
  minShareCents: number;
  itemMarginBps: number;
  itemMinOrderCents: number;
  itemMinSavingsBps: number;
  itemMinSavingsCents: number;
}

export const DEFAULT_OFFER_PRICING: OfferPricingSettings = {
  minShareCents: 10,
  itemMarginBps: 2000,
  itemMinOrderCents: 1500,
  itemMinSavingsBps: 1500,
  itemMinSavingsCents: 100,
};

/** Bounds for each setting, so a typo can't make every deal lose money. */
export const OFFER_PRICING_LIMITS: Record<keyof OfferPricingSettings, { min: number; max: number }> = {
  minShareCents: { min: 1, max: 500 },
  itemMarginBps: { min: 500, max: 5000 },
  itemMinOrderCents: { min: 0, max: 10000 },
  itemMinSavingsBps: { min: 0, max: 5000 },
  itemMinSavingsCents: { min: 0, max: 2000 },
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

/**
 * What a platform admin enters for a new offer. Prices are whole cents.
 * Cross-field rules (member price below regular, Group Buy minimums, and that
 * the Commons and Cahootz each get at least the minimum even at the worst-case
 * card fee) live in the refinements so the web form and the server reject the
 * same input.
 */
export const makeOfferInputSchema = (pricing: Pick<OfferPricingSettings, "minShareCents"> = DEFAULT_OFFER_PRICING) => z
  .object({
    offerType: z.enum(offerTypes),
    productId: z.string().min(1),
    title: z.string().trim().min(3).max(120),
    description: optionalText(2000),
    regularPriceCents: z.number().int().positive(),
    regularPriceSource: z.string().trim().min(3).max(200),
    /** The discovered item (product-discovery bot) this offer came from, if any. */
    sourcedProductId: z.string().min(1).optional().nullable(),
    memberPriceCents: z.number().int().positive(),
    vendorPayoutCents: z.number().int().positive(),
    commonsSplitBps: z.number().int().min(0).max(10000).default(5000),
    minimumCommitments: z.number().int().positive().optional().nullable(),
    minimumPaidOrders: z.number().int().positive().optional().nullable(),
    maximumQuantity: z.number().int().positive().optional().nullable(),
    quantityPerMember: z.number().int().min(1).max(50).default(1),
    commitmentDeadline: z.coerce.date().optional().nullable(),
    paymentWindowHours: z.number().int().min(1).max(14 * 24).default(72),
    fulfillmentDate: z.coerce.date().optional().nullable(),
    fulfillmentMethod: z.enum(offerFulfillmentMethods).default("PICKUP"),
    pickupLocation: optionalText(300),
    serviceArea: optionalText(300),
    redemptionRules: optionalText(2000),
    refundPolicy: optionalText(2000),
    substitutionPolicy: optionalText(2000),
    terms: optionalText(4000),
    expiresAt: z.coerce.date().optional().nullable(),
  })
  .superRefine((offer, ctx) => {
    if (offer.memberPriceCents >= offer.regularPriceCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memberPriceCents"],
        message: "The member price has to be lower than the regular price.",
      });
    }
    if (offer.vendorPayoutCents > offer.memberPriceCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vendorPayoutCents"],
        message: "The vendor can't get more than members pay.",
      });
    } else {
      const margin = checkOfferMargin({ ...offer, minShareCents: pricing.minShareCents });
      if (!margin.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vendorPayoutCents"], message: margin.message });
      }
    }
    if (
      offer.maximumQuantity != null &&
      offer.quantityPerMember > offer.maximumQuantity
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantityPerMember"],
        message: "The limit per member can't be more than the total available.",
      });
    }
    if (offer.offerType === "MEMBER_DEAL") {
      if (!offer.expiresAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expiresAt"],
          message: "Pick the date this deal ends.",
        });
      }
      return;
    }
    if (!offer.minimumCommitments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumCommitments"],
        message: "Set how many units need to be committed.",
      });
    }
    if (!offer.minimumPaidOrders) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumPaidOrders"],
        message: "Set how many units need to be paid for.",
      });
    }
    if (
      offer.minimumCommitments &&
      offer.minimumPaidOrders &&
      offer.minimumPaidOrders > offer.minimumCommitments
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumPaidOrders"],
        message: "The paid minimum can't be more than the commitment minimum.",
      });
    }
    if (
      offer.minimumCommitments &&
      offer.maximumQuantity != null &&
      offer.minimumCommitments > offer.maximumQuantity
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumCommitments"],
        message: "The minimum can't be more than the total available.",
      });
    }
    if (!offer.commitmentDeadline) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commitmentDeadline"],
        message: "Pick the last day members can commit.",
      });
    }
  });
export const offerInputSchema = makeOfferInputSchema();
export type OfferInput = z.input<typeof offerInputSchema>;
export type ParsedOfferInput = z.output<typeof offerInputSchema>;

export const commitToOfferSchema = z.object({
  offerId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
  // The member has to tick "share my name and phone with the vendor".
  shareContact: z.literal(true),
  contactPhone: z.string().trim().max(40).optional(),
});

export interface OfferSavings {
  savingsCents: number;
  savingsPercent: number;
}

/**
 * The one place savings are worked out, so every screen shows the same number.
 * Percent is rounded down to a whole number so we never overstate a saving.
 */
export function offerSavings(
  regularPriceCents: number,
  memberPriceCents: number,
  quantity = 1,
): OfferSavings {
  const perUnit = Math.max(0, regularPriceCents - memberPriceCents);
  const savingsPercent =
    regularPriceCents > 0 ? Math.floor((perUnit * 100) / regularPriceCents) : 0;
  return { savingsCents: perUnit * quantity, savingsPercent };
}

const centsLabel = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Stripe's card fee on a charge, estimated (2.9% + 30¢). The recorded split always uses Stripe's real fee. */
export function estimateStripeFeeCents(chargedCents: number): number {
  if (chargedCents <= 0) return 0;
  return Math.round((chargedCents * STRIPE_FEE_PERCENT_BPS) / 10000) + STRIPE_FEE_FIXED_CENTS;
}

export interface OfferSplit {
  chargedCents: number;
  stripeFeeCents: number;
  vendorCents: number;
  /** What's left after Stripe and the vendor. Negative only if Stripe's fee was bigger than the margin. */
  remainderCents: number;
  commonsCents: number;
  cahootzCents: number;
}

/**
 * How one payment is split: Stripe's fee comes off first, the vendor gets their
 * fixed amount, and what's left is split between the Commons and Cahootz.
 * The Commons never goes negative; if Stripe's fee eats the whole margin,
 * Cahootz absorbs the shortfall.
 */
export function splitOfferPayment(params: {
  chargedCents: number;
  vendorCents: number;
  stripeFeeCents: number;
  commonsSplitBps: number;
}): OfferSplit {
  const remainderCents = params.chargedCents - params.stripeFeeCents - params.vendorCents;
  const commonsCents = remainderCents > 0 ? Math.floor((remainderCents * params.commonsSplitBps) / 10000) : 0;
  return {
    chargedCents: params.chargedCents,
    stripeFeeCents: params.stripeFeeCents,
    vendorCents: params.vendorCents,
    remainderCents,
    commonsCents,
    cahootzCents: remainderCents - commonsCents,
  };
}

/** Stripe's fee on a charge at the worst-case card rate (4.4% + 30¢). */
export function worstCaseStripeFeeCents(chargedCents: number): number {
  if (chargedCents <= 0) return 0;
  return Math.round((chargedCents * STRIPE_WORST_FEE_PERCENT_BPS) / 10000) + STRIPE_FEE_FIXED_CENTS;
}

function sharesAtWorst(memberPriceCents: number, vendorPayoutCents: number, commonsSplitBps: number) {
  return splitOfferPayment({
    chargedCents: memberPriceCents,
    vendorCents: vendorPayoutCents,
    stripeFeeCents: worstCaseStripeFeeCents(memberPriceCents),
    commonsSplitBps,
  });
}

export type OfferMarginCheck =
  | { ok: true; worst: OfferSplit }
  | { ok: false; worst: OfferSplit; message: string; minMemberPriceCents: number | null; maxVendorPayoutCents: number | null };

/**
 * No deal may cost the Commons or Cahootz money: at the worst-case card fee,
 * each still gets at least minShareCents per unit. When it fails, the message
 * says what to change: the lowest member price, or the most the vendor can get.
 */
export function checkOfferMargin(params: {
  memberPriceCents: number;
  vendorPayoutCents: number;
  commonsSplitBps: number;
  minShareCents: number;
}): OfferMarginCheck {
  const { memberPriceCents, vendorPayoutCents, commonsSplitBps, minShareCents } = params;
  const passes = (member: number, vendor: number) => {
    const split = sharesAtWorst(member, vendor, commonsSplitBps);
    return split.commonsCents >= minShareCents && split.cahootzCents >= minShareCents;
  };
  const worst = sharesAtWorst(memberPriceCents, vendorPayoutCents, commonsSplitBps);
  if (passes(memberPriceCents, vendorPayoutCents)) return { ok: true, worst };

  // A split that gives one side (almost) everything can't be fixed by price.
  const splitPossible = commonsSplitBps > 0 && commonsSplitBps < 10000;
  let minMemberPriceCents: number | null = null;
  let maxVendorPayoutCents: number | null = null;
  if (splitPossible) {
    for (let member = memberPriceCents + 1; member <= memberPriceCents + 100_000; member++) {
      if (passes(member, vendorPayoutCents)) { minMemberPriceCents = member; break; }
    }
    for (let vendor = vendorPayoutCents - 1; vendor >= 1; vendor--) {
      if (passes(memberPriceCents, vendor)) { maxVendorPayoutCents = vendor; break; }
    }
  }
  const low = [
    worst.commonsCents < minShareCents ? `the Commons ${centsLabel(Math.max(0, worst.commonsCents))}` : null,
    worst.cahootzCents < minShareCents ? `Cahootz ${centsLabel(Math.max(0, worst.cahootzCents))}` : null,
  ].filter(Boolean).join(" and ");
  const fixes = [
    minMemberPriceCents ? `raise the member price to at least ${centsLabel(minMemberPriceCents)}` : null,
    maxVendorPayoutCents ? `lower what the vendor gets to ${centsLabel(maxVendorPayoutCents)} or less` : null,
  ].filter(Boolean).join(", or ");
  const message = splitPossible
    ? `With a pricier card, Stripe could take up to ${centsLabel(worst.stripeFeeCents)}, leaving ${low}. Each side needs at least ${centsLabel(minShareCents)} per unit, so ${fixes || "lower what the vendor gets"}.`
    : `The Commons and Cahootz each need a share. Set the Commons share between 1% and 99%.`;
  return { ok: false, worst, message, minMemberPriceCents, maxVendorPayoutCents };
}

export interface ItemOfferSuggestion {
  /** How many of the item's member shares one member buys in one payment. */
  packSize: number;
  regularPriceCents: number;
  memberPriceCents: number;
  vendorPayoutCents: number;
  stripeFeeCents: number;
  commonsCents: number;
  cahootzCents: number;
  savingsCents: number;
  savingsPercent: number;
  /** False when card fees eat most of the savings; Sage won't ask about it and the admin sets the price. */
  qualifies: boolean;
}

/**
 * Suggested deal for an item the product discovery bot found. The vendor gets
 * the bot's bulk price; members pay that plus a share of the discount (default
 * 20%) and Stripe's fee. Cheap items are sold in packs so one payment is big
 * enough for the 30¢ card fee. The price is then raised, if needed, until the
 * Commons and Cahootz each get their minimum at the worst-case fee. Returns
 * null when members would pay as much as the regular price.
 */
export function suggestItemOfferPrice(params: {
  regularPriceCents: number;
  bulkPriceCents: number;
  pricing?: OfferPricingSettings;
  commonsSplitBps?: number;
}): ItemOfferSuggestion | null {
  const pricing = params.pricing ?? DEFAULT_OFFER_PRICING;
  const commonsSplitBps = params.commonsSplitBps ?? 5000;
  if (params.bulkPriceCents <= 0 || params.bulkPriceCents >= params.regularPriceCents) return null;
  const priceFor = (packSize: number) => {
    const regular = params.regularPriceCents * packSize;
    const vendor = params.bulkPriceCents * packSize;
    const margin = Math.round(((regular - vendor) * pricing.itemMarginBps) / 10000);
    // Gross up so Stripe's typical fee comes out of what members pay, not the margin.
    let member = Math.ceil((vendor + margin + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_PERCENT_BPS / 10000));
    while (!checkOfferMargin({ memberPriceCents: member, vendorPayoutCents: vendor, commonsSplitBps, minShareCents: pricing.minShareCents }).ok) member++;
    return { regular, vendor, member };
  };
  let packSize = 1;
  let price = priceFor(1);
  while (price.member < pricing.itemMinOrderCents && packSize < 12) {
    packSize++;
    price = priceFor(packSize);
  }
  if (price.member >= price.regular) return null;
  const split = splitOfferPayment({
    chargedCents: price.member,
    vendorCents: price.vendor,
    stripeFeeCents: estimateStripeFeeCents(price.member),
    commonsSplitBps,
  });
  const { savingsCents, savingsPercent } = offerSavings(price.regular, price.member);
  return {
    packSize,
    regularPriceCents: price.regular,
    memberPriceCents: price.member,
    vendorPayoutCents: price.vendor,
    stripeFeeCents: split.stripeFeeCents,
    commonsCents: split.commonsCents,
    cahootzCents: split.cahootzCents,
    savingsCents,
    savingsPercent,
    qualifies: savingsCents >= pricing.itemMinSavingsCents && savingsCents * 10000 >= pricing.itemMinSavingsBps * price.regular,
  };
}

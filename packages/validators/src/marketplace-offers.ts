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

// Fee shares are capped so a deal can never quietly eat the vendor's margin.
const MAX_OFFER_FEE_BPS = 2000;

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
 * Cross-field rules (member price below regular, Group Buy minimums) live in
 * the refinements so the web form and the server reject the same input.
 */
export const offerInputSchema = z
  .object({
    offerType: z.enum(offerTypes),
    productId: z.string().min(1),
    title: z.string().trim().min(3).max(120),
    description: optionalText(2000),
    regularPriceCents: z.number().int().positive(),
    regularPriceSource: z.string().trim().min(3).max(200),
    memberPriceCents: z.number().int().positive(),
    federationFeeBps: z.number().int().min(0).max(MAX_OFFER_FEE_BPS).default(0),
    commonsFeeBps: z.number().int().min(0).max(MAX_OFFER_FEE_BPS).default(0),
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
    if (offer.federationFeeBps + offer.commonsFeeBps > MAX_OFFER_FEE_BPS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commonsFeeBps"],
        message: "Federation and Commons shares together can't be more than 20%.",
      });
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

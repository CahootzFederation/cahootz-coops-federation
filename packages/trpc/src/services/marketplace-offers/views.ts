import { offerSavings } from "@repo/validators/marketplace-offers";

import type { Prisma } from "@repo/db";

type OfferRow = Prisma.MarketplaceOfferGetPayload<Record<string, never>>;

type OwnCommitment = {
  quantity: number;
  status: string;
  savingsCents: number;
  committedAt: Date;
  paidAt: Date | null;
  chargeError: string | null;
} | null;

/**
 * What a member sees: prices, savings already worked out, deadlines, terms and
 * their own commitment. Never other members' names or payments.
 */
export function memberOfferView(offer: OfferRow, myCommitment: OwnCommitment, now = new Date()) {
  const { savingsCents, savingsPercent } = offerSavings(offer.regularPriceCents, offer.memberPriceCents);
  return {
    id: offer.id,
    offerType: offer.offerType,
    status: offer.status,
    coopId: offer.coopId,
    title: offer.title,
    description: offer.description,
    vendor: { name: offer.vendorName },
    imageUrl: offer.imageUrl,
    regularPriceCents: offer.regularPriceCents,
    memberPriceCents: offer.memberPriceCents,
    savingsCents,
    savingsPercent,
    regularPriceSource: offer.regularPriceSource,
    quantityPerMember: offer.quantityPerMember,
    minimumCommitments: offer.minimumCommitments,
    committedQuantity: offer.committedQuantity,
    maximumQuantity: offer.maximumQuantity,
    spotsLeft: offer.maximumQuantity == null ? null : Math.max(0, offer.maximumQuantity - offer.committedQuantity),
    commitmentDeadline: offer.commitmentDeadline,
    paymentDeadline: offer.paymentDeadline,
    fulfillmentDate: offer.fulfillmentDate,
    expiresAt: offer.expiresAt,
    fulfillmentMethod: offer.fulfillmentMethod,
    pickupLocation: offer.pickupLocation,
    serviceArea: offer.serviceArea,
    redemptionRules: offer.redemptionRules,
    refundPolicy: offer.refundPolicy,
    substitutionPolicy: offer.substitutionPolicy,
    terms: offer.terms,
    canCommit:
      offer.offerType === "GROUP_BUY" &&
      offer.status === "LIVE" &&
      !!offer.commitmentDeadline &&
      offer.commitmentDeadline > now,
    canPay:
      offer.offerType === "GROUP_BUY" &&
      offer.status === "PAYMENT_OPEN" &&
      !!offer.paymentDeadline &&
      offer.paymentDeadline > now &&
      (myCommitment?.status === "COMMITTED" || myCommitment?.status === "PAYMENT_PENDING"),
    myCommitment: myCommitment
      ? {
          quantity: myCommitment.quantity,
          status: myCommitment.status,
          savingsCents: myCommitment.savingsCents,
          committedAt: myCommitment.committedAt,
          paidAt: myCommitment.paidAt,
          chargeError: myCommitment.chargeError,
          amountDueCents: offer.memberPriceCents * myCommitment.quantity,
        }
      : null,
  };
}

export type MemberOfferView = ReturnType<typeof memberOfferView>;



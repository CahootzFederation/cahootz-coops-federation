import { SC_REWARD_RATE } from '../constants/sc-rewards.js';

export interface CheckoutFeeConfig {
  platformMarkupBps: number;
  merchantFeeBps: number;
  treasuryFeeBps: number;
}

export interface CheckoutPriceBreakdown {
  listedAmount: number;
  chargedAmount: number;
  merchantSettlementAmount: number;
  platformMarkupAmount: number;
  treasuryFeeAmount: number;
  platformFeeAmount: number;
}

export interface CheckoutPricing {
  appliesTreasuryFee: boolean;
  feeConfig: CheckoutFeeConfig;
  breakdown: CheckoutPriceBreakdown;
  expectedScReward: number;
}

/**
 * Calculate the SC reward shown in checkout previews.
 *
 * Keep this in the shared checkout service so web and mobile display the same
 * reward estimate for the same listed item amount.
 */
export function calculateCheckoutScReward(listedAmountCents: number): number {
  return calculateCheckoutScRewardFromUsd(listedAmountCents / 100);
}

export function calculateCheckoutScRewardFromUsd(amountUSD: number): number {
  return Number((amountUSD * SC_REWARD_RATE).toFixed(6));
}

/**
 * Calculate price breakdown for a transaction.
 *
 * All input and output amounts are in cents.
 */
export function calculatePriceBreakdown(
  listedAmount: number,
  feeConfig: CheckoutFeeConfig
): CheckoutPriceBreakdown {
  const platformMarkup = Math.round((listedAmount * feeConfig.platformMarkupBps) / 10000);
  const chargedAmount = listedAmount + platformMarkup;
  const treasuryFee = Math.round((listedAmount * feeConfig.treasuryFeeBps) / 10000);
  const merchantFee = Math.round((listedAmount * feeConfig.merchantFeeBps) / 10000);
  const merchantSettlementAmount = listedAmount - treasuryFee - merchantFee;
  const platformFeeAmount = platformMarkup + treasuryFee + merchantFee;

  return {
    listedAmount,
    chargedAmount,
    merchantSettlementAmount,
    platformMarkupAmount: platformMarkup,
    treasuryFeeAmount: treasuryFee,
    platformFeeAmount,
  };
}

/**
 * Shared checkout math used by API previews and payment creation.
 */
export function calculateCheckoutPricing(params: {
  listedAmountCents: number;
  feeConfig: CheckoutFeeConfig;
  applyTreasuryFee: boolean;
}): CheckoutPricing {
  const { listedAmountCents, feeConfig, applyTreasuryFee } = params;
  const checkoutFeeConfig = applyTreasuryFee
    ? feeConfig
    : {
        ...feeConfig,
        treasuryFeeBps: 0,
      };

  return {
    appliesTreasuryFee: applyTreasuryFee,
    feeConfig: checkoutFeeConfig,
    breakdown: calculatePriceBreakdown(listedAmountCents, checkoutFeeConfig),
    expectedScReward: calculateCheckoutScReward(listedAmountCents),
  };
}

export interface OfferFeeShares {
  federationFeeBps: number;
  commonsFeeBps: number;
}

export interface OfferPriceBreakdown extends CheckoutPriceBreakdown {
  federationFeeAmount: number;
}

/**
 * Member Deal and Group Buy pricing. The member pays the member price and
 * nothing more: there is no checkout markup. The federation and Commons shares
 * come out of the vendor's proceeds, at the rates agreed on the offer.
 * Never reads FeeConfig, so its fallback can't add a markup to a deal.
 *
 * All amounts are in cents. `treasuryFeeAmount` is the Commons share, so the
 * existing ledger and refund code treat it the same as today's treasury fee.
 */
export function calculateOfferPricing(params: {
  memberUnitCents: number;
  quantity: number;
} & OfferFeeShares): OfferPriceBreakdown {
  const listedAmount = params.memberUnitCents * params.quantity;
  const federationFeeAmount = Math.round((listedAmount * params.federationFeeBps) / 10000);
  const commonsFeeAmount = Math.round((listedAmount * params.commonsFeeBps) / 10000);
  return {
    listedAmount,
    chargedAmount: listedAmount,
    merchantSettlementAmount: listedAmount - federationFeeAmount - commonsFeeAmount,
    platformMarkupAmount: 0,
    treasuryFeeAmount: commonsFeeAmount,
    federationFeeAmount,
    platformFeeAmount: federationFeeAmount + commonsFeeAmount,
  };
}

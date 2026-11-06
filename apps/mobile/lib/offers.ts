import type { MarketplaceOffer } from '@/lib/api';

/** Exact dollars and cents for prices and savings: members shouldn't do math. */
export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatOfferDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatOfferDateTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function offerTypeLabel(offer: Pick<MarketplaceOffer, 'offerType'>) {
  // Only Group Buys are offered now; an older Member Deal still reads plainly.
  return offer.offerType === 'GROUP_BUY' ? 'Group deal' : 'Deal';
}

/** One plain line on where an offer stands, from the member's side. */
export function offerStatusLine(offer: MarketplaceOffer) {
  const mine = offer.myCommitment;
  const service = offer.fulfillmentMethod === 'SERVICE';
  switch (offer.status) {
    case 'LIVE':
      return `${offer.committedQuantity} of ${offer.minimumCommitments} committed · deal ends ${formatOfferDate(offer.commitmentDeadline)}`;
    case 'AWAITING_VENDOR':
      return 'Goal met! Getting the order ready';
    case 'PAYMENT_OPEN':
      if (mine?.status === 'PAID') return service ? `You're paid. ${offer.vendor.name} will reach out to get you set up` : "You're paid. We'll tell you when it ships";
      if (mine?.chargeError) return `Your card didn't go through. Pay by ${formatOfferDateTime(offer.paymentDeadline)}`;
      return 'Goal met! Charging saved cards now';
    case 'CONFIRMED':
      return service ? `It's happening. ${offer.vendor.name} will reach out to get you set up` : "It's happening. We're sending the order to the vendor";
    case 'ORDERED':
      return service ? `${offer.vendor.name} is getting you set up` : 'Ordered. We’ll tell you when it ships';
    case 'READY':
      if (service) return "You're all set up";
      return offer.fulfillmentMethod === 'PICKUP' ? `Ready for pickup${offer.pickupLocation ? ` at ${offer.pickupLocation}` : ''}` : 'On its way to you';
    case 'FULFILLED':
      return 'All done';
    case 'EXPIRED':
      return "Didn't reach its goal. Nobody was charged";
    case 'FAILED':
      return 'Called off. Anyone who paid is being refunded';
    case 'CANCELLED':
      return 'Cancelled. Anyone who paid is being refunded';
    default:
      return '';
  }
}

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
  return offer.offerType === 'GROUP_BUY' ? 'Group buy' : 'Member deal';
}

/** One plain line on where an offer stands, from the member's side. */
export function offerStatusLine(offer: MarketplaceOffer) {
  const mine = offer.myCommitment;
  if (offer.offerType === 'MEMBER_DEAL') {
    if (mine?.status === 'PAID' || mine?.status === 'FULFILLED') return `You bought this and saved ${formatCents(mine.savingsCents)}`;
    if (offer.status === 'LIVE') return `Ends ${formatOfferDate(offer.expiresAt)}`;
    return offer.status === 'EXPIRED' ? 'This deal has ended' : 'Not available right now';
  }
  switch (offer.status) {
    case 'LIVE':
      return `${offer.committedQuantity} of ${offer.minimumCommitments} committed · closes ${formatOfferDate(offer.commitmentDeadline)}`;
    case 'AWAITING_VENDOR':
      return 'Goal met! Waiting for the vendor to confirm';
    case 'PAYMENT_OPEN':
      if (mine?.status === 'PAID') return "You're paid. We'll tell you when it's ready";
      return `Pay by ${formatOfferDateTime(offer.paymentDeadline)}`;
    case 'CONFIRMED':
      return 'Confirmed. The vendor is placing the order';
    case 'ORDERED':
      return 'Ordered. We’ll tell you when it’s ready';
    case 'READY':
      return offer.fulfillmentMethod === 'DELIVERY' ? 'Out for delivery' : `Ready for pickup${offer.pickupLocation ? ` at ${offer.pickupLocation}` : ''}`;
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

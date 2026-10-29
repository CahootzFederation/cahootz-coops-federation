/** Plain names for offer statuses in the admin portal. */
export const OFFER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_STEWARD: 'Not published',
  LIVE: 'Live',
  PAUSED: 'Paused',
  AWAITING_VENDOR: 'Waiting for vendor',
  PAYMENT_OPEN: 'Charging cards',
  CONFIRMED: 'Confirmed',
  ORDERED: 'Sent to vendor',
  READY: 'Shipped',
  FULFILLED: 'Finished',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  FAILED: 'Called off',
};

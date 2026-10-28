/**
 * Member Deals and Group Buys.
 *
 * Offers sit on top of the regular marketplace: each one points at an existing
 * product and every purchase is a normal CommerceTransaction, paid through the
 * same Stripe destination charge. What differs is the price (the member price,
 * no markup), the split (the vendor gets a set amount; after Stripe's fee the
 * rest is split between the Commons and Cahootz) and, for Group Buys, a
 * commit-then-pay flow where nobody is charged until enough members commit and
 * the vendor confirms. A platform admin publishes each offer, and every member
 * hears about live deals in a weekly notification.
 */
export * from "./checkout.js";
export * from "./commitments.js";
export * from "./digest.js";
export * from "./lifecycle.js";
export * from "./payments.js";
export * from "./pricing-settings.js";
export * from "./queries.js";
export * from "./sweep.js";
export { canTransition, OFFER_TRANSITIONS } from "./transitions.js";
export { memberOfferView } from "./views.js";

/**
 * Member Deals and Group Buys.
 *
 * Offers sit on top of the regular marketplace: each one points at an existing
 * product and every purchase is a normal CommerceTransaction, paid through the
 * same Stripe destination charge. What differs is the price (the member price,
 * no markup), the fee split (federation and Commons shares taken from vendor
 * proceeds) and, for Group Buys, a commit-then-pay flow where nobody is charged
 * until enough members commit and the vendor confirms.
 */
export * from "./checkout.js";
export * from "./commitments.js";
export * from "./lifecycle.js";
export * from "./payments.js";
export * from "./queries.js";
export * from "./sweep.js";
export { canTransition, OFFER_TRANSITIONS } from "./transitions.js";
export { memberOfferView } from "./views.js";

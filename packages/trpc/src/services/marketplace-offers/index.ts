/**
 * Group Buys: a lower price that happens only when enough households commit.
 *
 * Vendors never sign up. An offer names its vendor, and Cahootz collects every
 * payment in its own Stripe account, sends the vendor the order list (names and
 * delivery addresses) and pays them by hand. The member pays the member price
 * with no markup; after Stripe's fee and the vendor's amount, the rest is split
 * between the Commons and Cahootz. A Group Buy member saves a card and an
 * address when they commit, and the card is charged only once the goal is met.
 * A platform admin publishes each offer, and every member hears about live
 * deals in a weekly notification.
 */
export * from "./charges.js";
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

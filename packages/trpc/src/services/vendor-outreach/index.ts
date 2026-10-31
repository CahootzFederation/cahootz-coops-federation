/**
 * Vendor finding and outreach (docs/vendor-outreach-plan.md).
 *
 * 1. Sage notices what members want and asks the whole Commons; members
 *    recommend local businesses.
 * 2. Sage proposes a campaign from the public answers; a platform admin approves.
 * 3. Sage finds businesses (Cahootz shops, referrals, web search) and checks them.
 * 4. Sage emails them within the campaign's limits; vendors answer on a reply page.
 * 5. A "yes" goes to a platform admin, who closes the deal and creates the offer.
 */
export * from "./categories.js";
export * from "./demand.js";
export * from "./item-questions.js";
export * from "./items.js";
export * from "./referrals.js";
export * from "./admin.js";
export * from "./campaigns.js";
export * from "./outreach-check.js";
export * from "./pipeline.js";
export * from "./product-runs.js";
export * from "./responses.js";
export * from "./settings.js";
export * from "./sources.js";
// The sending side (outreach-sweep, discovery, draft, research-agent, verify,
// email-builder) loads the email client and AI agents, so it's imported
// directly by the API's jobs and fixtures, not through this web-safe index.

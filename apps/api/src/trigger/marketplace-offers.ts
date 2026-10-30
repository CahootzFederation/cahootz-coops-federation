import { logger, schedules } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { sendWeeklyDealsDigest } from "../../../../packages/trpc/src/services/marketplace-offers/digest.js";
import { ensureStarterDeals } from "../../../../packages/trpc/src/services/marketplace-offers/starter-deals.js";
import { runOfferSweep } from "../../../../packages/trpc/src/services/marketplace-offers/sweep.js";

// Member Deals and Group Buys: expires ended deals, closes Group Buy commitment
// periods and payment windows, sends payment reminders, retries failed refunds
// and frees abandoned deal checkouts. Rules: packages/trpc/src/services/marketplace-offers.
// Each step claims its change with a status-matched update and notices are
// claimed in OfferNotificationSend, so an overlapping or retried run is harmless.
// It also posts the Cahootz starter deals the first time it runs after a deploy.
export const marketplaceOfferSweep = schedules.task({
  id: "marketplace-offer-sweep",
  cron: "*/15 * * * *",
  maxDuration: 600,
  run: async () => {
    const starter = await ensureStarterDeals(db);
    if (starter.created > 0) logger.info("Posted Cahootz starter deals", starter);
    const summary = await runOfferSweep(db);
    logger.info("Marketplace offer sweep completed", { ...summary });
    return { ...summary, starterDealsPosted: starter.created };
  },
});

// Mondays, mid-morning Eastern: every active member of a Commons with live deals
// gets one notice listing them. Claimed per member and week in OfferDigestSend,
// so a retried run sends nothing twice.
export const offersWeeklyDigest = schedules.task({
  id: "offers-weekly-digest",
  cron: "0 15 * * 1",
  maxDuration: 600,
  run: async () => {
    const summary = await sendWeeklyDealsDigest(db);
    logger.info("Weekly deals notice sent", { ...summary });
    return summary;
  },
});

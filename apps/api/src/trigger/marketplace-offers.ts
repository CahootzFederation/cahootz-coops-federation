import { logger, schedules } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { runOfferSweep } from "../../../../packages/trpc/src/services/marketplace-offers/sweep.js";

// Member Deals and Group Buys: expires ended deals, closes Group Buy commitment
// periods and payment windows, sends payment reminders, retries failed refunds
// and frees abandoned deal checkouts. Rules: packages/trpc/src/services/marketplace-offers.
// Each step claims its change with a status-matched update and notices are
// claimed in OfferNotificationSend, so an overlapping or retried run is harmless.
export const marketplaceOfferSweep = schedules.task({
  id: "marketplace-offer-sweep",
  cron: "*/15 * * * *",
  maxDuration: 600,
  run: async () => {
    const summary = await runOfferSweep(db);
    logger.info("Marketplace offer sweep completed", { ...summary });
    return summary;
  },
});

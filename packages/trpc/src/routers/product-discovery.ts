import { publicProcedure } from "../procedures/index.js";
import { offerPricingSettings } from "../services/marketplace-offers/pricing-settings.js";
import { listHomepageProductCatalogs } from "../services/product-discovery.js";
import { router } from "../trpc.js";

export const productDiscoveryRouter = router({
  homepageCatalogs: publicProcedure.query(async () => {
    return listHomepageProductCatalogs();
  }),
  // The Group Buy pricing rules, so the public homepage shows the same split real offers use.
  homepagePricing: publicProcedure.query(({ ctx }) => offerPricingSettings(ctx.db)),
});

import { publicProcedure } from "../procedures/index.js";
import { listHomepageProductCatalogs } from "../services/product-discovery.js";
import { router } from "../trpc.js";

export const productDiscoveryRouter = router({
  homepageCatalogs: publicProcedure.query(async () => {
    return listHomepageProductCatalogs();
  }),
});

import { z } from "zod";

import { accountAuthenticatedProcedure } from "../procedures/account-authenticated.js";
import {
  dealCategoryOptions,
  listMyReferrals,
  recommendBusiness,
  recommendBusinessSchema,
} from "../services/vendor-outreach/referrals.js";
import { router } from "../trpc.js";

/** Members recommending local businesses for deals. Identity always comes from the session. */
export const vendorOutreachRouter = router({
  categories: accountAuthenticatedProcedure.query(() => dealCategoryOptions()),

  recommendBusiness: accountAuthenticatedProcedure
    .input(recommendBusinessSchema)
    .mutation(({ ctx, input }) => recommendBusiness(ctx.db, ctx.accountUser.id, input)),

  myReferrals: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).max(100) }))
    .query(({ ctx, input }) => listMyReferrals(ctx.db, ctx.accountUser.id, input.coopId)),
});

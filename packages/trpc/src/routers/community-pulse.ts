import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { accountAuthenticatedProcedure } from "../procedures/account-authenticated.js";
import { router } from "../trpc.js";
import { listCommunityPulse, PulseFeedbackInput, saveHumanAIFeedback } from "../services/community-pulse.js";

export const communityPulseRouter = router({
  list: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).max(100) }))
    .query(({ ctx, input }) => listCommunityPulse(ctx.db, input.coopId, ctx.accountUser.id)),
  saveFeedback: accountAuthenticatedProcedure
    .input(PulseFeedbackInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.$transaction((tx) => saveHumanAIFeedback(tx, ctx.accountUser.id, input));
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        // Do not attach a Prisma error that could include the member's explanation.
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Your response didn't save. Please try again." });
      }
    }),
});

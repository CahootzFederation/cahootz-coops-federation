import { z } from "zod";
import { router } from "../trpc.js";
import { publicProcedure } from "../procedures/index.js";
import { sendWaitlistWelcomeEmail } from "../services/email-service.js";

export const waitlistRouter = router({
  sendWelcomeEmail: publicProcedure
    .input(z.object({ email: z.string().email(), coopId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Name the commons they picked; older forms may send free text instead of an id.
      const commons = input.coopId
        ? await ctx.db.coopConfig.findFirst({
            where: { coopId: input.coopId, isActive: true },
            select: { name: true },
          })
        : null;
      await sendWaitlistWelcomeEmail(input.email, commons?.name);
      return { success: true };
    }),
});

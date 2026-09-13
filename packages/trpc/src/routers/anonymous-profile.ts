import { z } from "zod";

import { Context } from "../context.js";
import { publicProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";

const anonymousProfileInput = z.object({
  anonymousId: z.string().min(1),
  selfDescription: z.string().trim().min(40, "Write a few sentences so people know who you are.").max(5000),
  goals: z.string().trim().max(3000).optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  resourcesOffered: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  resourcesNeeded: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  businessSummary: z.string().trim().max(2000).optional(),
  locationSummary: z.string().trim().max(500).optional(),
});

export const anonymousProfileRouter = router({
  /**
   * Saves "who are you / goals" answers collected before the person has an
   * account, keyed by a device-generated id. Migrated onto their User row at
   * login time (see verifyLoginCode in routers/auth.ts).
   */
  upsert: publicProcedure
    .input(anonymousProfileInput)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { anonymousId, ...data } = input;

      await context.db.anonymousProfile.upsert({
        where: { anonymousId },
        create: { anonymousId, ...data },
        update: { ...data, migratedToUserId: null, migratedAt: null },
      });

      return { success: true };
    }),
});

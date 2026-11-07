import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { accountAuthenticatedProcedure } from '../procedures/index.js';
import {
  FEEDBACK_CATEGORIES,
  isFeedbackScreenshotUrl,
  MAX_FEEDBACK_SCREENSHOTS,
  sendFeedbackToSlack,
} from '../services/app-feedback.js';
import { router } from '../trpc.js';

// Enough for a frustrated afternoon, not enough to flood the Slack channel.
const MAX_REPORTS_PER_HOUR = 10;

export const feedbackRouter = router({
  /** A member reports a problem, complains, or shares an idea from the app. */
  submit: accountAuthenticatedProcedure
    .input(
      z.object({
        category: z.enum(FEEDBACK_CATEGORIES),
        message: z.string().trim().min(1, 'Tell us what happened.').max(5000),
        screenshotUrls: z
          .array(
            z.string().url().refine(isFeedbackScreenshotUrl, {
              message: 'Screenshots must be uploaded from the app.',
            }),
          )
          .max(MAX_FEEDBACK_SCREENSHOTS)
          .default([]),
        screen: z.string().trim().max(300).optional(),
        coopId: z.string().trim().max(120).optional(),
        platform: z.string().trim().max(40).optional(),
        appVersion: z.string().trim().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.accountUser;
      const recentCount = await ctx.db.appFeedback.count({
        where: {
          userId: user.id,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recentCount >= MAX_REPORTS_PER_HOUR) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: "You've sent a lot of feedback this hour. Please try again a little later.",
        });
      }

      const feedback = await ctx.db.appFeedback.create({
        data: {
          userId: user.id,
          category: input.category,
          message: input.message,
          screenshotUrls: input.screenshotUrls,
          screen: input.screen || null,
          coopId: input.coopId || null,
          platform: input.platform || null,
          appVersion: input.appVersion || null,
        },
        select: { id: true },
      });

      const sentToSlack = await sendFeedbackToSlack({
        feedbackId: feedback.id,
        category: input.category,
        message: input.message,
        screenshotUrls: input.screenshotUrls,
        reporter: { name: user.name, handle: user.handle, email: user.email },
        screen: input.screen,
        coopId: input.coopId,
        platform: input.platform,
        appVersion: input.appVersion,
      });
      if (sentToSlack) {
        await ctx.db.appFeedback.update({
          where: { id: feedback.id },
          data: { slackSentAt: new Date() },
        });
      }

      return { id: feedback.id };
    }),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Prisma } from "@repo/db";
import {
  defaultNotificationPreferences,
  notificationCategories,
  notificationCategoryTypes,
  notificationCursorSchema,
  notificationPreferencesSchema,
} from "@repo/validators/notification";

import type { AccountAuthenticatedContext } from "../context.js";
import { accountAuthenticatedProcedure } from "../procedures/account-authenticated.js";
import { router } from "../trpc.js";

export const notificationRouter = router({
  registerPushDevice: accountAuthenticatedProcedure
    .input(
      z.object({
        expoPushToken: z.string().min(10).max(300),
        platform: z.string().min(1).max(40),
        coopId: z.string().min(1).default("cahootz"),
        deviceName: z.string().max(120).nullable().optional(),
        appVersion: z.string().max(40).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;

      await context.db.pushDevice.upsert({
        where: { expoPushToken: input.expoPushToken },
        create: {
          userId: context.accountUser.id,
          coopId: input.coopId,
          expoPushToken: input.expoPushToken,
          platform: input.platform,
          deviceName: input.deviceName || null,
          appVersion: input.appVersion || null,
        },
        update: {
          userId: context.accountUser.id,
          coopId: input.coopId,
          platform: input.platform,
          deviceName: input.deviceName || null,
          appVersion: input.appVersion || null,
          enabled: true,
          lastRegisteredAt: new Date(),
        },
      });

      return { success: true };
    }),

  getPreferences: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const saved = await ctx.db.notificationPreference.findUnique({
      where: { userId: ctx.accountUser.id },
    });
    return notificationPreferencesSchema.parse(
      saved || defaultNotificationPreferences,
    );
  }),

  updatePreferences: accountAuthenticatedProcedure
    .input(notificationPreferencesSchema.partial().strict())
    .mutation(async ({ ctx, input }) => {
      const saved = await ctx.db.notificationPreference.upsert({
        where: { userId: ctx.accountUser.id },
        create: {
          userId: ctx.accountUser.id,
          ...defaultNotificationPreferences,
          ...input,
        },
        update: input,
      });
      return notificationPreferencesSchema.parse(saved);
    }),

  getNotifications: accountAuthenticatedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: notificationCursorSchema.optional(),
        unreadOnly: z.boolean().default(false),
        category: z.enum(notificationCategories).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.accountUser.id;
      const where: Prisma.NotificationWhereInput = { userId };
      if (input.unreadOnly) where.read = false;
      if (input.category === "other") {
        where.type = { notIn: Object.values(notificationCategoryTypes).flat() };
      } else if (input.category) {
        where.type = { in: notificationCategoryTypes[input.category] };
      }
      const pageWhere: Prisma.NotificationWhereInput = input.cursor
        ? {
            ...where,
            OR: [
              { createdAt: { lt: new Date(input.cursor.createdAt) } },
              {
                createdAt: new Date(input.cursor.createdAt),
                id: { lt: input.cursor.id },
              },
            ],
          }
        : where;
      const [rows, totalCount, unreadCount] = await Promise.all([
        ctx.db.notification.findMany({
          where: pageWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: input.limit + 1,
        }),
        ctx.db.notification.count({ where }),
        ctx.db.notification.count({ where: { userId, read: false } }),
      ]);
      const hasMore = rows.length > input.limit;
      const notifications = rows.slice(0, input.limit);
      const last = notifications.at(-1);
      return {
        notifications: notifications.map((n) => ({
          id: n.id,
          coopId: n.coopId,
          type: n.type,
          title: n.title,
          body: n.body,
          data: n.data as Record<string, unknown> | null,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
        })),
        nextCursor:
          hasMore && last
            ? { id: last.id, createdAt: last.createdAt.toISOString() }
            : null,
        totalCount,
        unreadCount,
      };
    }),

  getUnreadCount: accountAuthenticatedProcedure.query(async ({ ctx }) => ({
    count: await ctx.db.notification.count({
      where: { userId: ctx.accountUser.id, read: false },
    }),
  })),

  markAsRead: accountAuthenticatedProcedure
    .input(z.object({ notificationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.db.notification.updateMany({
        where: { id: input.notificationId, userId: ctx.accountUser.id },
        data: { read: true },
      });
      if (!result.count)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification not found",
        });
      return { success: true };
    }),

  markAllAsRead: accountAuthenticatedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.db.notification.updateMany({
      where: { userId: ctx.accountUser.id, read: false },
      data: { read: true },
    });
    return { success: true, count: result.count };
  }),
});

// Compatibility routes also require a verified session. A supplied userId never selects the account.
export const legacyNotificationProcedures = {
  getNotifications: accountAuthenticatedProcedure
    .input(
      z.object({
        userId: z.string(),
        unreadOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.userId !== ctx.accountUser.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot access another account's alerts",
        });
      const page = await notificationRouter
        .createCaller(ctx)
        .getNotifications({ limit: input.limit, unreadOnly: input.unreadOnly });
      return {
        notifications: page.notifications,
        unreadCount: page.unreadCount,
      };
    }),
  markNotificationRead: accountAuthenticatedProcedure
    .input(z.object({ notificationId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      notificationRouter.createCaller(ctx).markAsRead(input),
    ),
  markAllNotificationsRead: accountAuthenticatedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(({ ctx, input }) => {
      if (input.userId !== ctx.accountUser.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot update another account's alerts",
        });
      return notificationRouter.createCaller(ctx).markAllAsRead();
    }),
};

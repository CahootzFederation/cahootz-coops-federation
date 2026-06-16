import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, privateProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";

const BUILT_IN_APPS = [
  {
    key: "marketplace",
    name: "Marketplace",
    description: "Stores, products, carts, and checkout for coop commerce.",
    iconName: "Store",
    publicPath: "products",
    mobilePath: "stores",
    sortOrder: 0,
    locked: true,
  },
  {
    key: "directory",
    name: "Directory",
    description: "A local business directory managed by coop admins.",
    iconName: "MapPin",
    publicPath: "directory",
    mobilePath: "directory",
    sortOrder: 1,
    locked: false,
  },
] as const;

type BuiltInAppKey = (typeof BUILT_IN_APPS)[number]["key"];

const APP_DEFAULTS = new Map(
  BUILT_IN_APPS.map((app) => [
    app.key,
    {
      publicEnabled: true,
      memberEnabled: true,
      portalEnabled: true,
      sortOrder: app.sortOrder,
    },
  ]),
);

function normalizeSetting(appKey: string, setting?: {
  publicEnabled: boolean;
  memberEnabled: boolean;
  portalEnabled: boolean;
  sortOrder: number;
}) {
  const defaults = APP_DEFAULTS.get(appKey as BuiltInAppKey) ?? {
    publicEnabled: true,
    memberEnabled: true,
    portalEnabled: true,
    sortOrder: 99,
  };

  return {
    publicEnabled: setting?.publicEnabled ?? defaults.publicEnabled,
    memberEnabled: setting?.memberEnabled ?? defaults.memberEnabled,
    portalEnabled: setting?.portalEnabled ?? defaults.portalEnabled,
    sortOrder: setting?.sortOrder ?? defaults.sortOrder,
  };
}

async function ensureDefaultSettings(ctx: any, coopId: string) {
  await Promise.all(
    BUILT_IN_APPS.map((app) => {
      const defaults = normalizeSetting(app.key);
      return ctx.db.coopAppSetting.upsert({
        where: {
          coopId_appKey: {
            coopId,
            appKey: app.key,
          },
        },
        create: {
          coopId,
          appKey: app.key,
          ...defaults,
        },
        update: {},
      });
    }),
  );
}

async function getAppsForCoop(ctx: any, coopId: string) {
  const settings = await ctx.db.coopAppSetting.findMany({
    where: {
      coopId,
      appKey: {
        in: BUILT_IN_APPS.map((app) => app.key),
      },
    },
  });
  const settingsByKey = new Map<string, {
    publicEnabled: boolean;
    memberEnabled: boolean;
    portalEnabled: boolean;
    sortOrder: number;
  }>(settings.map((setting: any) => [setting.appKey, setting]));

  return BUILT_IN_APPS.map((app) => {
    const state = normalizeSetting(app.key, settingsByKey.get(app.key));
    return {
      ...app,
      ...state,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function isCoopAppEnabled(
  ctx: any,
  coopId: string,
  appKey: BuiltInAppKey,
  surface: "public" | "member" | "portal",
) {
  const setting = await ctx.db.coopAppSetting.findUnique({
    where: {
      coopId_appKey: {
        coopId,
        appKey,
      },
    },
  });
  const normalized = normalizeSetting(appKey, setting ?? undefined);

  if (surface === "public") return normalized.publicEnabled;
  if (surface === "member") return normalized.memberEnabled;
  return normalized.portalEnabled;
}

export const coopAppsRouter = router({
  listPublic: publicProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const apps = await getAppsForCoop(ctx, input.coopId);
      return apps.filter((app) => app.publicEnabled);
    }),

  listMember: publicProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const apps = await getAppsForCoop(ctx, input.coopId);
      return apps.filter((app) => app.memberEnabled);
    }),

  listForAdmin: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot manage apps for a different coop",
        });
      }

      await ensureDefaultSettings(ctx, input.coopId);
      const apps = await getAppsForCoop(ctx, input.coopId);
      const requests = await ctx.db.coopAppRequest.findMany({
        where: {
          coopId: input.coopId,
          status: {
            not: "ARCHIVED",
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return { apps, requests };
    }),

  updateSetting: privateProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        appKey: z.enum(["marketplace", "directory"]),
        publicEnabled: z.boolean().optional(),
        memberEnabled: z.boolean().optional(),
        portalEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot manage apps for a different coop",
        });
      }

      if (input.appKey === "marketplace") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Marketplace is always enabled in v1",
        });
      }

      const currentDefaults = normalizeSetting(input.appKey);
      const setting = await ctx.db.coopAppSetting.upsert({
        where: {
          coopId_appKey: {
            coopId: input.coopId,
            appKey: input.appKey,
          },
        },
        create: {
          coopId: input.coopId,
          appKey: input.appKey,
          publicEnabled: input.publicEnabled ?? currentDefaults.publicEnabled,
          memberEnabled: input.memberEnabled ?? currentDefaults.memberEnabled,
          portalEnabled: input.portalEnabled ?? currentDefaults.portalEnabled,
          sortOrder: currentDefaults.sortOrder,
        },
        update: {
          ...(input.publicEnabled !== undefined ? { publicEnabled: input.publicEnabled } : {}),
          ...(input.memberEnabled !== undefined ? { memberEnabled: input.memberEnabled } : {}),
          ...(input.portalEnabled !== undefined ? { portalEnabled: input.portalEnabled } : {}),
        },
      });

      return setting;
    }),

  createRequest: privateProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        title: z.string().min(2).max(120),
        description: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.coopId && ctx.coopId !== input.coopId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot submit app requests for a different coop",
        });
      }

      return ctx.db.coopAppRequest.create({
        data: {
          coopId: input.coopId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          requestedBy: ctx.walletAddress,
        },
      });
    }),
});

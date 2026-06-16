import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, privateProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { isCoopAppEnabled } from "./coop-apps.js";

const directoryBusinessInput = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(80).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  address: z.string().max(240).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(80).optional().nullable(),
  zipCode: z.string().max(20).optional().nullable(),
  formattedAddress: z.string().max(500).optional().nullable(),
  placeId: z.string().max(240).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  website: z.string().max(240).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

function normalizeWebsite(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function cleanBusinessData(data: z.infer<typeof directoryBusinessInput>) {
  return {
    name: data.name.trim(),
    category: data.category?.trim() || null,
    description: data.description?.trim() || null,
    imageUrl: data.imageUrl || null,
    address: data.address?.trim() || null,
    city: data.city?.trim() || null,
    state: data.state?.trim() || null,
    zipCode: data.zipCode?.trim() || null,
    formattedAddress: data.formattedAddress?.trim() || null,
    placeId: data.placeId?.trim() || null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    website: normalizeWebsite(data.website),
    tags: data.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
    isFeatured: data.isFeatured ?? false,
    isActive: data.isActive ?? true,
    sortOrder: data.sortOrder ?? 0,
  };
}

function assertSameCoop(ctx: any, coopId: string) {
  if (ctx.coopId && ctx.coopId !== coopId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cannot manage directory entries for a different coop",
    });
  }
}

export const directoryRouter = router({
  listPublic: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        category: z.string().optional(),
        search: z.string().optional(),
        featured: z.boolean().optional(),
        limit: z.number().min(1).max(100).optional().default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const enabled = await isCoopAppEnabled(ctx, input.coopId, "directory", "public");
      if (!enabled) {
        return { businesses: [] };
      }

      const where: any = {
        coopId: input.coopId,
        isActive: true,
      };

      if (input.category) where.category = input.category;
      if (input.featured !== undefined) where.isFeatured = input.featured;
      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { description: { contains: input.search, mode: "insensitive" } },
          { category: { contains: input.search, mode: "insensitive" } },
          { tags: { has: input.search } },
        ];
      }

      const businesses = await ctx.db.directoryBusiness.findMany({
        where,
        take: input.limit,
        orderBy: [
          { isFeatured: "desc" },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
      });

      return { businesses };
    }),

  listMember: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        category: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).optional().default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const enabled = await isCoopAppEnabled(ctx, input.coopId, "directory", "member");
      if (!enabled) {
        return { businesses: [] };
      }

      const where: any = {
        coopId: input.coopId,
        isActive: true,
      };

      if (input.category) where.category = input.category;
      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { description: { contains: input.search, mode: "insensitive" } },
          { category: { contains: input.search, mode: "insensitive" } },
          { tags: { has: input.search } },
        ];
      }

      const businesses = await ctx.db.directoryBusiness.findMany({
        where,
        take: input.limit,
        orderBy: [
          { isFeatured: "desc" },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
      });

      return { businesses };
    }),

  listAdmin: privateProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      assertSameCoop(ctx, input.coopId);

      const businesses = await ctx.db.directoryBusiness.findMany({
        where: { coopId: input.coopId },
        orderBy: [
          { isActive: "desc" },
          { isFeatured: "desc" },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
      });

      return { businesses };
    }),

  create: privateProcedure
    .input(z.object({ coopId: z.string().min(1), data: directoryBusinessInput }))
    .mutation(async ({ input, ctx }) => {
      assertSameCoop(ctx, input.coopId);

      return ctx.db.directoryBusiness.create({
        data: {
          coopId: input.coopId,
          ...cleanBusinessData(input.data),
          createdBy: ctx.walletAddress,
          updatedBy: ctx.walletAddress,
        },
      });
    }),

  update: privateProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        id: z.string().min(1),
        data: directoryBusinessInput.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertSameCoop(ctx, input.coopId);

      const existing = await ctx.db.directoryBusiness.findFirst({
        where: {
          id: input.id,
          coopId: input.coopId,
        },
        select: { id: true },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Directory business not found",
        });
      }

      const updateData: any = {};
      for (const [key, value] of Object.entries(input.data)) {
        if (value === undefined) continue;
        if (key === "tags" && Array.isArray(value)) {
          updateData.tags = value.map((tag) => tag.trim()).filter(Boolean);
        } else if (key === "website" && typeof value === "string") {
          updateData.website = normalizeWebsite(value);
        } else if (typeof value === "string") {
          updateData[key] = value.trim() || null;
        } else {
          updateData[key] = value;
        }
      }

      return ctx.db.directoryBusiness.update({
        where: { id: input.id },
        data: {
          ...updateData,
          updatedBy: ctx.walletAddress,
        },
      });
    }),

  delete: privateProcedure
    .input(z.object({ coopId: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      assertSameCoop(ctx, input.coopId);

      const existing = await ctx.db.directoryBusiness.findFirst({
        where: {
          id: input.id,
          coopId: input.coopId,
        },
        select: { id: true },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Directory business not found",
        });
      }

      await ctx.db.directoryBusiness.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});

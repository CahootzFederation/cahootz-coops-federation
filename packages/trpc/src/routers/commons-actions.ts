import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { accountAuthenticatedProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { requireActiveCommonsMembership } from "./commons.js";
import { getMembership, isStewardMembership, notifyStewards, requireSteward } from "../services/commons-membership.js";
import { publishCommonsResource, resourceAutoListEnabled } from "../services/commons-resources.js";

const RESOURCE_FIELDS = { id: true, coopId: true, kind: true, title: true, description: true, sourceType: true, sourceId: true, invitedAt: true } as const;

export const commonsActionsRouter = router({
  listResources: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      await requireActiveCommonsMembership(ctx.db, ctx.accountUser.id, input.coopId);
      return ctx.db.commonsResource.findMany({ where: { coopId: input.coopId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" }, take: input.limit,
        select: { id: true, kind: true, title: true, description: true, sourceType: true, sourceId: true, candidateUserId: true, publishedAt: true } });
    }),
  myResourceInvitations: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const invitations = await ctx.db.commonsResource.findMany({
      where: { candidateUserId: ctx.accountUser.id, status: "INVITED" },
      orderBy: { invitedAt: "desc" }, take: 50, select: RESOURCE_FIELDS,
    });
    const configs = invitations.length ? await ctx.db.coopConfig.findMany({
      where: { coopId: { in: [...new Set(invitations.map((item) => item.coopId))] }, isActive: true },
      select: { coopId: true, name: true },
    }) : [];
    const names = new Map(configs.map((config) => [config.coopId, config.name]));
    return invitations.map((item) => ({ ...item, coopName: names.get(item.coopId) || item.coopId }));
  }),

  respondToResourceInvitation: accountAuthenticatedProcedure
    .input(z.object({ resourceId: z.string().min(1), accept: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const resource = await ctx.db.commonsResource.findFirst({ where: { id: input.resourceId, candidateUserId: ctx.accountUser.id, status: "INVITED" } });
      if (!resource) throw new TRPCError({ code: "NOT_FOUND", message: "Invitation is no longer available." });
      if (input.accept) await requireActiveCommonsMembership(ctx.db, ctx.accountUser.id, resource.coopId);
      const result = await ctx.db.commonsResource.updateMany({
        where: { id: resource.id, candidateUserId: ctx.accountUser.id, status: "INVITED" },
        data: { status: input.accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND", message: "Invitation is no longer available." });
      if (!input.accept) return { accepted: false, listed: false };
      const accepted = { ...resource, status: "ACCEPTED" };
      if (await resourceAutoListEnabled(ctx.db, resource.coopId)) {
        // If it can't be listed automatically (say, a listing with the same title exists), a steward decides.
        const listed = await publishCommonsResource(ctx.db, accepted, `auto-list:${ctx.accountUser.id}`).then(() => true, (error) => {
          console.error("Could not auto-list an accepted resource", error);
          return false;
        });
        if (listed) return { accepted: true, listed: true };
      }
      await notifyStewards(ctx.db, resource.coopId, {
        type: "RESOURCE_REVIEW", title: "A member's offer is waiting for review",
        body: resource.title, data: { resourceId: resource.id },
      }, ctx.accountUser.id);
      return { accepted: true, listed: false };
    }),

  /** The Commons' listing rule, and whether the viewer may change it and review listings. */
  resourceSettings: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireActiveCommonsMembership(ctx.db, ctx.accountUser.id, input.coopId);
      const isSteward = isStewardMembership(await getMembership(ctx.db, ctx.accountUser.id, input.coopId));
      return { autoListResources: await resourceAutoListEnabled(ctx.db, input.coopId), isSteward };
    }),

  setResourceAutoList: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireSteward(ctx.db, ctx.accountUser.id, input.coopId);
      await ctx.db.commonsAgentSetting.upsert({
        where: { coopId: input.coopId },
        create: { coopId: input.coopId, autoListResources: input.enabled, updatedBy: ctx.accountUser.id },
        update: { autoListResources: input.enabled, updatedBy: ctx.accountUser.id },
      });
      return { autoListResources: input.enabled };
    }),

  resourcesAwaitingReview: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireSteward(ctx.db, ctx.accountUser.id, input.coopId);
      return ctx.db.commonsResource.findMany({
        where: { coopId: input.coopId, status: "ACCEPTED", candidateUserId: { not: null } },
        orderBy: { respondedAt: "asc" }, take: 50, select: { ...RESOURCE_FIELDS, respondedAt: true },
      });
    }),

  reviewResource: accountAuthenticatedProcedure
    .input(z.object({ resourceId: z.string().min(1), publish: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const resource = await ctx.db.commonsResource.findFirst({ where: { id: input.resourceId, status: "ACCEPTED" } });
      if (!resource) throw new TRPCError({ code: "NOT_FOUND", message: "This listing is no longer waiting for review." });
      await requireSteward(ctx.db, ctx.accountUser.id, resource.coopId);
      if (input.publish) {
        await publishCommonsResource(ctx.db, resource, `steward:${ctx.accountUser.id}`);
        return { listed: true };
      }
      await ctx.db.commonsResource.update({ where: { id: resource.id }, data: { status: "NOT_LISTED", verifiedBy: `steward:${ctx.accountUser.id}`, verifiedAt: new Date() } });
      return { listed: false };
    }),

  myProposalDrafts: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    return ctx.db.commonsProposalDraft.findMany({ where: { authorId: ctx.accountUser.id, submittedAt: null }, orderBy: { createdAt: "desc" }, take: 50 });
  }),

  updateMyProposalDraft: accountAuthenticatedProcedure
    .input(z.object({ draftId: z.string().min(1), title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.commonsProposalDraft.updateMany({
        where: { id: input.draftId, authorId: ctx.accountUser.id, submittedAt: null },
        data: { title: input.title, body: input.body },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
      return { saved: true };
    }),
  markProposalDraftSubmitted: accountAuthenticatedProcedure
    .input(z.object({ draftId: z.string().min(1), proposalId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.commonsProposalDraft.updateMany({
        where: { id: input.draftId, authorId: ctx.accountUser.id, submittedAt: null },
        data: { submittedAt: new Date(), submittedProposalId: input.proposalId },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND", message: "Draft is no longer available." });
      return { submitted: true };
    }),
});

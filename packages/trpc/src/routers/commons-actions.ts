import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { accountAuthenticatedProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { requireActiveCommonsMembership } from "./commons.js";

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
    return ctx.db.commonsResource.findMany({
      where: { candidateUserId: ctx.accountUser.id, status: "INVITED" },
      orderBy: { invitedAt: "desc" }, take: 50,
      select: { id: true, coopId: true, kind: true, title: true, description: true, sourceType: true, sourceId: true, invitedAt: true },
    });
  }),

  respondToResourceInvitation: accountAuthenticatedProcedure
    .input(z.object({ resourceId: z.string().min(1), accept: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.commonsResource.updateMany({
        where: { id: input.resourceId, candidateUserId: ctx.accountUser.id, status: "INVITED" },
        data: { status: input.accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND", message: "Invitation is no longer available." });
      return { accepted: input.accept };
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

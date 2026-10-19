import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { accountAuthenticatedProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { requireActiveCommonsMembership } from "./commons.js";
import { getMembership, isStewardMembership } from "../services/commons-membership.js";
import {
  applyVotedAmendment, claimProposalIdea, pendingVotedAmendments, proposalIdeaForPost,
} from "../services/sage-goal-ideas.js";
import { GOAL_SIGNAL_KEYS, GOAL_SIGNALS, displayGoalSignalMap, setGoalSignals } from "../services/sage-goal-signals.js";

async function requireSteward(db: any, userId: string, coopId: string) {
  const membership = await getMembership(db, userId, coopId);
  if (!isStewardMembership(membership)) throw new TRPCError({ code: "FORBIDDEN", message: "Only a steward of this Commons can do that." });
}

async function activeConfig(db: any, coopId: string) {
  return db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { id: true, version: true, missionGoals: true } });
}

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
      if (!result.count) {
        // Sending a Sage idea already marks it sent; that's fine.
        const already = await ctx.db.commonsProposalDraft.findFirst({ where: { id: input.draftId, authorId: ctx.accountUser.id, submittedProposalId: input.proposalId }, select: { id: true } });
        if (!already) throw new TRPCError({ code: "NOT_FOUND", message: "Draft is no longer available." });
      }
      return { submitted: true };
    }),

  /** The proposal idea behind one of Sage's idea posts, and who has taken it on. */
  proposalIdeaForPost: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const idea = await proposalIdeaForPost(input.postId, ctx.accountUser.id);
      if (!idea) return null;
      await requireActiveCommonsMembership(ctx.db, ctx.accountUser.id, idea.coopId);
      return idea;
    }),

  /** The first member to tap "Take this on" becomes the idea's author. */
  claimProposalIdea: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const idea = await proposalIdeaForPost(input.postId, ctx.accountUser.id);
      if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "That idea isn't available anymore." });
      await requireActiveCommonsMembership(ctx.db, ctx.accountUser.id, idea.coopId);
      const result = await claimProposalIdea(input.postId, ctx.accountUser.id);
      if (!result.claimed) {
        throw new TRPCError({ code: "CONFLICT", message: result.reason === "TAKEN" ? "Someone already took this one on. Check the post to see who." : "That idea isn't available anymore." });
      }
      return { draftId: result.draftId, coopId: result.coopId };
    }),

  /** What Sage counts for each charter goal, and the list a steward can choose from. */
  goalSignals: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireActiveCommonsMembership(ctx.db, ctx.accountUser.id, input.coopId);
      const [config, membership] = await Promise.all([activeConfig(ctx.db, input.coopId), getMembership(ctx.db, ctx.accountUser.id, input.coopId)]);
      const current = config ? await displayGoalSignalMap(input.coopId, config) : null;
      return {
        canEdit: isStewardMembership(membership),
        catalog: GOAL_SIGNAL_KEYS.map((key) => ({ key, label: GOAL_SIGNALS[key].label, measures: GOAL_SIGNALS[key].measures })),
        goals: current ? current.goals.map((goal) => ({
          key: goal.key, label: goal.label, chosenBy: goal.source === "steward" ? "steward" as const : "sage" as const,
          signals: goal.signals.map((key) => ({ key, label: GOAL_SIGNALS[key].label })),
        })) : null,
      };
    }),

  setGoalSignals: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1), goalKey: z.string().min(1), signals: z.array(z.enum(GOAL_SIGNAL_KEYS)).max(3) }))
    .mutation(async ({ ctx, input }) => {
      await requireSteward(ctx.db, ctx.accountUser.id, input.coopId);
      const config = await activeConfig(ctx.db, input.coopId);
      if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "This Commons doesn't have a charter yet." });
      const result = await setGoalSignals(input.coopId, config, input.goalKey, input.signals, ctx.accountUser.id);
      if (!result.updated) throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      return { saved: true };
    }),

  /** Charter and goals changes members voted through that wait for a steward. */
  pendingVotedAmendments: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const membership = await getMembership(ctx.db, ctx.accountUser.id, input.coopId);
      if (!isStewardMembership(membership)) return [];
      return pendingVotedAmendments(input.coopId);
    }),

  applyVotedAmendment: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1), amendmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireSteward(ctx.db, ctx.accountUser.id, input.coopId);
      const result = await applyVotedAmendment(input.coopId, input.amendmentId, ctx.accountUser.id);
      if (!result.applied) throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      return { version: result.version };
    }),
});

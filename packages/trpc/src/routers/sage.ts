import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { AccountAuthenticatedContext } from "../context.js";
import { accountAuthenticatedProcedure } from "../procedures/account-authenticated.js";
import { payloadHash } from "../services/sage-ride-match-agent.js";
import { findRideMatchCandidate } from "../services/sage-ride-matcher.js";
import { enqueueSageActionExecute } from "../services/sage-dispatch.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";
import { router } from "../trpc.js";

const TERMINAL_STATUSES = ["APPROVED", "DISMISSED", "FAILED"] as const;
const TabZ = z.enum(["NEEDS_YOU", "WAITING", "DONE"]);

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

// Server-side only, so raw eventType/metadata (e.g. a missing tool key) never reaches the client.
function describeAuditEvent(eventType: string, metadata: unknown): string {
  const reviewType = metadata && typeof metadata === "object" ? (metadata as { reviewType?: string }).reviewType : undefined;
  switch (eventType) {
    case "SUGGESTION_CREATED": return "Sage made a suggestion";
    case "REVIEW_APPROVED":
      if (reviewType === "PROVIDE_CONTEXT") return "Details were confirmed";
      if (reviewType === "CONSENT_TO_SHARE") return "Sharing was approved";
      if (reviewType === "ACCEPT_MATCH") return "The match was accepted";
      if (reviewType === "APPROVE_SUGGESTION") return "The suggestion was approved";
      return "A step was approved";
    case "REVIEW_DECLINED": return "The suggestion was declined";
    case "ESCALATED_TO_ADMIN": return "Sent to an admin to look at";
    case "ACTION_EXECUTED": return "Sage completed the suggestion";
    case "ACTION_FAILED": return "Sage couldn't complete this";
    case "MISSING_TOOL": return "Sage couldn't complete this";
    default: return "Update";
  }
}

export const sageRouter = router({
  // Called when the member opens the Sage suggestions list, so the Alerts tab's
  // unread dot clears without requiring them to separately open each notification.
  markSeen: accountAuthenticatedProcedure.mutation(async ({ ctx }) => {
    const context = ctx as AccountAuthenticatedContext;
    const result = await context.db.notification.updateMany({
      where: { userId: context.accountUser.id, read: false, type: { startsWith: "SAGE_SUGGESTION_" } },
      data: { read: true },
    });
    return { success: true, count: result.count };
  }),

  list: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).default("cahootz"), tab: TabZ, cursor: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const base = { coopId: input.coopId, participants: { some: { userId } } };
      const where = input.tab === "NEEDS_YOU"
        ? { ...base, reviews: { some: { userId, status: "PENDING" } } }
        : input.tab === "DONE"
          ? { ...base, status: { in: [...TERMINAL_STATUSES] } }
          : { ...base, status: { notIn: [...TERMINAL_STATUSES] }, NOT: { reviews: { some: { userId, status: "PENDING" } } } };

      const actions = await context.db.commonsAction.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const nextCursor = actions.length > 20 ? actions[20]!.id : null;
      const page = actions.slice(0, 20);

      return {
        suggestions: page.map((action) => ({
          id: action.id, title: action.summary, circleId: action.circleId,
          status: action.status, createdAt: action.createdAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  getDetail: accountAuthenticatedProcedure
    .input(z.object({ actionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const action = await context.db.commonsAction.findUnique({ where: { id: input.actionId } });
      if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion not found" });
      const participant = await context.db.commonsActionParticipant.findUnique({
        where: { actionId_userId: { actionId: action.id, userId } },
      });
      if (!participant) throw new TRPCError({ code: "FORBIDDEN", message: "Not part of this suggestion" });

      const [myReviews, auditEvents] = await Promise.all([
        context.db.commonsActionReview.findMany({ where: { actionId: action.id, userId }, orderBy: { createdAt: "asc" } }),
        context.db.commonsActionAudit.findMany({ where: { actionId: action.id }, orderBy: { createdAt: "asc" }, select: { eventType: true, metadata: true, createdAt: true } }),
      ]);

      return {
        suggestion: {
          id: action.id, title: action.summary, status: action.status, circleId: action.circleId,
          // The subject's own raw message excerpt is only shown to the subject, never to a helper/candidate.
          evidence: participant.role === "SUBJECT" ? action.sourceTextSnapshot : null,
          role: participant.role,
        },
        reviews: myReviews.map((review) => ({
          id: review.id, reviewType: review.reviewType, status: review.status,
          presentationData: review.presentationData, payloadHash: review.payloadHash,
        })),
        auditEvents: auditEvents.map((event) => ({
          description: describeAuditEvent(event.eventType, event.metadata),
          createdAt: event.createdAt.toISOString(),
        })),
      };
    }),

  respondToReview: accountAuthenticatedProcedure
    .input(z.object({
      reviewId: z.string().min(1),
      response: z.enum(["APPROVE", "DECLINE", "ESCALATE"]),
      payload: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const userId = context.accountUser.id;
      const review = await context.db.commonsActionReview.findUnique({ where: { id: input.reviewId } });
      if (!review || review.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      if (review.status !== "PENDING") conflict("This review has already been answered");
      const action = await context.db.commonsAction.findUnique({ where: { id: review.actionId } });
      if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion not found" });
      if (review.payloadHash !== action.payloadHash) {
        await context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "SUPERSEDED" } });
        conflict("This suggestion changed since you were asked — refresh to see the current version");
      }

      if (input.response === "DECLINE") {
        await context.db.$transaction([
          context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "DECLINED", respondedAt: new Date() } }),
          context.db.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED" } }),
          context.db.commonsActionAudit.create({ data: { actionId: action.id, actorId: userId, eventType: "REVIEW_DECLINED", metadata: { reviewType: review.reviewType } } }),
        ]);
        return { success: true };
      }

      // Generic across every reviewType and action type - not terminal, so an admin can still resolve it.
      if (input.response === "ESCALATE") {
        await context.db.$transaction([
          context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "ESCALATED", respondedAt: new Date() } }),
          context.db.commonsActionAudit.create({ data: { actionId: action.id, actorId: userId, eventType: "ESCALATED_TO_ADMIN", metadata: { reviewType: review.reviewType } } }),
        ]);
        return { success: true };
      }

      await context.db.commonsActionReview.update({ where: { id: review.id }, data: { status: "APPROVED", respondedAt: new Date() } });
      await context.db.commonsActionAudit.create({ data: { actionId: action.id, actorId: userId, eventType: "REVIEW_APPROVED", metadata: { reviewType: review.reviewType } } });

      if (review.reviewType === "PROVIDE_CONTEXT") {
        const newPayload = { area: String(input.payload?.area ?? ""), timeWindow: String(input.payload?.timeWindow ?? ""), shareScope: String(input.payload?.shareScope ?? "") };
        const newHash = payloadHash(newPayload);
        await context.db.commonsAction.update({ where: { id: action.id }, data: { payload: newPayload, payloadHash: newHash, revision: { increment: 1 } } });
        const candidate = await findRideMatchCandidate(action);
        if (candidate) {
          await context.db.commonsActionParticipant.upsert({
            where: { actionId_userId: { actionId: action.id, userId: candidate.candidateUserId } },
            create: { actionId: action.id, userId: candidate.candidateUserId, role: "HELPER" },
            update: {},
          });
          await context.db.commonsActionReview.create({
            data: {
              actionId: action.id, userId: action.sourceAuthorId, reviewType: "CONSENT_TO_SHARE",
              payloadHash: newHash, status: "PENDING",
              presentationData: { message: "Sage found a possible match. Confirm what you're comfortable sharing." },
            },
          });
          await createNotificationAndPush(context.db, {
            userId: action.sourceAuthorId, coopId: action.coopId, type: "SAGE_SUGGESTION_NEEDS_YOU",
            title: "Sage has a suggestion for you", body: "Sage found a possible match - confirm what you're comfortable sharing.",
            data: { actionId: action.id },
          }).catch((error) => console.error("Could not notify Sage suggestion subject", error));
        }
      } else if (review.reviewType === "CONSENT_TO_SHARE") {
        const helper = await context.db.commonsActionParticipant.findFirst({ where: { actionId: action.id, role: "HELPER" } });
        if (helper) {
          await context.db.commonsActionReview.create({
            data: {
              actionId: action.id, userId: helper.userId, reviewType: "ACCEPT_MATCH",
              payloadHash: action.payloadHash!, status: "PENDING",
              presentationData: { message: "A circle member could use a ride matching what you offered. Interested?" },
            },
          });
          await createNotificationAndPush(context.db, {
            userId: helper.userId, coopId: action.coopId, type: "SAGE_SUGGESTION_NEEDS_YOU",
            title: "Sage has a suggestion for you", body: "A circle member could use your help - take a look.",
            data: { actionId: action.id },
          }).catch((error) => console.error("Could not notify Sage suggestion helper", error));
        }
      } else if (review.reviewType === "ACCEPT_MATCH" || review.reviewType === "APPROVE_SUGGESTION") {
        await enqueueSageActionExecute(action.id, action.revision);
      }

      return { success: true };
    }),
});

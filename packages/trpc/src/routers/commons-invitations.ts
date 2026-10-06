import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { AccountAuthenticatedContext, Context } from "../context.js";
import {
  accountAuthenticatedProcedure,
  publicProcedure,
} from "../procedures/index.js";
import {
  removeCommonsMember,
  reviewCommonsApplication,
  setCommonsSteward,
  withdrawCommonsApplication,
} from "../services/commons-membership.js";
import {
  acceptCommonsInvitation,
  approveRecommendation,
  createCommonsInvitation,
  createFamilyCommons,
  createShareLink,
  getInvitationForUser,
  getInvitationOverview,
  listInvitationsForUser,
  previewInvitationByToken,
  revokeInvitation,
  getFamilySetup,
  previewFamilyAgreementText,
  updateFamilySetup,
} from "../services/commons-invitations.js";
import { suggestFamilyNames } from "../services/family-name-ideas.js";
import { familySetupSchema } from "../services/family-setup.js";
import { router } from "../trpc.js";
import { resolveOptionalAccountUser } from "./commons.js";

/**
 * Commons invitations, access requests and steward tools. The rules live in
 * services/commons-membership.ts; this router only validates input and
 * picks the caller.
 */

const tokenSchema = z.string().trim().min(20).max(128);
const coopIdSchema = z.string().trim().min(1).max(80);

export const commonsInvitationsRouter = router({
  /** Starts a private family commons; the caller becomes its first steward. */
  createFamily: accountAuthenticatedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().max(280).optional(),
        iconEmoji: z.string().trim().max(16).optional(),
        iconColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        setup: familySetupSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return createFamilyCommons(context.db, { user: context.accountUser, ...input });
    }),

  /**
   * The family agreement the guided setup would save, so the creator can read
   * it before starting the family. Nothing is stored.
   */
  previewFamilyAgreement: accountAuthenticatedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(60),
        setup: familySetupSchema,
        coopId: coopIdSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return {
        charterText: await previewFamilyAgreementText(context.db, { user: context.accountUser, ...input }),
      };
    }),

  /**
   * AI name ideas for the Start a family screen, from what the person has
   * typed so far. Only returns names no commons uses yet.
   */
  suggestFamilyNames: accountAuthenticatedProcedure
    .input(
      z.object({
        currentName: z.string().trim().max(60).optional(),
        description: z.string().trim().max(280).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return suggestFamilyNames(context.db, { userId: context.accountUser.id, ...input });
    }),

  /** What an invitation link shows before (and after) signing in. */
  preview: publicProcedure
    .input(z.object({ token: tokenSchema }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const viewer = await resolveOptionalAccountUser(context);
      return previewInvitationByToken(context.db, input.token, viewer);
    }),

  /** Pending invitations addressed to the signed-in account's email or phone. */
  listMine: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const context = ctx as AccountAuthenticatedContext;
    return {
      invitations: await listInvitationsForUser(context.db, context.accountUser),
    };
  }),

  getMine: accountAuthenticatedProcedure
    .input(z.object({ invitationId: z.string().min(1).max(64) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return getInvitationForUser(context.db, input.invitationId, context.accountUser);
    }),

  accept: accountAuthenticatedProcedure
    .input(
      z
        .object({
          token: tokenSchema.optional(),
          invitationId: z.string().min(1).max(64).optional(),
          acceptRules: z.boolean().default(false),
          note: z.string().trim().max(500).optional(),
        })
        .refine((value) => !!value.token !== !!value.invitationId, {
          message: "Pass a token or an invitation id.",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return acceptCommonsInvitation(context.db, { user: context.accountUser, ...input });
    }),

  /** Invite (steward, or any member of an application-required commons) or recommend. */
  invite: accountAuthenticatedProcedure
    .input(
      z
        .object({
          coopId: coopIdSchema,
          email: z.string().trim().max(254).optional(),
          phone: z.string().trim().max(40).optional(),
          recipientName: z.string().trim().max(80).optional(),
          message: z.string().trim().max(500).optional(),
        })
        .refine((value) => !!value.email !== !!value.phone, {
          message: "Invite by email or by phone, not both.",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return createCommonsInvitation(context.db, { inviter: context.accountUser, ...input });
    }),

  approveRecommendation: accountAuthenticatedProcedure
    .input(z.object({ invitationId: z.string().min(1).max(64) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return approveRecommendation(context.db, {
        invitationId: input.invitationId,
        steward: context.accountUser,
      });
    }),

  /** Cancel an invitation, decline a recommendation, or turn off a share link. */
  revoke: accountAuthenticatedProcedure
    .input(z.object({ invitationId: z.string().min(1).max(64) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return revokeInvitation(context.db, {
        invitationId: input.invitationId,
        userId: context.accountUser.id,
      });
    }),

  createShareLink: accountAuthenticatedProcedure
    .input(z.object({ coopId: coopIdSchema }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return createShareLink(context.db, { coopId: input.coopId, steward: context.accountUser });
    }),

  /**
   * A family's goals, mission and agreement choices, for its stewards, and
   * whether they may still change them (only while everyone is a steward).
   */
  familySetup: accountAuthenticatedProcedure
    .input(z.object({ coopId: coopIdSchema }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return getFamilySetup(context.db, { coopId: input.coopId, user: context.accountUser });
    }),

  updateFamilySetup: accountAuthenticatedProcedure
    .input(z.object({ coopId: coopIdSchema, setup: familySetupSchema }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return updateFamilySetup(context.db, {
        coopId: input.coopId,
        user: context.accountUser,
        setup: input.setup,
      });
    }),

  overview: accountAuthenticatedProcedure
    .input(z.object({ coopId: coopIdSchema }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return getInvitationOverview(context.db, { coopId: input.coopId, user: context.accountUser });
    }),

  reviewRequest: accountAuthenticatedProcedure
    .input(
      z.object({
        applicationId: z.string().min(1).max(64),
        decision: z.enum(["APPROVE", "DECLINE"]),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return reviewCommonsApplication(context.db, {
        ...input,
        reviewerId: context.accountUser.id,
      });
    }),

  withdrawRequest: accountAuthenticatedProcedure
    .input(z.object({ coopId: coopIdSchema }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return withdrawCommonsApplication(context.db, {
        userId: context.accountUser.id,
        coopId: input.coopId,
      });
    }),

  removeMember: accountAuthenticatedProcedure
    .input(z.object({ coopId: coopIdSchema, userId: z.string().min(1).max(64) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return removeCommonsMember(context.db, {
        coopId: input.coopId,
        userId: input.userId,
        stewardId: context.accountUser.id,
      });
    }),

  setSteward: accountAuthenticatedProcedure
    .input(
      z.object({
        coopId: coopIdSchema,
        userId: z.string().min(1).max(64),
        steward: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      if (input.userId === context.accountUser.id && input.steward) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You're already a steward." });
      }
      return setCommonsSteward(context.db, { ...input, stewardId: context.accountUser.id });
    }),
});

import { z } from "zod";

import { commitToOfferSchema } from "@repo/validators/marketplace-offers";

import { accountAuthenticatedProcedure } from "../procedures/account-authenticated.js";
import {
  cancelCommitment,
  commitToOffer,
  getOfferForMember,
  listOffersForMember,
  listOffersForVendor,
  mySavings,
  openPayment,
  requireStoreOwner,
  startOfferCheckout,
  updateFulfillment,
  vendorMarkPickedUp,
  vendorRoster,
} from "../services/marketplace-offers/index.js";
import { router } from "../trpc.js";

const coopInput = z.object({ coopId: z.string().min(1).max(100) });
const offerInput = z.object({ offerId: z.string().min(1) });

/**
 * Member Deals and Group Buys for members and vendors. Every call
 * needs a signed-in session; identity always comes from the session, never
 * from the request. Platform admins manage offers through the web admin.
 */
export const marketplaceOffersRouter = router({
  // ── Members ──
  listForCommons: accountAuthenticatedProcedure
    .input(coopInput)
    .query(({ ctx, input }) => listOffersForMember(ctx.db, ctx.accountUser.id, input.coopId)),

  get: accountAuthenticatedProcedure
    .input(offerInput)
    .query(({ ctx, input }) => getOfferForMember(ctx.db, ctx.accountUser.id, input.offerId)),

  commit: accountAuthenticatedProcedure
    .input(commitToOfferSchema)
    .mutation(({ ctx, input }) =>
      commitToOffer(ctx.db, {
        userId: ctx.accountUser.id,
        offerId: input.offerId,
        quantity: input.quantity,
        contactPhone: input.contactPhone,
      }),
    ),

  cancelCommitment: accountAuthenticatedProcedure
    .input(offerInput)
    .mutation(({ ctx, input }) => cancelCommitment(ctx.db, { userId: ctx.accountUser.id, offerId: input.offerId })),

  startCheckout: accountAuthenticatedProcedure
    .input(
      offerInput.extend({
        quantity: z.number().int().min(1).max(50).optional(),
        paymentUi: z.enum(["payment_intent", "hosted_checkout"]).default("payment_intent"),
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ ctx, input }) => startOfferCheckout(ctx.db, { userId: ctx.accountUser.id, ...input })),

  mySavings: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).max(100).optional() }))
    .query(({ ctx, input }) => mySavings(ctx.db, ctx.accountUser.id, input.coopId)),

  // ── Vendors (shop owners) ──
  vendorList: accountAuthenticatedProcedure.query(({ ctx }) => listOffersForVendor(ctx.db, ctx.accountUser.id)),

  vendorRoster: accountAuthenticatedProcedure
    .input(offerInput)
    .query(({ ctx, input }) => vendorRoster(ctx.db, ctx.accountUser.id, input.offerId)),

  vendorConfirm: accountAuthenticatedProcedure.input(offerInput).mutation(async ({ ctx, input }) => {
    await requireStoreOwner(ctx.db, ctx.accountUser.id, input.offerId);
    return openPayment(ctx.db, ctx.accountUser.id, input.offerId);
  }),

  vendorUpdateFulfillment: accountAuthenticatedProcedure
    .input(offerInput.extend({ status: z.enum(["ORDERED", "READY", "FULFILLED"]) }))
    .mutation(async ({ ctx, input }) => {
      await requireStoreOwner(ctx.db, ctx.accountUser.id, input.offerId);
      await updateFulfillment(ctx.db, ctx.accountUser.id, input.offerId, input.status);
      return { ok: true };
    }),

  vendorMarkPickedUp: accountAuthenticatedProcedure
    .input(z.object({ commitmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await vendorMarkPickedUp(ctx.db, ctx.accountUser.id, input.commitmentId);
      return { ok: true };
    }),
});

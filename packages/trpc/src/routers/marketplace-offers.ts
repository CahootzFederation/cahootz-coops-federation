import { z } from "zod";

import { commitToOfferSchema } from "@repo/validators/marketplace-offers";

import { accountAuthenticatedProcedure } from "../procedures/account-authenticated.js";
import {
  cancelCommitment,
  commitToOffer,
  finishCardSetup,
  getOfferForMember,
  listOffersForMember,
  myOrderDefaults,
  mySavings,
  startCardSetup,
  startOfferCheckout,
} from "../services/marketplace-offers/index.js";
import { router } from "../trpc.js";

const coopInput = z.object({ coopId: z.string().min(1).max(100) });
const offerInput = z.object({ offerId: z.string().min(1) });
const paymentUi = z.enum(["payment_intent", "hosted_checkout"]).default("payment_intent");

/**
 * Group Buys for members. Every call needs a signed-in
 * session; identity always comes from the session, never from the request.
 * Vendors never use the app: platform admins manage offers, orders and vendor
 * payouts through the web admin.
 */
export const marketplaceOffersRouter = router({
  listForCommons: accountAuthenticatedProcedure
    .input(coopInput)
    .query(({ ctx, input }) => listOffersForMember(ctx.db, ctx.accountUser.id, input.coopId)),

  get: accountAuthenticatedProcedure
    .input(offerInput)
    .query(({ ctx, input }) => getOfferForMember(ctx.db, ctx.accountUser.id, input.offerId)),

  /** The member's saved delivery address and card, to fill in the order form. */
  orderDefaults: accountAuthenticatedProcedure.query(({ ctx }) => myOrderDefaults(ctx.db, ctx.accountUser.id)),

  /** Starts saving a card with Stripe. Nothing is charged. */
  startCardSetup: accountAuthenticatedProcedure
    .input(
      z.object({
        paymentUi,
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ ctx, input }) => startCardSetup(ctx.db, { userId: ctx.accountUser.id, ...input })),

  finishCardSetup: accountAuthenticatedProcedure
    .input(z.object({ setupId: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => finishCardSetup(ctx.db, { userId: ctx.accountUser.id, setupId: input.setupId })),

  commit: accountAuthenticatedProcedure
    .input(commitToOfferSchema)
    .mutation(({ ctx, input }) =>
      commitToOffer(ctx.db, {
        userId: ctx.accountUser.id,
        offerId: input.offerId,
        quantity: input.quantity,
        contactPhone: input.contactPhone,
        shippingAddress: input.shippingAddress,
      }),
    ),

  cancelCommitment: accountAuthenticatedProcedure
    .input(offerInput)
    .mutation(({ ctx, input }) => cancelCommitment(ctx.db, { userId: ctx.accountUser.id, offerId: input.offerId })),

  startCheckout: accountAuthenticatedProcedure
    .input(
      offerInput.extend({
        paymentUi,
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ ctx, input }) => startOfferCheckout(ctx.db, { userId: ctx.accountUser.id, ...input })),

  mySavings: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1).max(100).optional() }))
    .query(({ ctx, input }) => mySavings(ctx.db, ctx.accountUser.id, input.coopId)),
});

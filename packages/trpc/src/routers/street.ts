import { z } from "zod";

import type { AccountAuthenticatedContext } from "../context.js";
import { accountAuthenticatedProcedure } from "../procedures/index.js";
import { getStreet, knockOnDoor, leaveStreet, moveOnStreet, paintHouse } from "../services/street.js";
import { router } from "../trpc.js";

const coopInput = z.object({ coopId: z.string().min(1) });

/** Commons Street: the walkable street for a Commons (see services/street.ts). */
export const streetRouter = router({
  get: accountAuthenticatedProcedure.input(coopInput).query(async ({ input, ctx }) => {
    const context = ctx as AccountAuthenticatedContext;
    return getStreet(context.db, input.coopId, context.accountUser.id);
  }),

  move: accountAuthenticatedProcedure
    .input(coopInput.extend({ x: z.number().int(), y: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      await moveOnStreet(context.db, input.coopId, context.accountUser.id, input.x, input.y);
      return { success: true };
    }),

  leave: accountAuthenticatedProcedure.input(coopInput).mutation(async ({ input, ctx }) => {
    const context = ctx as AccountAuthenticatedContext;
    await leaveStreet(context.db, input.coopId, context.accountUser.id);
    return { success: true };
  }),

  paint: accountAuthenticatedProcedure
    .input(
      coopInput.extend({
        houseStyle: z.string().max(16).optional(),
        wallColor: z.string().max(32).optional(),
        roofColor: z.string().max(32).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const { coopId, ...look } = input;
      return paintHouse(context.db, coopId, context.accountUser.id, look);
    }),

  knock: accountAuthenticatedProcedure
    .input(coopInput.extend({ userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      return knockOnDoor(context.db, input.coopId, context.accountUser, input.userId);
    }),
});

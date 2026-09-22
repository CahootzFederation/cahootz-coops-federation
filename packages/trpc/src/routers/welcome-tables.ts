import { z } from 'zod';

import { platformAdminProcedure } from '../procedures/index.js';
import { listCommonsMembers } from '../services/platform-admin.js';
import {
  getWelcomeTableConfig,
  listWelcomeTableHistory,
  startNextWelcomeTable,
  updateWelcomeTableConfig,
} from '../services/welcome-tables.js';
import { router } from '../trpc.js';

export const welcomeTablesRouter = router({
  getConfig: platformAdminProcedure
    .input(z.object({ coopId: z.string().min(1).default('cahootz') }))
    .query(async ({ input, ctx }) => {
      const result = await getWelcomeTableConfig(ctx.db, input.coopId);
      return { config: result?.config ?? null, activeTable: result?.activeTable ?? null };
    }),

  updateConfig: platformAdminProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default('cahootz'),
        enabled: z.boolean().optional(),
        capacity: z.number().int().min(1).max(500).optional(),
        guideUserId: z.string().min(1).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { coopId, ...updates } = input;
      const config = await updateWelcomeTableConfig(ctx.db, coopId, updates, ctx.walletAddress);
      return { config };
    }),

  startNext: platformAdminProcedure
    .input(z.object({ coopId: z.string().min(1).default('cahootz') }))
    .mutation(async ({ input, ctx }) => {
      const group = await startNextWelcomeTable(ctx.db, input.coopId, ctx.walletAddress);
      return { groupId: group.id, name: group.name, welcomeTableNumber: group.welcomeTableNumber };
    }),

  listEligibleGuides: platformAdminProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default('cahootz'),
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(async ({ input }) => {
      const result = await listCommonsMembers(input.coopId, { search: input.search, page: input.page });
      return {
        ...result,
        items: result.items.filter((member) => member.status === 'ACTIVE'),
      };
    }),

  listHistory: platformAdminProcedure
    .input(z.object({ coopId: z.string().min(1).default('cahootz') }))
    .query(async ({ input, ctx }) => {
      const history = await listWelcomeTableHistory(ctx.db, input.coopId);
      return { history };
    }),
});

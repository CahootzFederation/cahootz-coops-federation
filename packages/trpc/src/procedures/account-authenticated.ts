import { TRPCError } from "@trpc/server";

import type { Context } from "../context.js";
import { touchMemberActivity } from "../lib/member-activity.js";
import { t } from "../trpc.js";

const getHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const requireAccountSession = t.middleware(async ({ ctx, next }) => {
  const context = ctx as Context;
  const token = getHeaderValue(context.req.headers["x-session-token"]);

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Create an account to continue.",
    });
  }

  const session = await context.db.session.findUnique({
    where: { token },
  });

  if (!session || session.isRevoked || session.expiresAt <= new Date()) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Your session expired. Sign in again to continue.",
    });
  }

  const user = await context.db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      handle: true,
      name: true,
      phone: true,
      roles: true,
      status: true,
      deletedAt: true,
      lastActiveAt: true,
    },
  });

  if (!user || user.deletedAt) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account is not available.",
    });
  }

  if (user.status === "SUSPENDED" || user.status === "REJECTED") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account cannot perform this action.",
    });
  }

  await context.db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() },
  });
  await touchMemberActivity(context.db, user);

  const { lastActiveAt: _lastActiveAt, ...accountUser } = user;
  return next({
    ctx: {
      ...ctx,
      accountUser,
      sessionToken: token,
    },
  });
});

export const accountAuthenticatedProcedure =
  t.procedure.use(requireAccountSession);

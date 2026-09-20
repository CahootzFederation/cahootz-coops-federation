import { TRPCError } from "@trpc/server";
import type { Context } from "../context.js";
import { verifyCommonsAdminToken } from "../lib/commons-admin-token.js";
import { t } from "../trpc.js";

export const commonsPlatformAdminProcedure = t.procedure.use(async ({ ctx, next }) => {
  const context = ctx as Context;
  const header = context.req.headers.authorization;
  const authorization = Array.isArray(header) ? header[0] : header;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const admin = token ? verifyCommonsAdminToken(token) : null;
  if (!admin) throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin access required" });
  const user = await context.db.user.findUnique({ where: { id: admin.sub }, select: { deletedAt: true, status: true } });
  if ((admin.userId && !user) || user?.deletedAt || user?.status === "SUSPENDED" || user?.status === "REJECTED") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin account is unavailable" });
  }
  return next({ ctx: { ...ctx, commonsAdminIdentity: admin.email || admin.address || admin.sub } });
});

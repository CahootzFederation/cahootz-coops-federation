import { randomBytes } from "node:crypto";

import type { Context } from "../context.js";

export const COMMONS_COOP_ID = "cahootz";

type CommonsMembershipDb = Pick<Context["db"], "userCoopMembership">;

export async function ensureCommonsMembership(
  db: CommonsMembershipDb,
  userId: string,
) {
  const now = new Date();

  return db.userCoopMembership.upsert({
    where: {
      userId_coopId: {
        userId,
        coopId: COMMONS_COOP_ID,
      },
    },
    create: {
      userId,
      coopId: COMMONS_COOP_ID,
      status: "ACTIVE",
      roles: ["member"],
      joinedAt: now,
      lastActiveAt: now,
    },
    update: {
      status: "ACTIVE",
      joinedAt: now,
      lastActiveAt: now,
    },
  });
}

export async function getCoopSessionData(
  db: Context["db"],
  coopId = COMMONS_COOP_ID,
) {
  const coopConfig = await db.coopConfig.findFirst({
    where: { coopId, isActive: true },
    orderBy: { version: "desc" },
  });

  if (!coopConfig && coopId !== COMMONS_COOP_ID) return undefined;

  return {
    id: coopId,
    name: coopConfig?.name || (coopId === COMMONS_COOP_ID ? "Cahootz Commons" : coopId),
    shortName: coopConfig?.slug || (coopId === COMMONS_COOP_ID ? "Cahootz" : coopId),
    apiUrl:
      process.env.API_BASE_URL ||
      "https://soulaan-api-production.up.railway.app",
    webUrl: process.env.WEB_BASE_URL || "https://www.soulaan.com",
    primaryColor: coopConfig?.bgColor || undefined,
    accentColor: coopConfig?.accentColor || undefined,
    logoUrl: undefined,
  };
}

export async function createAccountSession(
  db: Context["db"],
  ctx: Context,
  userId: string,
) {
  const token = randomBytes(32).toString("hex");
  const forwardedFor = ctx.req.headers["x-forwarded-for"];
  const ipAddress =
    (Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0]?.trim()) || "unknown";
  const userAgent = ctx.req.headers["user-agent"];

  await db.session.create({
    data: {
      userId,
      token,
      ipAddress,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });

  return token;
}

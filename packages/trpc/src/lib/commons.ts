import { randomBytes } from "node:crypto";

import type { Context } from "../context.js";

export const COMMONS_COOP_ID = "cahootz";

type CommonsMembershipDb = Pick<Context["db"], "userCoopMembership">;

export async function ensureCommonsMembership(
  db: CommonsMembershipDb,
  userId: string,
  coopId: string = COMMONS_COOP_ID,
  roles: string[] = ["member"],
) {
  const now = new Date();

  return db.userCoopMembership.upsert({
    where: {
      userId_coopId: {
        userId,
        coopId,
      },
    },
    create: {
      userId,
      coopId,
      status: "ACTIVE",
      roles,
      joinedAt: now,
      lastActiveAt: now,
    },
    update: {
      status: "ACTIVE",
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

function slugifyHandle(base: string) {
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30) || "member";
}

/**
 * Group-ping tokens Sage uses in system comments (e.g. `[@everyone]` in a
 * welcome-lounge join announcement). They must never belong to a real user,
 * or a mention meant for a whole room would resolve to - and notify - one
 * person.
 */
export const EVERYONE_MENTION_HANDLE = "everyone";
export const RESERVED_MENTION_HANDLES: ReadonlySet<string> = new Set([EVERYONE_MENTION_HANDLE, "here"]);

type HandleDb = Pick<Context["db"], "user">;

/**
 * Returns the user's stable, unique handle, generating and persisting one
 * on first use. Handles used to be computed on the fly from display name,
 * which collided across users and changed whenever they renamed themselves.
 */
export async function ensureUserHandle(
  db: HandleDb,
  user: { id: string; handle?: string | null; name: string | null; email: string },
) {
  if (user.handle) return user.handle;

  const base = slugifyHandle(user.name || user.email.split("@")[0] || "member");
  let suffix = RESERVED_MENTION_HANDLES.has(base) ? 1 : 0;
  let candidate = suffix ? `${base}${suffix}` : base;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db.user.findUnique({ where: { handle: candidate }, select: { id: true } });
    if (!existing || existing.id === user.id) break;
    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  try {
    await db.user.update({ where: { id: user.id }, data: { handle: candidate } });
  } catch (error) {
    // Unique constraint race: another request claimed `candidate` between the check and this write.
    const refreshed = await db.user.findUnique({ where: { id: user.id }, select: { handle: true } });
    if (refreshed?.handle) return refreshed.handle;
    throw error;
  }

  return candidate;
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

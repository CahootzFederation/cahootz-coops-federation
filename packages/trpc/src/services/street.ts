import { TRPCError } from "@trpc/server";
import {
  buildStreetLayout,
  defaultHouseLook,
  STREET_KNOCK_COOLDOWN_MS,
  STREET_ONLINE_WINDOW_MS,
  STREET_ROOF_KEYS,
  STREET_WALL_KEYS,
  STREET_HOUSE_STYLES,
  type StreetHouseStyle,
  type StreetRoofColor,
  type StreetWallColor,
} from "@repo/validators/street";

import type { Context } from "../context.js";
import { requireActiveMember } from "./commons-membership.js";
import { createNotificationAndPush } from "./push-notification-service.js";

type Db = Context["db"];

// Same rules as displayName/personHandle in routers/commons.ts, kept here so
// this service doesn't import a router.
function displayName(user: { name: string | null; email: string }) {
  return user.name || user.email.split("@")[0] || "Commons member";
}
function personHandle(user: { handle?: string | null; name: string | null; email: string }) {
  return user.handle || displayName(user).toLowerCase().replace(/[^a-z0-9]+/g, "") || "member";
}

export interface StreetLotView {
  lotNumber: number;
  houseStyle: StreetHouseStyle;
  wallColor: StreetWallColor;
  roofColor: StreetRoofColor;
  isYou: boolean;
  user: { id: string; name: string; handle: string; avatarColor: string | null };
}

export interface StreetPersonView {
  userId: string;
  name: string;
  handle: string;
  avatarColor: string | null;
  x: number;
  y: number;
  isYou: boolean;
}

export interface StreetView {
  coopId: string;
  maxLotNumber: number;
  yourLotNumber: number;
  lots: StreetLotView[];
  online: StreetPersonView[];
  circleCount: number;
}

const userSelect = { id: true, name: true, email: true, handle: true, avatarColor: true } as const;

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** The caller's lot, created on their first visit as the next free lot number. */
export async function ensureStreetLot(db: Db, coopId: string, userId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.streetLot.findUnique({ where: { coopId_userId: { coopId, userId } } });
    if (existing) return existing;
    const top = await db.streetLot.findFirst({
      where: { coopId },
      orderBy: { lotNumber: "desc" },
      select: { lotNumber: true },
    });
    const lotNumber = (top?.lotNumber ?? -1) + 1;
    try {
      return await db.streetLot.create({ data: { coopId, userId, lotNumber, ...defaultHouseLook(lotNumber) } });
    } catch (error) {
      // Two first visits at once picked the same number, or this member's own
      // lot was just made by another request. Look again and try the next one.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new TRPCError({ code: "CONFLICT", message: "We couldn't save your spot on the street. Try again in a moment." });
}

export async function getStreet(db: Db, coopId: string, userId: string): Promise<StreetView> {
  await requireActiveMember(db, userId, coopId);
  const mine = await ensureStreetLot(db, coopId, userId);

  const since = new Date(Date.now() - STREET_ONLINE_WINDOW_MS);
  const [lots, presence, circleCount] = await Promise.all([
    db.streetLot.findMany({ where: { coopId }, orderBy: { lotNumber: "asc" }, include: { user: { select: userSelect } } }),
    db.streetPresence.findMany({
      where: { coopId, exitedAt: null, lastActivityAt: { gt: since } },
      include: { user: { select: userSelect } },
    }),
    db.group.count({
      where: {
        coopId,
        kind: { not: "DIRECT" },
        OR: [{ privacy: "public" }, { members: { some: { userId } } }],
      },
    }),
  ]);

  // Only current members show on the street. A member who left keeps their lot
  // number (so nobody else's house moves) but their house stops being drawn.
  const memberIds = new Set(
    (
      await db.userCoopMembership.findMany({
        where: { coopId, status: "ACTIVE", userId: { in: lots.map((lot) => lot.userId) } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );

  return {
    coopId,
    maxLotNumber: lots.reduce((max, lot) => Math.max(max, lot.lotNumber), mine.lotNumber),
    yourLotNumber: mine.lotNumber,
    circleCount,
    lots: lots
      .filter((lot) => memberIds.has(lot.userId))
      .map((lot) => ({
        lotNumber: lot.lotNumber,
        houseStyle: lot.houseStyle as StreetHouseStyle,
        wallColor: lot.wallColor as StreetWallColor,
        roofColor: lot.roofColor as StreetRoofColor,
        isYou: lot.userId === userId,
        user: {
          id: lot.user.id,
          name: displayName(lot.user),
          handle: personHandle(lot.user),
          avatarColor: lot.user.avatarColor,
        },
      })),
    online: presence
      .filter((row) => memberIds.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: displayName(row.user),
        handle: personHandle(row.user),
        avatarColor: row.user.avatarColor,
        x: row.x,
        y: row.y,
        isYou: row.userId === userId,
      })),
  };
}

export async function moveOnStreet(db: Db, coopId: string, userId: string, x: number, y: number) {
  await requireActiveMember(db, userId, coopId);
  const top = await db.streetLot.findFirst({ where: { coopId }, orderBy: { lotNumber: "desc" }, select: { lotNumber: true } });
  const layout = buildStreetLayout(top?.lotNumber ?? 0);
  if (!layout.inBounds(x, y)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That spot is off the street." });
  }
  const now = new Date();
  await db.streetPresence.upsert({
    where: { coopId_userId: { coopId, userId } },
    create: { coopId, userId, x, y, lastActivityAt: now },
    update: { x, y, lastActivityAt: now, exitedAt: null },
  });
}

export async function leaveStreet(db: Db, coopId: string, userId: string) {
  await db.streetPresence.updateMany({ where: { coopId, userId }, data: { exitedAt: new Date() } });
}

export async function paintHouse(
  db: Db,
  coopId: string,
  userId: string,
  look: { houseStyle?: string; wallColor?: string; roofColor?: string },
) {
  await requireActiveMember(db, userId, coopId);
  if (look.houseStyle && !(STREET_HOUSE_STYLES as readonly string[]).includes(look.houseStyle)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick one of the house styles shown." });
  }
  if (look.wallColor && !(STREET_WALL_KEYS as string[]).includes(look.wallColor)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick one of the wall colors shown." });
  }
  if (look.roofColor && !(STREET_ROOF_KEYS as string[]).includes(look.roofColor)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick one of the roof colors shown." });
  }
  await ensureStreetLot(db, coopId, userId);
  return db.streetLot.update({
    where: { coopId_userId: { coopId, userId } },
    data: {
      ...(look.houseStyle ? { houseStyle: look.houseStyle } : {}),
      ...(look.wallColor ? { wallColor: look.wallColor } : {}),
      ...(look.roofColor ? { roofColor: look.roofColor } : {}),
    },
    select: { lotNumber: true, houseStyle: true, wallColor: true, roofColor: true },
  });
}

export async function knockOnDoor(
  db: Db,
  coopId: string,
  visitor: { id: string; name: string | null; email: string },
  neighborId: string,
) {
  await requireActiveMember(db, visitor.id, coopId);
  if (neighborId === visitor.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That's your own house. Try a neighbor's door." });
  }
  const neighbor = await db.userCoopMembership.findUnique({
    where: { userId_coopId: { userId: neighborId, coopId } },
    select: { status: true },
  });
  if (neighbor?.status !== "ACTIVE") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Nobody's home there anymore." });
  }

  const recent = await db.notification.findFirst({
    where: {
      userId: neighborId,
      coopId,
      type: "STREET_KNOCK",
      createdAt: { gt: new Date(Date.now() - STREET_KNOCK_COOLDOWN_MS) },
      data: { path: ["fromUserId"], equals: visitor.id },
    },
    select: { id: true },
  });
  if (recent) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You knocked a little while ago. Give them a bit, or send a message instead.",
    });
  }

  const name = displayName(visitor);
  await createNotificationAndPush(db, {
    userId: neighborId,
    coopId,
    type: "STREET_KNOCK",
    title: "Someone knocked",
    body: `${name} stopped by your house.`,
    data: { coopId, fromUserId: visitor.id, fromName: name },
  });
  return { success: true };
}

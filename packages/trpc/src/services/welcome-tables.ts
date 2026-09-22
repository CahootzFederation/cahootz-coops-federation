import { TRPCError } from "@trpc/server";

import type { Context } from "../context.js";
import { auditLogEntry } from "../lib/audit.js";
import { generateInviteCode } from "../lib/invite-code.js";

type Db = Context["db"];

const MAX_SERIALIZATION_RETRIES = 5;

type AssignMode =
  | { type: "auto"; newcomerId: string }
  | { type: "admin"; actorWalletAddress: string };

/**
 * Assign a newcomer into the active welcome table (creating the next
 * numbered one if it's full/closed/missing), or - for an admin - retire the
 * current table early and start the next one. Both paths share this one
 * locked transaction body so the numbering/capacity invariants only need to
 * be gotten right in one place.
 *
 * Runs under Serializable isolation and retries on a Postgres serialization
 * conflict (Prisma error code P2034) - nothing else in this codebase uses
 * Serializable/row-locking yet, and Prisma does not retry these itself, so
 * the retry loop here is load-bearing, not defensive boilerplate.
 */
async function assignOrAdvance(db: Db, coopId: string, mode: AssignMode) {
  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          // First-ever assignment/advance for a coop: create the config row
          // with schema defaults (enabled, capacity 30, no guide) rather
          // than requiring an admin to visit the config page first.
          const config = await tx.welcomeTableConfig.upsert({
            where: { coopId },
            create: { coopId },
            update: {},
          });
          if (!config.enabled) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Welcome lounges are not enabled." });
          }
          // A guide is optional - a table can exist unguided and have one
          // assigned later via welcomeTables.updateConfig. Something still
          // has to hold the required (non-nullable) Group.leaderId slot in
          // the meantime: the newcomer who triggers auto-creation, or -
          // for an admin-triggered advance with no newcomer in the mix -
          // whichever platform-admin account triggered it.
          let fallbackLeaderId: string | null = null;
          if (!config.guideUserId) {
            if (mode.type === "auto") {
              fallbackLeaderId = mode.newcomerId;
            } else {
              const admin = await tx.user.findFirst({
                where: {
                  OR: [
                    { walletAddress: { equals: mode.actorWalletAddress, mode: "insensitive" } },
                    { wallets: { some: { address: { equals: mode.actorWalletAddress, mode: "insensitive" } } } },
                  ],
                },
                select: { id: true },
              });
              if (!admin) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "Configure a guide, or use a wallet-linked admin account, before starting a lounge.",
                });
              }
              fallbackLeaderId = admin.id;
            }
          }

          const active = config.activeTableId
            ? await tx.group.findUnique({ where: { id: config.activeTableId } })
            : null;
          const isOpen = active?.welcomeTableStatus === "OPEN";
          const newcomerCount = isOpen
            ? await tx.groupMember.count({ where: { groupId: active!.id, role: "NEWCOMER" } })
            : 0;

          if (mode.type === "auto" && isOpen && newcomerCount < config.capacity) {
            await tx.groupMember.create({
              data: { groupId: active!.id, userId: mode.newcomerId, role: "NEWCOMER" },
            });
            if (newcomerCount + 1 >= config.capacity) {
              await tx.group.update({ where: { id: active!.id }, data: { welcomeTableStatus: "FULL" } });
            }
            return active!;
          }

          // Admin advance, or an auto-assign that landed on a full/closed/missing
          // table: retire the current one (if any) and create the next.
          if (isOpen) {
            await tx.group.update({
              where: { id: active!.id },
              data: { welcomeTableStatus: mode.type === "admin" ? "CLOSED" : "FULL" },
            });
          }

          const nextNumber = config.lastTableNumber + 1;
          const created = await tx.group.create({
            data: {
              coopId,
              kind: "WELCOME_TABLE",
              name: `Welcome Lounge ${nextNumber}`,
              privacy: "private",
              inviteCode: generateInviteCode(),
              leaderId: config.guideUserId ?? fallbackLeaderId!,
              welcomeTableNumber: nextNumber,
              welcomeTableStatus: "OPEN",
              capacity: config.capacity,
            },
          });
          if (config.guideUserId) {
            await tx.groupMember.create({
              data: { groupId: created.id, userId: config.guideUserId, role: "GUIDE" },
            });
          }
          if (mode.type === "auto") {
            await tx.groupMember.create({
              data: { groupId: created.id, userId: mode.newcomerId, role: "NEWCOMER" },
            });
          }
          await tx.welcomeTableConfig.update({
            where: { id: config.id },
            data: { lastTableNumber: nextNumber, activeTableId: created.id },
          });
          await tx.auditLog.create({
            data: auditLogEntry({
              actorId: mode.type === "admin" ? mode.actorWalletAddress : mode.newcomerId,
              action: mode.type === "admin" ? "WELCOME_TABLE_ADVANCED" : "WELCOME_TABLE_CREATED",
              resource: "Group",
              resourceId: created.id,
              metadata: { coopId, tableNumber: nextNumber },
            }),
          });

          return created;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      const isSerializationConflict = (err as { code?: string } | undefined)?.code === "P2034";
      if (isSerializationConflict && attempt < MAX_SERIALIZATION_RETRIES - 1) continue;
      throw err;
    }
  }
  // Unreachable - the loop above always returns or throws - but keeps TS happy.
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not assign a welcome lounge." });
}

export async function assignWelcomeTable(db: Db, coopId: string, userId: string) {
  const existing = await db.groupMember.findFirst({
    where: { userId, role: "NEWCOMER", group: { coopId, kind: "WELCOME_TABLE" } },
    include: { group: true },
  });
  if (existing) return existing.group;

  return assignOrAdvance(db, coopId, { type: "auto", newcomerId: userId });
}

export async function startNextWelcomeTable(db: Db, coopId: string, actorWalletAddress: string) {
  return assignOrAdvance(db, coopId, { type: "admin", actorWalletAddress });
}

export async function getWelcomeTableConfig(db: Db, coopId: string) {
  const config = await db.welcomeTableConfig.findUnique({ where: { coopId } });
  if (!config) return null;

  const activeTable = config.activeTableId
    ? await db.group.findUnique({
        where: { id: config.activeTableId },
        include: { _count: { select: { members: { where: { role: "NEWCOMER" } } } } },
      })
    : null;

  return {
    config,
    activeTable: activeTable
      ? {
          id: activeTable.id,
          name: activeTable.name,
          status: activeTable.welcomeTableStatus,
          tableNumber: activeTable.welcomeTableNumber,
          newcomerCount: activeTable._count.members,
        }
      : null,
  };
}

export async function updateWelcomeTableConfig(
  db: Db,
  coopId: string,
  updates: { enabled?: boolean; capacity?: number; guideUserId?: string | null },
  actorWalletAddress: string,
) {
  const current = await db.welcomeTableConfig.upsert({
    where: { coopId },
    create: { coopId },
    update: {},
  });

  const newFields: Record<string, unknown> = {};
  if (updates.enabled !== undefined) newFields.enabled = updates.enabled;
  if (updates.capacity !== undefined) newFields.capacity = updates.capacity;
  if (updates.guideUserId !== undefined) newFields.guideUserId = updates.guideUserId;

  const diff = Object.entries(newFields)
    .filter(([field, after]) => (current as Record<string, unknown>)[field] !== after)
    .map(([field, after]) => ({ field, before: (current as Record<string, unknown>)[field], after }));

  const [updated] = await db.$transaction([
    db.welcomeTableConfig.update({ where: { id: current.id }, data: newFields }),
    db.auditLog.create({
      data: auditLogEntry({
        actorId: actorWalletAddress,
        action: "WELCOME_TABLE_CONFIG_UPDATED",
        resource: "WelcomeTableConfig",
        resourceId: current.id,
        metadata: { coopId, diff },
      }),
    }),
  ]);

  return updated;
}

/**
 * Batched NEWCOMER-role member count for a list of welcome-table group ids
 * (used by groups.listVisible/listMine to populate `newcomerCount` on circle
 * summaries without one query per card).
 */
export async function getNewcomerCounts(db: Db, groupIds: string[]): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();

  const rows = await db.groupMember.groupBy({
    by: ["groupId"],
    where: { groupId: { in: groupIds }, role: "NEWCOMER" },
    _count: { _all: true },
  });

  return new Map(rows.map((r) => [r.groupId, r._count._all]));
}

export async function listWelcomeTableHistory(db: Db, coopId: string) {
  const tables = await db.group.findMany({
    where: { coopId, kind: "WELCOME_TABLE" },
    orderBy: { welcomeTableNumber: "desc" },
    include: {
      members: { where: { role: "GUIDE" }, include: { user: { select: { name: true, email: true } } }, take: 1 },
      _count: { select: { members: { where: { role: "NEWCOMER" } } } },
    },
  });

  return tables.map((table) => ({
    id: table.id,
    tableNumber: table.welcomeTableNumber,
    status: table.welcomeTableStatus,
    newcomerCount: table._count.members,
    capacity: table.capacity,
    guide: table.members[0]
      ? { userId: table.members[0].userId, name: table.members[0].user.name || table.members[0].user.email }
      : null,
    createdAt: table.createdAt.toISOString(),
    updatedAt: table.updatedAt.toISOString(),
  }));
}

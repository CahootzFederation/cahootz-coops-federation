import type { Context } from "../context.js";

const CHATTING_WINDOW_MS = 90_000;

type PresenceDb = Pick<Context["db"], "circleChatPresence">;

export async function enterChat(db: PresenceDb, groupId: string, userId: string) {
  const now = new Date();
  await db.circleChatPresence.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId, enteredAt: now, lastActivityAt: now, exitedAt: null },
    update: { enteredAt: now, lastActivityAt: now, exitedAt: null },
  });
}

export async function refreshChatPresence(db: PresenceDb, groupId: string, userId: string) {
  // Best-effort: the row may already be gone (expired/exited) if this races
  // a leave or a long gap between heartbeats - nothing to refresh in that case.
  await db.circleChatPresence.updateMany({
    where: { groupId, userId },
    data: { lastActivityAt: new Date() },
  });
}

export async function leaveChat(db: PresenceDb, groupId: string, userId: string) {
  await db.circleChatPresence.updateMany({
    where: { groupId, userId },
    data: { exitedAt: new Date() },
  });
}

export async function getChattingCount(db: PresenceDb, groupId: string): Promise<number> {
  return db.circleChatPresence.count({
    where: {
      groupId,
      exitedAt: null,
      lastActivityAt: { gt: new Date(Date.now() - CHATTING_WINDOW_MS) },
    },
  });
}

/**
 * Batched chatting-count lookup for a list of circles (e.g. groups.listVisible),
 * avoiding one query per card.
 */
export async function getChattingCounts(
  db: PresenceDb,
  groupIds: string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();

  const rows = await db.circleChatPresence.groupBy({
    by: ["groupId"],
    where: {
      groupId: { in: groupIds },
      exitedAt: null,
      lastActivityAt: { gt: new Date(Date.now() - CHATTING_WINDOW_MS) },
    },
    _count: { _all: true },
  });

  return new Map(rows.map((r) => [r.groupId, r._count._all]));
}

import { db } from "@repo/db";

import { enqueueSageRideMatchDetect, enqueueSageTrendDetect } from "./sage-dispatch.js";

export const CIRCLE_WINDOW_MESSAGE_LIMIT = 40;

/** Open/extend the current analysis window for a circle, or close it once it hits the message cap.
 * Serialized per circle with a transaction-scoped advisory lock: without it, two messages arriving
 * together each create an OPEN window, the count splits between them, and neither ever closes. */
export async function touchCircleWindow(groupId: string, coopId: string): Promise<void> {
  const closedWindowId = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`circle-window:${groupId}`}))`;
    const now = new Date();
    const open = await tx.circleAgentWindow.findFirst({ where: { groupId, status: "OPEN" }, orderBy: { openedAt: "asc" } });
    if (!open) {
      await tx.circleAgentWindow.create({ data: { groupId, coopId, openedAt: now, lastMessageAt: now, messageCount: 1 } });
      return null;
    }
    const messageCount = open.messageCount + 1;
    if (messageCount >= CIRCLE_WINDOW_MESSAGE_LIMIT) {
      await tx.circleAgentWindow.update({ where: { id: open.id }, data: { messageCount, lastMessageAt: now, status: "CLOSED", closedAt: now } });
      return open.id;
    }
    await tx.circleAgentWindow.update({ where: { id: open.id }, data: { messageCount, lastMessageAt: now } });
    return null;
  });
  // Dispatch after commit so detection never reads a window that isn't CLOSED yet.
  if (closedWindowId) {
    await enqueueSageRideMatchDetect(closedWindowId);
    await enqueueSageTrendDetect(closedWindowId);
  }
}

/** Closes a circle's open window now, before it reaches the message cap, so Sage reads what's there.
 * Used by the platform admin's "Analyze this circle now". Returns null when there is nothing new. */
export async function closeCircleWindowNow(groupId: string): Promise<{ windowId: string; messageCount: number } | null> {
  const closed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`circle-window:${groupId}`}))`;
    const open = await tx.circleAgentWindow.findFirst({ where: { groupId, status: "OPEN" }, orderBy: { openedAt: "asc" } });
    if (!open || open.messageCount < 1) return null;
    const now = new Date();
    await tx.circleAgentWindow.update({ where: { id: open.id }, data: { status: "CLOSED", closedAt: now, lastMessageAt: now } });
    return { windowId: open.id, messageCount: open.messageCount };
  });
  if (closed) {
    await enqueueSageRideMatchDetect(closed.windowId);
    await enqueueSageTrendDetect(closed.windowId);
  }
  return closed;
}

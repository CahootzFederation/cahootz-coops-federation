import { db } from "@repo/db";

import { enqueueSageRideMatchDetect, enqueueSageTrendDetect } from "./sage-dispatch.js";

export const CIRCLE_WINDOW_MESSAGE_LIMIT = 40;

/** Open/extend the current analysis window for a circle, or close it once it hits the message cap. */
export async function touchCircleWindow(groupId: string, coopId: string): Promise<void> {
  const now = new Date();
  const open = await db.circleAgentWindow.findFirst({ where: { groupId, status: "OPEN" } });
  if (!open) {
    await db.circleAgentWindow.create({ data: { groupId, coopId, openedAt: now, lastMessageAt: now, messageCount: 1 } });
    return;
  }
  const messageCount = open.messageCount + 1;
  if (messageCount >= CIRCLE_WINDOW_MESSAGE_LIMIT) {
    await db.circleAgentWindow.update({ where: { id: open.id }, data: { messageCount, lastMessageAt: now, status: "CLOSED", closedAt: now } });
    await enqueueSageRideMatchDetect(open.id);
    await enqueueSageTrendDetect(open.id);
    return;
  }
  await db.circleAgentWindow.update({ where: { id: open.id }, data: { messageCount, lastMessageAt: now } });
}

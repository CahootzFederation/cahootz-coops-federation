import { logger, schedules } from "@trigger.dev/sdk";
import { db } from "../../../../packages/db/index.js";
import { createNotificationAndPush } from "../../../../packages/trpc/src/services/push-notification-service.js";

const REMINDER_WINDOW_MINUTES = 10;

// Sweeps for events starting within the reminder window and pushes a
// "starts in N minutes" notification to each GOING attendee who hasn't
// muted reminders for that event, once per event/user.
export const eventReminderSweep = schedules.task({
  id: "event-reminder-sweep",
  cron: "*/5 * * * *",
  maxDuration: 300,
  run: async () => {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60000);

    const events = await db.event.findMany({
      where: { startAt: { gte: now, lte: windowEnd } },
      include: {
        post: { select: { title: true } },
        rsvps: { where: { status: "GOING" }, select: { userId: true } },
        reminders: { select: { userId: true, muted: true, sentAt: true } },
      },
    });

    for (const event of events) {
      const reminderByUser = new Map(event.reminders.map((r) => [r.userId, r]));
      for (const rsvp of event.rsvps) {
        const reminder = reminderByUser.get(rsvp.userId);
        if (reminder?.muted || reminder?.sentAt) continue;

        try {
          await createNotificationAndPush(db, {
            userId: rsvp.userId,
            coopId: event.coopId,
            type: "EVENT_REMINDER",
            title: event.post.title,
            body: `Starts in ${REMINDER_WINDOW_MINUTES} minutes`,
            data: { eventId: event.id, coopId: event.coopId },
          });

          await db.eventReminder.upsert({
            where: { eventId_userId: { eventId: event.id, userId: rsvp.userId } },
            create: { eventId: event.id, userId: rsvp.userId, sentAt: new Date() },
            update: { sentAt: new Date() },
          });
        } catch (error) {
          logger.error("Event reminder push failed", {
            eventId: event.id,
            userId: rsvp.userId,
            error: String(error),
          });
        }
      }
    }

    logger.info("Event reminder sweep completed", { eventsChecked: events.length });
  },
});

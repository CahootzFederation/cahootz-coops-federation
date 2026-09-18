import type { NotificationPreferences } from "@repo/validators/notification";
import {
  defaultNotificationPreferences,
  notificationCategory,
} from "@repo/validators/notification";

type PushPayload = {
  userId: string;
  coopId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type DbClient = {
  notification: {
    create: (args: any) => Promise<any>;
  };
  notificationPreference: {
    findUnique: (args: {
      where: { userId: string };
    }) => Promise<NotificationPreferences | null>;
  };
  pushDevice: {
    findMany: (args: any) => Promise<Array<{ expoPushToken: string }>>;
  };
};

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function createNotificationAndPush(
  db: DbClient,
  payload: PushPayload,
) {
  const notification = await db.notification.create({
    data: {
      userId: payload.userId,
      coopId: payload.coopId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
    },
  });

  const logContext = { notificationId: notification.id, type: payload.type };
  console.info('[push] Inbox notification created', logContext);
  const preferences =
    (await db.notificationPreference.findUnique({
      where: { userId: payload.userId },
    })) || defaultNotificationPreferences;
  if (
    !preferences.pushEnabled ||
    !preferences[notificationCategory(payload.type)]
  ) {
    console.info("[push] Skipped: account/category preference disabled", logContext);
    return;
  }

  const devices = await db.pushDevice.findMany({
    where: {
      userId: payload.userId,
      coopId: payload.coopId,
      enabled: true,
    },
    select: { expoPushToken: true },
  });

  console.info("[push] Matching enabled devices", { ...logContext, count: devices.length });
  if (!devices.length) return;

  const messages = devices.map((device) => ({
    to: device.expoPushToken,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: { ...payload.data, notificationId: notification.id },
    channelId: "commons",
  }));

  for (const batch of chunk(messages, 100)) {
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        console.warn("[push] Expo HTTP error", { ...logContext, status: response.status });
      }
      const result = (await response.json()) as {
        data?: Array<{
          status?: string;
          id?: string;
          details?: { error?: string };
        }>;
        errors?: Array<{ code?: string }>;
      };
      // Provider messages can contain device tokens; log only known error codes.
      const safeCode = (code?: string) =>
        [
          "DeviceNotRegistered",
          "InvalidCredentials",
          "MessageTooBig",
          "MessageRateExceeded",
          "MismatchSenderId",
          "UNAUTHORIZED",
          "PUSH_TOO_MANY_NOTIFICATIONS",
          "PUSH_TOO_MANY_EXPERIENCE_IDS",
        ].includes(code || "")
          ? code
          : "UnknownProviderError";
      for (const error of result.errors || [])
        console.warn("[push] Expo request rejected", {
          ...logContext,
          code: safeCode(error.code),
        });
      if (!response.ok) continue;
      for (const ticket of result.data || []) {
        if (ticket.status === "error")
          console.warn("[push] Expo ticket rejected", {
            ...logContext,
            code: safeCode(ticket.details?.error),
          });
        else if (ticket.status === "ok")
          console.info(
            "[push] Expo accepted notification (delivery not yet confirmed)",
            { ...logContext, receiptId: ticket.id },
          );
      }
    } catch {
      console.warn("[push] Expo request or response processing failed", logContext);
    }
  }
}

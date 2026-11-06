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
  /** Set false to write the inbox row without a phone push (e.g. a muted circle). */
  push?: boolean;
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
    findMany: (args: any) => Promise<Array<{ id?: string; expoPushToken: string }>>;
    updateMany?: (args: any) => Promise<unknown>;
  };
  pushTicket?: {
    createMany: (args: any) => Promise<unknown>;
  };
};

export const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";

const KNOWN_EXPO_ERRORS = [
  "DeviceNotRegistered",
  "InvalidCredentials",
  "MessageTooBig",
  "MessageRateExceeded",
  "MismatchSenderId",
  "UNAUTHORIZED",
  "PUSH_TOO_MANY_NOTIFICATIONS",
  "PUSH_TOO_MANY_EXPERIENCE_IDS",
  "ProviderError",
  "ExpoError",
  "DeveloperError",
];

/** Provider messages can contain device tokens; keep only known error codes. */
export function safeExpoErrorCode(code?: string) {
  if (!code) return "NoErrorCode";
  return KNOWN_EXPO_ERRORS.includes(code) ? code : "UnknownProviderError";
}

/**
 * The raw code for logs when it looks like a plain identifier, so a new Expo code
 * shows up by name. Anything else (a token, a sentence) is dropped.
 */
export function loggableExpoErrorCode(code?: string) {
  return code && /^[A-Za-z_]{1,40}$/.test(code) ? code : undefined;
}

/** Expo headers, with the access token when the project has push security turned on. */
export function expoPushHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (process.env.EXPO_ACCESS_TOKEN)
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return headers;
}

/** Turn off devices Apple/Google say no longer exist, so we stop sending to them. */
export async function disableDeadDevices(
  db: { pushDevice: { updateMany?: (args: any) => Promise<unknown> } },
  deviceIds: string[],
) {
  if (!deviceIds.length || !db.pushDevice.updateMany) return;
  try {
    await db.pushDevice.updateMany({
      where: { id: { in: deviceIds } },
      data: { enabled: false },
    });
    console.info("[push] Disabled unregistered devices", { count: deviceIds.length });
  } catch {
    console.warn("[push] Could not disable unregistered devices", { count: deviceIds.length });
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Writes the inbox row, pushes it when preferences allow, and returns the row. */
export async function createNotificationAndPush(
  db: DbClient,
  payload: PushPayload,
): Promise<{ id: string }> {
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
  if (payload.push === false) {
    console.info("[push] Skipped: muted by circle notification level", logContext);
    return notification;
  }
  const preferences =
    (await db.notificationPreference.findUnique({
      where: { userId: payload.userId },
    })) || defaultNotificationPreferences;
  if (
    !preferences.pushEnabled ||
    !preferences[notificationCategory(payload.type)]
  ) {
    console.info("[push] Skipped: account/category preference disabled", logContext);
    return notification;
  }

  // A phone belongs to the member, not to one Commons. The token is unique, so it
  // only remembers the Commons the member opened last; filtering on coopId here
  // silently dropped every push from their other Commons.
  const devices = await db.pushDevice.findMany({
    where: {
      userId: payload.userId,
      enabled: true,
    },
    select: { id: true, expoPushToken: true },
  });

  console.info("[push] Matching enabled devices", { ...logContext, count: devices.length });
  if (!devices.length) return notification;

  const messages = devices.map((device) => ({
    to: device.expoPushToken,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: { coopId: payload.coopId, ...payload.data, notificationId: notification.id, notificationType: payload.type },
    channelId: "commons",
  }));

  const tickets: Array<{ deviceId?: string; status: string; expoTicketId?: string; errorCode?: string }> = [];
  const deadDevices: string[] = [];
  for (const [batchIndex, batch] of chunk(messages, 100).entries()) {
    const batchDevices = devices.slice(batchIndex * 100, batchIndex * 100 + batch.length);
    const failBatch = (errorCode: string) =>
      batchDevices.forEach((device) => tickets.push({ deviceId: device.id, status: "ERROR", errorCode }));
    try {
      const response = await fetch(EXPO_PUSH_SEND_URL, {
        method: "POST",
        headers: expoPushHeaders(),
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
      for (const error of result.errors || [])
        console.warn("[push] Expo request rejected", {
          ...logContext,
          code: safeExpoErrorCode(error.code),
        });
      if (!response.ok || !result.data) {
        failBatch(result.errors?.[0]?.code ? safeExpoErrorCode(result.errors[0].code) : `HttpError${response.status ?? ""}`);
        continue;
      }
      // Expo returns one ticket per message, in the same order.
      result.data.forEach((ticket, index) => {
        const deviceId = batchDevices[index]?.id;
        if (ticket.status === "ok") {
          console.info(
            "[push] Expo accepted notification (delivery not yet confirmed)",
            { ...logContext, receiptId: ticket.id },
          );
          tickets.push({ deviceId, status: "PENDING", expoTicketId: ticket.id });
          return;
        }
        const code = safeExpoErrorCode(ticket.details?.error);
        console.warn("[push] Expo ticket rejected", {
          ...logContext,
          code,
          rawCode: loggableExpoErrorCode(ticket.details?.error),
        });
        tickets.push({ deviceId, status: "ERROR", errorCode: code });
        if (code === "DeviceNotRegistered" && deviceId) deadDevices.push(deviceId);
      });
    } catch {
      console.warn("[push] Expo request or response processing failed", logContext);
      failBatch("RequestFailed");
    }
  }

  await disableDeadDevices(db, deadDevices);
  if (db.pushTicket && tickets.length) {
    try {
      await db.pushTicket.createMany({
        data: tickets.map((ticket) => ({
          notificationId: notification.id,
          deviceId: ticket.deviceId ?? "unknown",
          coopId: payload.coopId,
          type: payload.type,
          status: ticket.status,
          expoTicketId: ticket.expoTicketId ?? null,
          errorCode: ticket.errorCode ?? null,
        })),
      });
    } catch {
      console.warn("[push] Could not record push results", logContext);
    }
  }
  return notification;
}

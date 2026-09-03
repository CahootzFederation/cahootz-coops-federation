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

export async function createNotificationAndPush(db: DbClient, payload: PushPayload) {
  await db.notification.create({
    data: {
      userId: payload.userId,
      coopId: payload.coopId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
    },
  });

  const devices = await db.pushDevice.findMany({
    where: {
      userId: payload.userId,
      coopId: payload.coopId,
      enabled: true,
    },
    select: { expoPushToken: true },
  });

  if (!devices.length) return;

  const messages = devices.map((device) => ({
    to: device.expoPushToken,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
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
        console.warn("Expo push send failed", response.status, await response.text());
      }
    } catch (error) {
      console.warn("Expo push send skipped", error);
    }
  }
}

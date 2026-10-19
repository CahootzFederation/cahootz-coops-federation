import { disableDeadDevices, expoPushHeaders, safeExpoErrorCode } from "./push-notification-service";
import { sendPushDeliveryAlert } from "./slack-notification-service";

export const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

/** Expo has receipts ready about 15 minutes after a send and keeps them for about a day. */
const RECEIPT_READY_MS = 15 * 60 * 1000;
const RECEIPT_EXPIRES_MS = 24 * 60 * 60 * 1000;
const RECEIPT_BATCH = 1000;

type TicketRow = {
  id: string;
  deviceId: string;
  coopId: string;
  type: string;
  status: string;
  expoTicketId: string | null;
  errorCode: string | null;
  createdAt: Date;
};

type ReceiptDb = {
  pushTicket: {
    findMany: (args: any) => Promise<TicketRow[]>;
    update: (args: any) => Promise<unknown>;
    updateMany: (args: any) => Promise<unknown>;
  };
  pushDevice: { updateMany?: (args: any) => Promise<unknown> };
};

export type PushFailureSummary = {
  total: number;
  byCode: Array<{ code: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  byCoop: Array<{ coopId: string; count: number }>;
};

function countBy<T>(rows: T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function summarizePushFailures(rows: TicketRow[]): PushFailureSummary {
  return {
    total: rows.length,
    byCode: countBy(rows, (row) => row.errorCode ?? "UnknownProviderError").map(([code, count]) => ({ code, count })),
    byType: countBy(rows, (row) => row.type).map(([type, count]) => ({ type, count })),
    byCoop: countBy(rows, (row) => row.coopId).map(([coopId, count]) => ({ coopId, count })),
  };
}

/**
 * Reads Expo delivery receipts for pushes Expo accepted, records whether Apple/Google
 * delivered them, turns off devices that no longer exist, then posts one Slack alert
 * covering every failed push not alerted on yet.
 */
export async function checkPushReceipts(db: ReceiptDb, now = new Date()) {
  const pending = await db.pushTicket.findMany({
    where: {
      status: "PENDING",
      createdAt: { lte: new Date(now.getTime() - RECEIPT_READY_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: RECEIPT_BATCH * 5,
  });

  let delivered = 0;
  let failed = 0;
  let expired = 0;
  let lookupFailed = false;
  for (let start = 0; start < pending.length; start += RECEIPT_BATCH) {
    const batch = pending.slice(start, start + RECEIPT_BATCH).filter((row) => row.expoTicketId);
    if (!batch.length) continue;
    let receipts: Record<string, { status?: string; details?: { error?: string } }>;
    try {
      const response = await fetch(EXPO_PUSH_RECEIPTS_URL, {
        method: "POST",
        headers: expoPushHeaders(),
        body: JSON.stringify({ ids: batch.map((row) => row.expoTicketId) }),
      });
      if (!response.ok) throw new Error(`Expo receipts HTTP ${response.status}`);
      receipts = ((await response.json()) as { data?: typeof receipts }).data ?? {};
    } catch {
      console.warn("[push] Could not read Expo receipts", { count: batch.length });
      lookupFailed = true;
      continue;
    }

    const deadDevices: string[] = [];
    for (const row of batch) {
      const receipt = receipts[row.expoTicketId!];
      if (!receipt) {
        // No receipt after a day means Expo dropped it; count it as a failure we can see.
        if (now.getTime() - row.createdAt.getTime() > RECEIPT_EXPIRES_MS) {
          expired += 1;
          await db.pushTicket.update({
            where: { id: row.id },
            data: { status: "ERROR", errorCode: "ReceiptMissing", checkedAt: now },
          });
        }
        continue;
      }
      if (receipt.status === "ok") {
        delivered += 1;
        await db.pushTicket.update({ where: { id: row.id }, data: { status: "DELIVERED", checkedAt: now } });
        continue;
      }
      failed += 1;
      const errorCode = safeExpoErrorCode(receipt.details?.error);
      if (errorCode === "DeviceNotRegistered") deadDevices.push(row.deviceId);
      await db.pushTicket.update({ where: { id: row.id }, data: { status: "ERROR", errorCode, checkedAt: now } });
    }
    await disableDeadDevices(db, deadDevices);
  }

  const unalerted = await db.pushTicket.findMany({
    where: { status: "ERROR", alertedAt: null },
    take: 5000,
  });
  const summary = summarizePushFailures(unalerted);
  let alerted = false;
  if (summary.total || lookupFailed) {
    alerted = await sendPushDeliveryAlert({
      checkedAt: now,
      summary,
      delivered,
      receiptLookupFailed: lookupFailed,
    });
    if (alerted && unalerted.length)
      await db.pushTicket.updateMany({
        where: { id: { in: unalerted.map((row) => row.id) } },
        data: { alertedAt: now },
      });
  }

  return { checked: pending.length, delivered, failed, expired, newFailures: summary.total, alerted, lookupFailed };
}

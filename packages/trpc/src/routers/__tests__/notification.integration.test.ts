import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  defaultNotificationPreferences,
  notificationCategories,
  notificationCategoryTypes,
} from "@repo/validators/notification";

import type { Context } from "../../context";
import { createNotificationAndPush } from "../../services/push-notification-service";
import { router } from "../../trpc";
import {
  legacyNotificationProcedures,
  notificationRouter,
} from "../notification";

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
// This suite creates a minimal schema in an explicitly selected, disposable local test DB.
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  ) {
    throw new Error(
      "Notification integration tests require a local database ending in _test",
    );
  }
}

describe.skipIf(!databaseUrl)(
  "notification integration (real PostgreSQL)",
  () => {
    const db = new PrismaClient({ datasourceUrl: databaseUrl });
    let ready = false;
    const caller = (
      token = "alert-test-session-a",
      extra: Record<string, string> = {},
    ) =>
      notificationRouter.createCaller({
        db,
        req: {
          headers: { ...(token ? { "x-session-token": token } : {}), ...extra },
        },
        res: {},
        coopId: undefined,
      } as Context);
    const createAlert = (
      id: string,
      userId = "alert-test-a",
      type = "MENTION",
      createdAt = new Date("2026-09-13T10:00:00.000Z"),
    ) =>
      db.notification.create({
        data: {
          id,
          userId,
          coopId: "cahootz",
          type,
          title: id,
          body: "Real test activity",
          createdAt,
        },
      });
    beforeAll(async () => {
      const tables = await db.$queryRaw<
        { name: string | null }[]
      >`SELECT to_regclass('public."NotificationPreference"')::text AS name`;
      if (!tables[0]?.name) {
        const baseline = readFileSync(
          new URL("./fixtures/notifications-baseline.sql", import.meta.url),
          "utf8",
        );
        const migration = readFileSync(
          new URL(
            "../../../../db/prisma/migrations/20260913000000_notification_preferences/migration.sql",
            import.meta.url,
          ),
          "utf8",
        );
        for (const statement of `${baseline}\n${migration}`
          .split(";")
          .filter((s) => s.trim()))
          await db.$executeRawUnsafe(statement);
      }
      ready = true;
    });
    beforeEach(async () => {
      await db.session.deleteMany({
        where: { userId: { startsWith: "alert-test-" } },
      });
      await db.user.deleteMany({
        where: { id: { startsWith: "alert-test-" } },
      });
      await db.$executeRaw`INSERT INTO "User" (id, email) VALUES ('alert-test-a', 'a@alerts.test'), ('alert-test-b', 'b@alerts.test')`;
      await db.session.createMany({
        data: ["a", "b"].map((id) => ({
          userId: `alert-test-${id}`,
          token: `alert-test-session-${id}`,
          ipAddress: "127.0.0.1",
          expiresAt: new Date(Date.now() + 3600000),
        })),
      });
    });
    afterEach(() => vi.unstubAllGlobals());
    afterAll(async () => {
      if (!ready) {
        await db.$disconnect();
        return;
      }
      await db.session.deleteMany({
        where: { userId: { startsWith: "alert-test-" } },
      });
      await db.user.deleteMany({
        where: { id: { startsWith: "alert-test-" } },
      });
      await db.$disconnect();
    });

    it("rejects wallet-only and missing sessions", async () => {
      for (const c of [
        caller(""),
        caller("", { "x-wallet-address": `0x${"a".repeat(40)}` }),
      ]) {
        await expect(c.getNotifications({})).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        await expect(c.getPreferences()).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        await expect(
          c.updatePreferences({ pushEnabled: false }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await expect(c.markAllAsRead()).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
    });
    it("rejects expired and revoked sessions", async () => {
      await db.session.update({
        where: { token: "alert-test-session-a" },
        data: { expiresAt: new Date(0) },
      });
      await expect(caller().getNotifications({})).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await db.session.update({
        where: { token: "alert-test-session-b" },
        data: { isRevoked: true },
      });
      await expect(
        caller("alert-test-session-b").getPreferences(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
    it("rejects suspended and deleted accounts", async () => {
      await db.$executeRaw`UPDATE "User" SET status = 'SUSPENDED' WHERE id = 'alert-test-a'`;
      await expect(caller().getNotifications({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await db.$executeRaw`UPDATE "User" SET "deletedAt" = NOW() WHERE id = 'alert-test-b'`;
      await expect(
        caller("alert-test-session-b").getPreferences(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("allows wallet-free accounts and isolates data even with a conflicting wallet header", async () => {
      await createAlert("own");
      await createAlert("other", "alert-test-b");
      const page = await caller("alert-test-session-a", {
        "x-wallet-address": `0x${"b".repeat(40)}`,
      }).getNotifications({});
      expect(page.notifications.map((n) => n.id)).toEqual(["own"]);
      expect(page).toMatchObject({
        totalCount: 1,
        unreadCount: 1,
        nextCursor: null,
      });
      await expect(
        caller().markAsRead({ notificationId: "other" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        (await db.notification.findUniqueOrThrow({ where: { id: "other" } }))
          .read,
      ).toBe(false);
    });
    it("blocks ownership bypasses through legacy P2P notification routes", async () => {
      const legacy = (token = "alert-test-session-a") =>
        router(legacyNotificationProcedures).createCaller({
          db,
          req: { headers: { "x-session-token": token } },
          res: {},
          coopId: undefined,
        } as Context);
      await createAlert("own");
      await createAlert("other", "alert-test-b");
      await expect(
        legacy().getNotifications({ userId: "alert-test-b" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        legacy().markAllNotificationsRead({ userId: "alert-test-b" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        legacy().markNotificationRead({ notificationId: "other" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        legacy("").getNotifications({ userId: "alert-test-a" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(
        (
          await legacy().getNotifications({ userId: "alert-test-a" })
        ).notifications.map((n) => n.id),
      ).toEqual(["own"]);
      expect(
        await legacy().markAllNotificationsRead({ userId: "alert-test-a" }),
      ).toMatchObject({ success: true, count: 1 });
      expect(await caller("alert-test-session-b").getUnreadCount()).toEqual({
        count: 1,
      });
    });
    it("paginates equal timestamps without omissions or duplicates", async () => {
      for (const id of ["a", "b", "c", "d", "e"]) await createAlert(id);
      const first = await caller().getNotifications({ limit: 2 });
      const second = await caller().getNotifications({
        limit: 2,
        cursor: first.nextCursor!,
      });
      const third = await caller().getNotifications({
        limit: 2,
        cursor: second.nextCursor!,
      });
      expect(
        [
          ...first.notifications,
          ...second.notifications,
          ...third.notifications,
        ].map((n) => n.id),
      ).toEqual(["e", "d", "c", "b", "a"]);
      expect(first.nextCursor?.id).toBe("d");
      expect(third.nextCursor).toBeNull();
    });
    it("keeps cursor boundaries valid when the last returned row is deleted", async () => {
      for (const id of ["a", "b", "c"]) await createAlert(id);
      const first = await caller().getNotifications({ limit: 1 });
      await db.notification.delete({ where: { id: "c" } });
      expect(
        (
          await caller().getNotifications({ cursor: first.nextCursor! })
        ).notifications.map((n) => n.id),
      ).toEqual(["b", "a"]);
    });
    it("filters categories and unread status on the server; unknown types remain visible", async () => {
      await createAlert("community");
      await createAlert("payment", undefined, "PAYMENT_RECEIVED");
      await createAlert("unknown", undefined, "FUTURE_EVENT");
      await caller().markAsRead({ notificationId: "community" });
      expect(
        (
          await caller().getNotifications({
            category: "community",
            unreadOnly: true,
          })
        ).totalCount,
      ).toBe(0);
      expect(
        (
          await caller().getNotifications({ category: "payments" })
        ).notifications.map((n) => n.id),
      ).toEqual(["payment"]);
      expect(
        (
          await caller().getNotifications({ category: "other" })
        ).notifications.map((n) => n.id),
      ).toEqual(["unknown"]);
    });
    it("persists individual and all-read state across callers, without affecting another user", async () => {
      await createAlert("one");
      await createAlert("two");
      await createAlert("other", "alert-test-b");
      await caller().markAsRead({ notificationId: "one" });
      expect(await caller().getUnreadCount()).toEqual({ count: 1 });
      await caller().markAllAsRead();
      expect(await caller().getUnreadCount()).toEqual({ count: 0 });
      expect(await caller("alert-test-session-b").getUnreadCount()).toEqual({
        count: 1,
      });
    });
    it("returns enabled defaults and persists partial, account-wide preferences", async () => {
      expect(await caller().getPreferences()).toEqual(
        defaultNotificationPreferences,
      );
      await caller().updatePreferences({ community: false });
      await caller().updatePreferences({ pushEnabled: false });
      expect(await caller().getPreferences()).toEqual({
        ...defaultNotificationPreferences,
        community: false,
        pushEnabled: false,
      });
      expect(await caller("alert-test-session-b").getPreferences()).toEqual(
        defaultNotificationPreferences,
      );
    });
    it("rejects invalid preferences, injected user IDs, and malformed cursors", async () => {
      await expect(
        caller().updatePreferences({ userId: "alert-test-b" } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller().updatePreferences({ pushEnabled: "yes" } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller().getNotifications({ cursor: { id: "x", createdAt: "bad" } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
    it("registering a token again never resets disabled preferences", async () => {
      await caller().updatePreferences({ pushEnabled: false, payments: false });
      await caller().registerPushDevice({
        expoPushToken: "ExponentPushToken[test-a]",
        platform: "ios",
      });
      await caller().registerPushDevice({
        expoPushToken: "ExponentPushToken[test-a]",
        platform: "ios",
      });
      expect(await caller().getPreferences()).toMatchObject({
        pushEnabled: false,
        payments: false,
      });
    });
    it.each(notificationCategories)(
      "suppresses disabled %s push while preserving the inbox",
      async (category) => {
        await caller().registerPushDevice({
          expoPushToken: "ExponentPushToken[test-a]",
          platform: "ios",
        });
        await caller().updatePreferences({ [category]: false });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchMock);
        const type =
          category === "other"
            ? "FUTURE_EVENT"
            : notificationCategoryTypes[category][0];
        await createNotificationAndPush(db, {
          userId: "alert-test-a",
          coopId: "cahootz",
          type,
          title: "Test",
          body: "Test",
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect((await caller().getNotifications({})).totalCount).toBe(1);
      },
    );
    it("master switch suppresses all push and enabled defaults deliver only to active account devices", async () => {
      await caller().registerPushDevice({
        expoPushToken: "ExponentPushToken[test-a]",
        platform: "ios",
      });
      await caller("alert-test-session-b").registerPushDevice({
        expoPushToken: "ExponentPushToken[test-b]",
        platform: "ios",
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      const payload = {
        userId: "alert-test-a",
        coopId: "cahootz",
        type: "MENTION",
        title: "Test",
        body: "Test",
      };
      await createNotificationAndPush(db, payload);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const messages = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(messages).toHaveLength(1);
      expect(messages[0].to).toBe("ExponentPushToken[test-a]");
      expect(messages[0].data.notificationId).toBeTruthy();
      await caller().updatePreferences({ pushEnabled: false });
      await createNotificationAndPush(db, payload);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await caller().getNotifications({})).totalCount).toBe(2);
    });
    it("push transport failures do not discard the activity record", async () => {
      await caller().registerPushDevice({
        expoPushToken: "ExponentPushToken[test-a]",
        platform: "ios",
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      await createNotificationAndPush(db, {
        userId: "alert-test-a",
        coopId: "cahootz",
        type: "MENTION",
        title: "Test",
        body: "Test",
      });
      expect((await caller().getNotifications({})).totalCount).toBe(1);
    });
  },
);

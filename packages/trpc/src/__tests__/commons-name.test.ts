import { describe, expect, it, vi } from "vitest";

vi.mock("../services/push-notification-service.js", () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue({ id: "notification_1" }),
}));
vi.mock("../lib/email.js", () => ({
  isEmailConfigured: vi.fn().mockReturnValue(false),
  sendCommonsInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/sms.js", () => ({
  sendCommonsInvitationSMS: vi.fn().mockResolvedValue({ success: false }),
}));

import {
  assertCommonsNameAvailable,
  cleanCommonsName,
  commonsNameKey,
} from "../lib/commons-name.js";
import { createFamilyCommons } from "../services/commons-invitations.js";

function makeTx(taken: { id: string } | null = null) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    coopConfig: {
      findFirst: vi.fn().mockResolvedValue(taken),
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    userCoopMembership: {
      upsert: vi.fn().mockResolvedValue({ id: "membership_1" }),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "membership_1" }),
    },
    commonsPost: { create: vi.fn().mockResolvedValue({ id: "post_1" }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as any;
}

describe("commons names", () => {
  it("compares names ignoring case and extra spaces", () => {
    expect(cleanCommonsName("  Grandma   Mae's  Crew ")).toBe("Grandma Mae's Crew");
    expect(commonsNameKey("The  ROBINSON family")).toBe(commonsNameKey("the robinson Family"));
  });

  it("allows a name no active commons uses", async () => {
    const tx = makeTx(null);
    await expect(assertCommonsNameAvailable(tx, "Sunday Dinner")).resolves.toBeUndefined();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.coopConfig.findFirst).toHaveBeenCalledWith({
      where: { isActive: true, name: { equals: "Sunday Dinner", mode: "insensitive" } },
      select: { id: true },
    });
  });

  it("rejects a name another commons already uses, whatever its case", async () => {
    const tx = makeTx({ id: "config_1" });
    await expect(assertCommonsNameAvailable(tx, "sunday  dinner")).rejects.toMatchObject({
      code: "CONFLICT",
      message: 'The name "sunday dinner" is already taken. Try another one.',
    });
  });

  it("lets a commons keep its own name", async () => {
    const tx = makeTx(null);
    await assertCommonsNameAvailable(tx, "Sunday Dinner", { exceptCoopId: "family-abc" });
    expect(tx.coopConfig.findFirst.mock.calls[0][0].where.coopId).toEqual({ not: "family-abc" });
  });

  it("won't start a family under a name that's already taken", async () => {
    const tx = makeTx({ id: "config_1" });
    const db = { ...tx, $transaction: (fn: (tx: any) => Promise<unknown>) => fn(tx) };

    await expect(
      createFamilyCommons(db, {
        user: { id: "user_a" } as any,
        name: "The Robinson Family",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.coopConfig.create).not.toHaveBeenCalled();
  });

  it("starts a family under a free name, with spacing tidied", async () => {
    const tx = makeTx(null);
    const db = { ...tx, $transaction: (fn: (tx: any) => Promise<unknown>) => fn(tx) };

    await createFamilyCommons(db, { user: { id: "user_a" } as any, name: "  Big Mama's   House " });
    expect(tx.coopConfig.create.mock.calls[0][0].data.name).toBe("Big Mama's House");
  });
});

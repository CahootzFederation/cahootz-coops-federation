import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/push-notification-service.js", () => ({
  createNotificationAndPush: vi.fn().mockResolvedValue({ id: "notification_1" }),
}));

import { createNotificationAndPush } from "../services/push-notification-service.js";
import { getFamilySetup, updateFamilySetup } from "../services/commons-invitations.js";

const STEWARD = { id: "user_a", name: "Maya", handle: "maya" } as any;

function config(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg_1",
    coopId: "family-abc",
    version: 1,
    name: "Robinson Family",
    joinPolicy: "INVITE_ONLY",
    createdBy: "user:user_a",
    displayMission: null,
    charterText: "# Robinson Family family agreement",
    missionGoals: [
      { key: "stay_connected", label: "Stay connected", priorityWeight: 0.5 },
      { key: "support_each_other", label: "Support each other", priorityWeight: 0.5 },
    ],
    votingWindowDays: 7,
    approvalThresholdPercent: 51,
    quorumPercent: 15,
    familySetup: null,
    ...overrides,
  };
}

function makeDb(options: {
  config?: Record<string, unknown>;
  myRoles?: string[];
  members?: { status: string; roles: string[] }[];
  updatedCount?: number;
} = {}) {
  const db: any = {
    coopConfig: {
      findFirst: vi.fn().mockResolvedValue(config(options.config)),
      updateMany: vi.fn().mockResolvedValue({ count: options.updatedCount ?? 1 }),
    },
    userCoopMembership: {
      findUnique: vi.fn().mockResolvedValue({
        id: "m_a",
        status: "ACTIVE",
        roles: options.myRoles ?? ["member", "steward"],
      }),
      findMany: vi.fn().mockImplementation(({ select }: { select?: Record<string, unknown> }) =>
        Promise.resolve(
          select?.userId
            ? []
            : (options.members ?? [{ status: "ACTIVE", roles: ["member", "steward"] }]),
        ),
      ),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ name: "Maya", handle: "maya" }) },
    coopConfigAudit: {
      findFirst: vi.fn().mockResolvedValue({ sequence: 2 }),
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  db.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(db));
  return db;
}

const SETUP = {
  mission: "Keep the house in the family.",
  goals: [{ label: "Pay off the house", targetAmountUSD: 6000, targetMonths: 12 }],
  votingWindowDays: 3 as const,
  approval: "TWO_THIRDS" as const,
  houseRules: ["Call Grandma on Sundays."],
};

describe("editing a family's setup", () => {
  beforeEach(() => vi.mocked(createNotificationAndPush).mockClear());

  it("shows an older family as not set up, without its placeholder goals", async () => {
    const result = await getFamilySetup(makeDb(), { coopId: "family-abc", user: STEWARD });
    expect(result).toMatchObject({ canEdit: true, isSetUp: false, lockedReason: null });
    expect(result.setup.goals).toEqual([]);
  });

  it("lets a steward change it while everyone is a steward, and records the change", async () => {
    const db = makeDb({
      members: [
        { status: "ACTIVE", roles: ["member", "steward"] },
        { status: "ACTIVE", roles: ["member", "steward"] },
      ],
    });
    const result = await updateFamilySetup(db, { coopId: "family-abc", user: STEWARD, setup: SETUP });

    expect(result.changed).toBe(true);
    const saved = db.coopConfig.updateMany.mock.calls[0][0];
    expect(saved.where).toEqual({ id: "cfg_1", version: 1 });
    expect(saved.data).toMatchObject({
      version: 2,
      displayMission: "Keep the house in the family.",
      votingWindowDays: 3,
      approvalThresholdPercent: 67,
      quorumPercent: 50,
      familySetup: SETUP,
    });
    expect(saved.data.missionGoals).toHaveLength(1);
    expect(saved.data.charterText).toContain("1. Pay off the house (100%): $6,000 within 1 year");
    expect(saved.data.charterText).toContain("Maya started Robinson Family");
    expect(saved.data.charterText).toContain("Call Grandma on Sundays.");

    const audit = db.coopConfigAudit.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ changedBy: "user:user_a", sequence: 3, status: "APPLIED", section: "familySetup" });
    expect(audit.diff.map((entry: { field: string }) => entry.field)).toContain("missionGoals");
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("is locked once anyone in the family isn't a steward", async () => {
    const db = makeDb({
      members: [
        { status: "ACTIVE", roles: ["member", "steward"] },
        { status: "ACTIVE", roles: ["member"] },
      ],
    });
    const view = await getFamilySetup(db, { coopId: "family-abc", user: STEWARD });
    expect(view).toMatchObject({ canEdit: false, nonStewards: 1 });
    expect(view.lockedReason).toContain("1 person here isn't a steward");

    await expect(
      updateFamilySetup(db, { coopId: "family-abc", user: STEWARD, setup: SETUP }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.coopConfig.updateMany).not.toHaveBeenCalled();
    expect(db.coopConfigAudit.create).not.toHaveBeenCalled();
  });

  it("only lets stewards read or change it", async () => {
    const db = makeDb({ myRoles: ["member"] });
    await expect(getFamilySetup(db, { coopId: "family-abc", user: STEWARD })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      updateFamilySetup(db, { coopId: "family-abc", user: STEWARD, setup: SETUP }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only edits families", async () => {
    const db = makeDb({ config: { coopId: "e2e-market", joinPolicy: "APPLICATION_REQUIRED" } });
    await expect(
      updateFamilySetup(db, { coopId: "e2e-market", user: STEWARD, setup: SETUP }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a save that raced another steward's", async () => {
    const db = makeDb({ updatedCount: 0 });
    await expect(
      updateFamilySetup(db, { coopId: "family-abc", user: STEWARD, setup: SETUP }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

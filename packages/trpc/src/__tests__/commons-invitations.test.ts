import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { hashInvitationToken } from "../lib/invitation-token.js";
import {
  acceptCommonsInvitation,
  createCommonsInvitation,
  invitationCopy,
} from "../services/commons-invitations.js";
import {
  effectiveInvitationStatus,
  getInvitationPurpose,
  invitationContactMatch,
  invitationMatchesPolicy,
  removeCommonsMember,
  reviewCommonsApplication,
} from "../services/commons-membership.js";

const FAMILY = {
  coopId: "family-abc",
  name: "Robinson Family",
  slug: "family-abc",
  tagline: null,
  description: "Our family",
  displayMission: null,
  iconEmoji: "🏡",
  iconColor: null,
  isPrivate: true,
  joinPolicy: "INVITE_ONLY",
  charterText: "# Rules",
};

const INVITEE = {
  id: "user_b",
  email: "Cousin@Example.com",
  name: "Cousin",
  handle: "cousin",
  phone: "+15105550100",
};

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    coopId: FAMILY.coopId,
    inviterId: "user_a",
    inviter: { name: "Maya", handle: "maya" },
    purpose: "DIRECT_JOIN",
    recipientEmailNormalized: "cousin@example.com",
    recipientPhoneNormalized: null,
    recipientName: "Cousin",
    message: null,
    tokenHash: hashInvitationToken("t".repeat(43)),
    status: "PENDING",
    expiresAt: new Date(Date.now() + 86_400_000),
    acceptedByUserId: null,
    ...overrides,
  };
}

function makeDb(options: {
  policy?: Record<string, unknown>;
  invitation?: Record<string, unknown> | null;
  membership?: { id: string; status: string; roles: string[] } | null;
  memberships?: Record<string, { id: string; status: string; roles: string[] }>;
  claimCount?: number;
} = {}) {
  const policy = { ...FAMILY, ...options.policy };
  const db: any = {
    coopConfig: {
      findFirst: vi.fn().mockResolvedValue(policy),
      count: vi.fn().mockResolvedValue(0),
    },
    commonsInvitation: {
      findUnique: vi.fn().mockResolvedValue(options.invitation === undefined ? invitation() : options.invitation),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }: any) => ({ id: "inv_new", ...data })),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: options.claimCount ?? 1 }),
    },
    userCoopMembership: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { userId, coopId } = where.userId_coopId;
        if (options.memberships) return options.memberships[`${userId}:${coopId}`] ?? null;
        return coopId === FAMILY.coopId ? options.membership ?? null : { id: "m_c", status: "ACTIVE", roles: ["member"] };
      }),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({ id: "m_new", status: "ACTIVE", roles: ["member"] }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    application: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "app_1" }),
      update: vi.fn().mockResolvedValue({ id: "app_1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    commonsPost: { findFirst: vi.fn().mockResolvedValue({ id: "post_welcome" }) },
    groupMember: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  db.$transaction = vi.fn(async (callback: any) => callback(db));
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("commons join policy rules", () => {
  it("maps each policy to the only invitation it can issue", () => {
    expect(getInvitationPurpose("APPLICATION_REQUIRED", true)).toBe("APPLY");
    expect(getInvitationPurpose("APPLICATION_REQUIRED", false)).toBe("APPLY");
    expect(getInvitationPurpose("INVITE_ONLY", true)).toBe("DIRECT_JOIN");
    expect(getInvitationPurpose("INVITE_ONLY", false)).toBe("REQUEST_ACCESS");
    expect(() => getInvitationPurpose("AUTOMATIC", true)).toThrow(/automatically/);
  });

  it("never lets a referral admit anyone after a policy change", () => {
    expect(invitationMatchesPolicy("APPLY", "APPLICATION_REQUIRED")).toBe(true);
    expect(invitationMatchesPolicy("APPLY", "INVITE_ONLY")).toBe(false);
    expect(invitationMatchesPolicy("DIRECT_JOIN", "APPLICATION_REQUIRED")).toBe(false);
    expect(invitationMatchesPolicy("REQUEST_ACCESS", "INVITE_ONLY")).toBe(true);
  });

  it("treats an email match as verified and a phone match as unverified", () => {
    expect(invitationContactMatch(invitation() as any, INVITEE)).toBe("EMAIL");
    expect(
      invitationContactMatch(
        invitation({ recipientEmailNormalized: null, recipientPhoneNormalized: "+15105550100" }) as any,
        INVITEE,
      ),
    ).toBe("PHONE");
    expect(invitationContactMatch(invitation() as any, { email: "other@example.com", phone: null })).toBeNull();
  });

  it("reports a pending invitation past its expiry as expired", () => {
    expect(effectiveInvitationStatus({ status: "PENDING", expiresAt: new Date(Date.now() - 1) })).toBe("EXPIRED");
    expect(effectiveInvitationStatus({ status: "ACCEPTED", expiresAt: new Date(Date.now() - 1) })).toBe("ACCEPTED");
  });
});

describe("acceptCommonsInvitation", () => {
  const token = "t".repeat(43);

  it("admits a named family invitee whose signed-in email matches", async () => {
    const db = makeDb();
    const result = await acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: true });

    expect(result).toEqual({ outcome: "JOINED", coopId: FAMILY.coopId, welcomePostId: "post_welcome" });
    expect(db.commonsInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inv_1", status: "PENDING" }),
        data: expect.objectContaining({ status: "ACCEPTED", acceptedByUserId: INVITEE.id }),
      }),
    );
    expect(db.userCoopMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ coopId: FAMILY.coopId, status: "ACTIVE" }) }),
    );
  });

  it("requires the family's rules to be accepted", async () => {
    const db = makeDb();
    await expect(acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: false })).rejects.toThrow(/rules/);
    expect(db.userCoopMembership.upsert).not.toHaveBeenCalled();
  });

  it("is single use: a second claim of the same invitation fails", async () => {
    const db = makeDb({ claimCount: 0 });
    await expect(acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: true })).rejects.toThrow(
      /already been used/,
    );
    expect(db.userCoopMembership.upsert).not.toHaveBeenCalled();
  });

  it("sends an unverified phone match to steward review instead of admitting", async () => {
    const db = makeDb({
      invitation: invitation({ recipientEmailNormalized: null, recipientPhoneNormalized: INVITEE.phone }),
    });
    const result = await acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: true });

    expect(result).toMatchObject({ outcome: "REQUESTED", reason: "UNVERIFIED_PHONE" });
    expect(db.userCoopMembership.upsert).not.toHaveBeenCalled();
    expect(db.application.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestType: "ACCESS_REQUEST", status: "SUBMITTED", invitationId: "inv_1" }),
      select: { id: true },
    });
  });

  it("sends someone signed in with a different email to steward review", async () => {
    const db = makeDb();
    const result = await acceptCommonsInvitation(db, {
      user: { ...INVITEE, email: "stranger@example.com", phone: null },
      token,
      acceptRules: true,
    });
    expect(result).toMatchObject({ outcome: "REQUESTED", reason: "CONTACT_MISMATCH" });
    expect(db.userCoopMembership.upsert).not.toHaveBeenCalled();
  });

  it("only lets a shareable link request access", async () => {
    const db = makeDb({
      invitation: invitation({ purpose: "REQUEST_ACCESS", recipientEmailNormalized: null }),
    });
    const result = await acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: true });
    expect(result).toMatchObject({ outcome: "REQUESTED", reason: "SHARE_LINK" });
    expect(db.userCoopMembership.upsert).not.toHaveBeenCalled();
  });

  it("turns a normal commons invitation into an application, never a membership", async () => {
    const db = makeDb({
      policy: { joinPolicy: "APPLICATION_REQUIRED", isPrivate: false },
      invitation: invitation({ purpose: "APPLY" }),
    });
    const result = await acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: false });
    expect(result).toEqual({ outcome: "APPLY", coopId: FAMILY.coopId, invitationId: "inv_1" });
    expect(db.userCoopMembership.upsert).not.toHaveBeenCalled();
    expect(db.application.create).not.toHaveBeenCalled();
  });

  it("rejects expired and revoked invitations", async () => {
    const expired = makeDb({ invitation: invitation({ expiresAt: new Date(Date.now() - 1000) }) });
    await expect(acceptCommonsInvitation(expired, { user: INVITEE, token, acceptRules: true })).rejects.toThrow(
      /expired/,
    );
    const revoked = makeDb({ invitation: invitation({ status: "REVOKED" }) });
    await expect(acceptCommonsInvitation(revoked, { user: INVITEE, token, acceptRules: true })).rejects.toThrow(
      /cancelled/,
    );
  });

  it("redirects an existing member instead of creating a second membership", async () => {
    const db = makeDb({ membership: { id: "m_1", status: "ACTIVE", roles: ["member"] } });
    const result = await acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: true });
    expect(result.outcome).toBe("ALREADY_MEMBER");
    expect(db.commonsInvitation.updateMany).not.toHaveBeenCalled();
  });

  it("never opens a recommendation that a steward hasn't approved", async () => {
    const db = makeDb({ invitation: invitation({ status: "PENDING_APPROVAL" }) });
    await expect(acceptCommonsInvitation(db, { user: INVITEE, token, acceptRules: true })).rejects.toThrow(
      /isn't valid/,
    );
  });
});

describe("invitationCopy", () => {
  const base = { inviterName: "Maya", commonsName: "Robinson Family" };

  it("tells existing account holders the invitation is waiting in the app", () => {
    const copy = invitationCopy({ ...base, purpose: "DIRECT_JOIN", hasAccount: true });
    expect(copy.heading).toBe("Maya invited you to join Robinson Family");
    expect(copy.emailSteps).toMatch(/^Open the Cahootz app\. Your invitation to join Robinson Family is waiting/);
    expect(copy.ctaLabel).toBe("Open on iOS");
  });

  it("tells new people to get the app and sign in with the invited email", () => {
    const copy = invitationCopy({ ...base, purpose: "DIRECT_JOIN", hasAccount: false });
    expect(copy.emailSteps).toMatch(/^Get the Cahootz app and sign in with this email address/);
    expect(copy.ctaLabel).toBe("Download for iOS");
  });

  it("never says anyone was added: a normal commons invitation is only to apply", () => {
    for (const hasAccount of [true, false]) {
      const copy = invitationCopy({ ...base, purpose: "APPLY", hasAccount });
      expect(copy.heading).toBe("Maya invited you to apply to Robinson Family");
      expect(copy.emailSteps).toMatch(/a steward reviews each application/);
      expect(`${copy.heading} ${copy.emailSteps}`).not.toMatch(/added/i);
    }
  });
});

describe("createCommonsInvitation", () => {
  const inviter = { id: "user_a", email: "maya@example.com", name: "Maya", handle: "maya", phone: null };

  it("holds an ordinary family member's invitation for a steward", async () => {
    const db = makeDb({ membership: { id: "m_a", status: "ACTIVE", roles: ["member"] } });
    const result = await createCommonsInvitation(db, {
      coopId: FAMILY.coopId,
      inviter,
      email: "cousin@example.com",
    });
    expect(result.status).toBe("PENDING_APPROVAL");
    expect(db.commonsInvitation.update).not.toHaveBeenCalled(); // never sent
  });

  it("sends a steward's family invitation right away", async () => {
    const db = makeDb({ membership: { id: "m_a", status: "ACTIVE", roles: ["member", "steward"] } });
    const result = await createCommonsInvitation(db, {
      coopId: FAMILY.coopId,
      inviter,
      email: "Cousin@Example.com",
    });
    expect(result.status).toBe("PENDING");
    expect(db.commonsInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: "DIRECT_JOIN",
        recipientEmailNormalized: "cousin@example.com",
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
  });

  it("refuses non-members and the automatic Cahootz Commons", async () => {
    await expect(
      createCommonsInvitation(makeDb({ membership: null }), { coopId: FAMILY.coopId, inviter, email: "x@example.com" }),
    ).rejects.toThrow(/Only members/);
    await expect(
      createCommonsInvitation(makeDb({ policy: { coopId: "cahootz", joinPolicy: "AUTOMATIC" } }), {
        coopId: "cahootz",
        inviter,
        email: "x@example.com",
      }),
    ).rejects.toThrow(/automatically/);
  });

  it("rate-limits invitations per inviter", async () => {
    const db = makeDb({ membership: { id: "m_a", status: "ACTIVE", roles: ["steward"] } });
    db.commonsInvitation.count.mockResolvedValue(25);
    await expect(
      createCommonsInvitation(db, { coopId: FAMILY.coopId, inviter, email: "cousin@example.com" }),
    ).rejects.toThrow(/lot of invitations/);
  });
});

describe("steward-only review and removal", () => {
  it("only lets a steward review a request", async () => {
    const db = makeDb({ membership: { id: "m_a", status: "ACTIVE", roles: ["member"] } });
    db.application.findUnique.mockResolvedValue({
      id: "app_1",
      userId: "user_b",
      coopId: FAMILY.coopId,
      status: "SUBMITTED",
      invitationId: null,
    });
    await expect(
      reviewCommonsApplication(db, { applicationId: "app_1", reviewerId: "user_a", decision: "APPROVE" }),
    ).rejects.toThrow(/steward/);
    expect(db.userCoopMembership.upsert).not.toHaveBeenCalled();
  });

  it("won't remove the last steward", async () => {
    const db = makeDb({
      memberships: {
        [`user_a:${FAMILY.coopId}`]: { id: "m_a", status: "ACTIVE", roles: ["member", "steward"] },
      },
    });
    db.userCoopMembership.findMany.mockResolvedValue([{ userId: "user_a" }]);
    await expect(
      removeCommonsMember(db, { coopId: FAMILY.coopId, stewardId: "user_a", userId: "user_a" }),
    ).rejects.toThrow(/someone else a steward/);
  });

  it("removes a member from the commons and its circles", async () => {
    const db = makeDb({
      memberships: {
        [`user_a:${FAMILY.coopId}`]: { id: "m_a", status: "ACTIVE", roles: ["member", "steward"] },
        [`user_b:${FAMILY.coopId}`]: { id: "m_b", status: "ACTIVE", roles: ["member"] },
      },
    });
    await removeCommonsMember(db, { coopId: FAMILY.coopId, stewardId: "user_a", userId: "user_b" });
    expect(db.userCoopMembership.update).toHaveBeenCalledWith({
      where: { id: "m_b" },
      data: { status: "INACTIVE", roles: ["member"] },
    });
    expect(db.groupMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_b", group: { coopId: FAMILY.coopId } },
    });
  });
});

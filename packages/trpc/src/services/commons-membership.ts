import { TRPCError } from "@trpc/server";

import type { Prisma } from "@repo/db";

import type { Context } from "../context.js";
import { auditLogEntry } from "../lib/audit.js";
import { COMMONS_COOP_ID, ensureCommonsMembership } from "../lib/commons.js";
import { createNotificationAndPush } from "./push-notification-service.js";

/**
 * Commons membership rules.
 *
 * Every commons has a join policy:
 *
 *   AUTOMATIC             Every account joins. Only the Cahootz Commons.
 *   APPLICATION_REQUIRED  Everyone applies and a steward reviews. An
 *                         invitation is a referral ("Maya invited you to
 *                         apply"), never admission.
 *   INVITE_ONLY           Private family commons. A named invitation sent by
 *                         a steward or guide to a verified email admits that
 *                         person.
 *                         Shareable links and unverified contacts only let
 *                         someone request access for a steward to review.
 *
 * Memberships are created here (createMembership) and nowhere else in the
 * invitation/application flows, so those rules hold in one place.
 */

type Db = Context["db"];
type Tx = Prisma.TransactionClient;

export type CommonsJoinPolicy =
  | "AUTOMATIC"
  | "APPLICATION_REQUIRED"
  | "INVITE_ONLY";
export type InvitationPurpose = "DIRECT_JOIN" | "APPLY" | "REQUEST_ACCESS";

/** Per-commons membership roles that may invite directly and review requests. */
export const STEWARD_ROLES = ["steward", "admin"];
/**
 * A guide may send invitations that go out directly (a family member's
 * invitation would otherwise wait for a steward), but can't review requests,
 * manage roles or remove anyone. Stewards assign it.
 */
export const GUIDE_ROLE = "guide";
export const INVITATION_TTL_DAYS = 14;
export const MAX_INVITATIONS_PER_DAY = 25;
export const MAX_ACCESS_REQUESTS_PER_DAY = 10;
export const MAX_FAMILIES_PER_DAY = 3;
/** A declined share-link request can't be re-sent for this long. */
export const DECLINED_REQUEST_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_APPLICATION_STATUSES = ["SUBMITTED", "UNDER_REVIEW"] as const;

export function invitationExpiry(now = new Date()) {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS);
}

export async function getCommonsPolicy(db: Tx | Db, coopId: string) {
  const config = await db.coopConfig.findFirst({
    where: { coopId, isActive: true },
    orderBy: { version: "desc" },
    select: {
      coopId: true,
      name: true,
      slug: true,
      tagline: true,
      description: true,
      displayMission: true,
      iconEmoji: true,
      iconColor: true,
      isPrivate: true,
      joinPolicy: true,
      charterText: true,
    },
  });

  if (!config) {
    if (coopId !== COMMONS_COOP_ID) return null;
    return {
      coopId,
      name: "Cahootz Commons",
      slug: "cahootz",
      tagline: null,
      description: null,
      displayMission: null,
      iconEmoji: null,
      iconColor: null,
      isPrivate: false,
      joinPolicy: "AUTOMATIC" as CommonsJoinPolicy,
      charterText: "",
    };
  }

  return {
    ...config,
    // The Cahootz Commons is automatic no matter what its row says, and
    // invite-only commons are never listed publicly.
    joinPolicy: (coopId === COMMONS_COOP_ID
      ? "AUTOMATIC"
      : config.joinPolicy) as CommonsJoinPolicy,
    isPrivate: config.isPrivate || config.joinPolicy === "INVITE_ONLY",
  };
}

export type CommonsPolicy = NonNullable<
  Awaited<ReturnType<typeof getCommonsPolicy>>
>;

export async function requireCommonsPolicy(db: Tx | Db, coopId: string) {
  const policy = await getCommonsPolicy(db, coopId);
  if (!policy) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commons not found." });
  }
  return policy;
}

/** Which kind of invitation a commons can issue. */
export function getInvitationPurpose(
  joinPolicy: CommonsJoinPolicy,
  recipientSpecific: boolean,
): InvitationPurpose {
  if (joinPolicy === "AUTOMATIC") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Everyone joins the Cahootz Commons automatically.",
    });
  }
  if (joinPolicy === "APPLICATION_REQUIRED") return "APPLY";
  return recipientSpecific ? "DIRECT_JOIN" : "REQUEST_ACCESS";
}

/**
 * Whether an invitation still makes sense under the commons' current policy
 * (a policy change after sending must not turn a referral into admission).
 */
export function invitationMatchesPolicy(
  purpose: InvitationPurpose,
  joinPolicy: CommonsJoinPolicy,
) {
  if (purpose === "APPLY") return joinPolicy === "APPLICATION_REQUIRED";
  return joinPolicy === "INVITE_ONLY";
}

export async function getMembership(
  db: Tx | Db,
  userId: string,
  coopId: string,
) {
  return db.userCoopMembership.findUnique({
    where: { userId_coopId: { userId, coopId } },
    select: { id: true, status: true, roles: true },
  });
}

export function isStewardMembership(
  membership: { status: string; roles: string[] } | null | undefined,
) {
  return (
    membership?.status === "ACTIVE" &&
    membership.roles.some((role) => STEWARD_ROLES.includes(role))
  );
}

export function isGuideMembership(
  membership: { status: string; roles: string[] } | null | undefined,
) {
  return membership?.status === "ACTIVE" && membership.roles.includes(GUIDE_ROLE);
}

/** Stewards and guides send invitations without a steward's approval. */
export function canInviteDirectlyMembership(
  membership: { status: string; roles: string[] } | null | undefined,
) {
  return isStewardMembership(membership) || isGuideMembership(membership);
}

export async function requireActiveMember(
  db: Tx | Db,
  userId: string,
  coopId: string,
) {
  const membership = await getMembership(db, userId, coopId);
  if (membership?.status !== "ACTIVE") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only members of this commons can do that.",
    });
  }
  return membership;
}

export async function requireSteward(
  db: Tx | Db,
  userId: string,
  coopId: string,
) {
  const membership = await getMembership(db, userId, coopId);
  if (!isStewardMembership(membership)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a steward of this commons can do that.",
    });
  }
  return membership!;
}

/**
 * The one place an invitation or application turns into a membership.
 * Idempotent: an existing ACTIVE membership is returned untouched (existing
 * members are redirected, never duplicated or demoted).
 */
export async function createMembership(
  tx: Tx,
  params: {
    coopId: string;
    userId: string;
    approvedBy: string;
    roles?: string[];
    method: "INVITATION" | "APPLICATION" | "CREATOR";
  },
) {
  const now = new Date();
  const existing = await getMembership(tx, params.userId, params.coopId);
  if (existing?.status === "ACTIVE") return { membership: existing, created: false };

  if (params.coopId !== COMMONS_COOP_ID) {
    await ensureCommonsMembership(tx, params.userId);
  }

  const roles = params.roles ?? ["member"];
  const membership = await tx.userCoopMembership.upsert({
    where: { userId_coopId: { userId: params.userId, coopId: params.coopId } },
    create: {
      userId: params.userId,
      coopId: params.coopId,
      status: "ACTIVE",
      roles,
      approvedBy: params.approvedBy,
      approvedAt: now,
      joinedAt: now,
      lastActiveAt: now,
    },
    update: {
      status: "ACTIVE",
      // A returning member starts over as an ordinary member.
      roles,
      approvedBy: params.approvedBy,
      approvedAt: now,
      joinedAt: now,
      lastActiveAt: now,
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: null,
    },
    select: { id: true, status: true, roles: true },
  });

  await tx.auditLog.create({
    data: auditLogEntry({
      actorId: params.approvedBy,
      action: "COMMONS_MEMBERSHIP_CREATED",
      resource: "UserCoopMembership",
      resourceId: membership.id,
      metadata: {
        coopId: params.coopId,
        userId: params.userId,
        method: params.method,
      },
    }),
  });

  return { membership, created: true };
}

/** A pinned "welcome" post in the commons' general feed, if it has one. */
export async function findCommonsWelcomePost(db: Tx | Db, coopId: string) {
  const post = await db.commonsPost.findFirst({
    where: {
      coopId,
      isPinned: true,
      OR: [{ circleId: null }, { circleId: `general:${coopId}` }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return post?.id ?? null;
}

type InvitationContact = {
  recipientEmailNormalized: string | null;
  recipientPhoneNormalized: string | null;
};

/**
 * How the signed-in account matches a named invitation. EMAIL is verified
 * (sign-in proves the address with a login code); PHONE is not, because
 * phone numbers are never verified in this app, so a phone match can only
 * ever lead to a steward-reviewed access request.
 */
export function invitationContactMatch(
  invitation: InvitationContact,
  user: { email: string; phone: string | null },
): "EMAIL" | "PHONE" | null {
  const email = user.email.trim().toLowerCase();
  if (
    invitation.recipientEmailNormalized &&
    invitation.recipientEmailNormalized === email
  ) {
    return "EMAIL";
  }
  if (
    invitation.recipientPhoneNormalized &&
    user.phone &&
    invitation.recipientPhoneNormalized === user.phone
  ) {
    return "PHONE";
  }
  return null;
}

/** Status as seen now: a PENDING invitation past its expiry is EXPIRED. */
export function effectiveInvitationStatus(invitation: {
  status: string;
  expiresAt: Date;
}) {
  if (
    (invitation.status === "PENDING" ||
      invitation.status === "PENDING_APPROVAL") &&
    invitation.expiresAt.getTime() <= Date.now()
  ) {
    return "EXPIRED";
  }
  return invitation.status;
}

export async function markInvitationExpired(db: Tx | Db, invitationId: string) {
  await db.commonsInvitation.updateMany({
    where: {
      id: invitationId,
      status: { in: ["PENDING", "PENDING_APPROVAL"] },
    },
    data: { status: "EXPIRED" },
  });
}

export async function stewardIdsFor(db: Tx | Db, coopId: string) {
  const stewards = await db.userCoopMembership.findMany({
    where: { coopId, status: "ACTIVE", roles: { hasSome: STEWARD_ROLES } },
    select: { userId: true },
  });
  return stewards.map((steward) => steward.userId);
}

export async function notifyStewards(
  db: Db,
  coopId: string,
  payload: {
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
  exceptUserId?: string,
) {
  const stewardIds = (await stewardIdsFor(db, coopId)).filter(
    (id) => id !== exceptUserId,
  );
  await Promise.all(
    stewardIds.map((userId) =>
      createNotificationAndPush(db, {
        userId,
        coopId,
        ...payload,
        data: { coopId, ...payload.data },
      }).catch((error) => {
        console.error("Failed to notify steward:", error);
      }),
    ),
  );
}

/**
 * Opens (or re-opens) a steward-reviewed request to join an invite-only
 * commons. Never creates a membership. One application per person per
 * commons, so a second request while one is pending is a no-op.
 */
export async function submitAccessRequest(
  db: Db,
  params: {
    coopId: string;
    commonsName: string;
    user: { id: string; email: string; name: string | null; phone: string | null };
    invitation: { id: string; inviterId: string; purpose: InvitationPurpose } | null;
    reason: "SHARE_LINK" | "UNVERIFIED_PHONE" | "CONTACT_MISMATCH";
    note?: string;
  },
) {
  const since = new Date(Date.now() - DAY_MS);
  const recentRequests = await db.application.count({
    where: {
      userId: params.user.id,
      requestType: "ACCESS_REQUEST",
      updatedAt: { gte: since },
    },
  });
  if (recentRequests >= MAX_ACCESS_REQUESTS_PER_DAY) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You've sent a lot of requests today. Try again tomorrow.",
    });
  }

  const existing = await db.application.findUnique({
    where: { userId_coopId: { userId: params.user.id, coopId: params.coopId } },
    select: { id: true, status: true, reviewedAt: true },
  });

  if (
    existing &&
    (PENDING_APPLICATION_STATUSES as readonly string[]).includes(existing.status)
  ) {
    return { applicationId: existing.id, alreadyRequested: true };
  }

  if (
    existing?.status === "REJECTED" &&
    params.reason === "SHARE_LINK" &&
    existing.reviewedAt &&
    existing.reviewedAt.getTime() > Date.now() - DECLINED_REQUEST_COOLDOWN_DAYS * DAY_MS
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A steward declined your last request. Ask a family member to invite you directly.",
    });
  }

  const referredByUserId =
    params.invitation && params.invitation.purpose !== "REQUEST_ACCESS"
      ? params.invitation.inviterId
      : null;
  const data = {
    email: params.user.email,
    name: params.user.name,
    note: params.note?.trim() || null,
    reason: params.reason,
    source: "commons_invitation",
  } as Prisma.InputJsonValue;
  const fields = {
    status: "SUBMITTED" as const,
    requestType: "ACCESS_REQUEST",
    invitationId: params.invitation?.id ?? null,
    referredByUserId,
    data,
  };

  const application = await db.$transaction(async (tx) => {
    const saved = existing
      ? await tx.application.update({
          where: { id: existing.id },
          data: {
            ...fields,
            reviewedBy: null,
            reviewedByUserId: null,
            reviewedAt: null,
            reviewNotes: null,
            withdrawnAt: null,
          },
          select: { id: true },
        })
      : await tx.application.create({
          data: { ...fields, userId: params.user.id, coopId: params.coopId },
          select: { id: true },
        });

    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.user.id,
        action: "COMMONS_ACCESS_REQUESTED",
        resource: "Application",
        resourceId: saved.id,
        metadata: {
          coopId: params.coopId,
          invitationId: params.invitation?.id ?? null,
          reason: params.reason,
        },
      }),
    });
    return saved;
  });

  const who = params.user.name?.trim() || params.user.email;
  void notifyStewards(db, params.coopId, {
    type: "COMMONS_ACCESS_REQUEST",
    title: `${who} asked to join ${params.commonsName}`,
    body:
      params.reason === "SHARE_LINK"
        ? "They opened your family's shareable link. Review the request before they can see anything."
        : "Their account didn't match the invited contact, so a steward needs to confirm it's them.",
    data: { applicationId: application.id },
  });

  return { applicationId: application.id, alreadyRequested: false };
}

/**
 * A steward approves or declines a pending application or access request to
 * an invite-only commons. Approval is the only way such a request becomes a
 * membership.
 */
export async function reviewCommonsApplication(
  db: Db,
  params: {
    applicationId: string;
    reviewerId: string;
    decision: "APPROVE" | "DECLINE";
    note?: string;
  },
) {
  const application = await db.application.findUnique({
    where: { id: params.applicationId },
    select: {
      id: true,
      userId: true,
      coopId: true,
      status: true,
      invitationId: true,
    },
  });
  if (!application) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
  }

  const policy = await requireCommonsPolicy(db, application.coopId);
  await requireSteward(db, params.reviewerId, application.coopId);
  if (policy.joinPolicy !== "INVITE_ONLY") {
    // Normal commons applications also create a wallet and sync on-chain
    // membership; they're reviewed in the portal (application.approveApplication).
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Review this commons' applications from the portal.",
    });
  }

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.application.updateMany({
      where: {
        id: application.id,
        status: { in: [...PENDING_APPLICATION_STATUSES] },
      },
      data: {
        status: params.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewedBy: params.reviewerId,
        reviewedByUserId: params.reviewerId,
        reviewedAt: now,
        reviewNotes: params.note?.trim() || null,
      },
    });
    if (updated.count === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request was already reviewed or withdrawn.",
      });
    }

    let joined = false;
    if (params.decision === "APPROVE") {
      const { created } = await createMembership(tx, {
        coopId: application.coopId,
        userId: application.userId,
        approvedBy: params.reviewerId,
        method: "APPLICATION",
      });
      joined = created;

      // A named invitation is single-use: approving the invitee's request
      // consumes it. Shareable links stay open until revoked or expired.
      if (application.invitationId) {
        await tx.commonsInvitation.updateMany({
          where: {
            id: application.invitationId,
            status: "PENDING",
            purpose: "DIRECT_JOIN",
          },
          data: {
            status: "ACCEPTED",
            acceptedByUserId: application.userId,
            acceptedAt: now,
          },
        });
      }
    } else {
      // Clear any PENDING membership left by the older application flow.
      await tx.userCoopMembership.updateMany({
        where: {
          userId: application.userId,
          coopId: application.coopId,
          status: "PENDING",
        },
        data: {
          status: "REJECTED",
          rejectedAt: now,
          rejectedBy: params.reviewerId,
          rejectionReason: params.note?.trim() || null,
        },
      });
    }

    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.reviewerId,
        action:
          params.decision === "APPROVE"
            ? "COMMONS_APPLICATION_APPROVED"
            : "COMMONS_APPLICATION_DECLINED",
        resource: "Application",
        resourceId: application.id,
        metadata: { coopId: application.coopId, applicantId: application.userId },
      }),
    });

    return { joined };
  });

  const welcomePostId =
    params.decision === "APPROVE"
      ? await findCommonsWelcomePost(db, application.coopId)
      : null;
  void createNotificationAndPush(db, {
    userId: application.userId,
    coopId: COMMONS_COOP_ID,
    type:
      params.decision === "APPROVE"
        ? "COMMONS_ACCESS_APPROVED"
        : "COMMONS_ACCESS_DECLINED",
    title:
      params.decision === "APPROVE"
        ? `You're in ${policy.name ?? "the commons"}`
        : `${policy.name ?? "The commons"} didn't approve your request`,
    body:
      params.decision === "APPROVE"
        ? "A steward approved your request. Open it to say hello."
        : "A steward declined your request to join.",
    data: { coopId: application.coopId, postId: welcomePostId },
  }).catch((error) => console.error("Failed to notify applicant:", error));

  return { ...result, coopId: application.coopId, welcomePostId };
}

/** The applicant takes back a pending application or access request. */
export async function withdrawCommonsApplication(
  db: Db,
  params: { userId: string; coopId: string },
) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const application = await tx.application.findUnique({
      where: { userId_coopId: { userId: params.userId, coopId: params.coopId } },
      select: { id: true, status: true },
    });
    if (
      !application ||
      !(PENDING_APPLICATION_STATUSES as readonly string[]).includes(application.status)
    ) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "You don't have a pending request here.",
      });
    }

    await tx.application.update({
      where: { id: application.id },
      data: { status: "WITHDRAWN", withdrawnAt: now },
    });
    await tx.userCoopMembership.updateMany({
      where: { userId: params.userId, coopId: params.coopId, status: "PENDING" },
      data: { status: "INACTIVE" },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.userId,
        action: "COMMONS_APPLICATION_WITHDRAWN",
        resource: "Application",
        resourceId: application.id,
        metadata: { coopId: params.coopId },
      }),
    });
    return { applicationId: application.id };
  });
}

/**
 * Removes a member. Their access ends immediately: every commons read and
 * write checks for an ACTIVE membership, and they're taken out of the
 * commons' circles here.
 */
export async function removeCommonsMember(
  db: Db,
  params: { coopId: string; stewardId: string; userId: string },
) {
  if (params.coopId === COMMONS_COOP_ID) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Nobody is removed from the Cahootz Commons here.",
    });
  }
  await requireSteward(db, params.stewardId, params.coopId);

  return db.$transaction(async (tx) => {
    const target = await getMembership(tx, params.userId, params.coopId);
    if (target?.status !== "ACTIVE") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
    }
    if (isStewardMembership(target)) {
      const otherStewards = (await stewardIdsFor(tx, params.coopId)).filter(
        (id) => id !== params.userId,
      );
      if (otherStewards.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Make someone else a steward first.",
        });
      }
    }

    await tx.userCoopMembership.update({
      where: { id: target.id },
      data: { status: "INACTIVE", roles: ["member"] },
    });
    await tx.groupMember.deleteMany({
      where: { userId: params.userId, group: { coopId: params.coopId } },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.stewardId,
        action: "COMMONS_MEMBER_REMOVED",
        resource: "UserCoopMembership",
        resourceId: target.id,
        metadata: { coopId: params.coopId, userId: params.userId },
      }),
    });
    return { removed: true };
  });
}

export async function setCommonsSteward(
  db: Db,
  params: { coopId: string; stewardId: string; userId: string; steward: boolean },
) {
  await requireSteward(db, params.stewardId, params.coopId);

  return db.$transaction(async (tx) => {
    const target = await getMembership(tx, params.userId, params.coopId);
    if (target?.status !== "ACTIVE") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
    }
    const otherRoles = target.roles.filter((role) => !STEWARD_ROLES.includes(role));
    if (!params.steward) {
      const otherStewards = (await stewardIdsFor(tx, params.coopId)).filter(
        (id) => id !== params.userId,
      );
      if (otherStewards.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A commons needs at least one steward.",
        });
      }
    }
    const roles = params.steward
      ? [...new Set([...otherRoles, "member", "steward"])]
      : [...new Set([...otherRoles, "member"])];

    await tx.userCoopMembership.update({
      where: { id: target.id },
      data: { roles },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.stewardId,
        action: params.steward ? "COMMONS_STEWARD_GRANTED" : "COMMONS_STEWARD_REVOKED",
        resource: "UserCoopMembership",
        resourceId: target.id,
        metadata: { coopId: params.coopId, userId: params.userId, roles },
      }),
    });
    return { roles };
  });
}

/** A steward makes a member a guide, or takes the role away. */
export async function setCommonsGuide(
  db: Db,
  params: { coopId: string; stewardId: string; userId: string; guide: boolean },
) {
  if (params.coopId === COMMONS_COOP_ID) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The Cahootz Commons doesn't have guides.",
    });
  }
  await requireSteward(db, params.stewardId, params.coopId);

  return db.$transaction(async (tx) => {
    const target = await getMembership(tx, params.userId, params.coopId);
    if (target?.status !== "ACTIVE") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
    }
    if (params.guide && isStewardMembership(target)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Stewards can already invite people directly.",
      });
    }
    const otherRoles = target.roles.filter((role) => role !== GUIDE_ROLE);
    const roles = params.guide
      ? [...new Set([...otherRoles, "member", GUIDE_ROLE])]
      : [...new Set([...otherRoles, "member"])];

    await tx.userCoopMembership.update({
      where: { id: target.id },
      data: { roles },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.stewardId,
        action: params.guide ? "COMMONS_GUIDE_GRANTED" : "COMMONS_GUIDE_REVOKED",
        resource: "UserCoopMembership",
        resourceId: target.id,
        metadata: { coopId: params.coopId, userId: params.userId, roles },
      }),
    });
    return { roles };
  });
}

import { randomBytes } from "node:crypto";

import { TRPCError } from "@trpc/server";

import type { Prisma } from "@repo/db";

import type { Context } from "../context.js";
import { auditLogEntry } from "../lib/audit.js";
import { COMMONS_COOP_ID } from "../lib/commons.js";
import { assertCommonsNameAvailable, cleanCommonsName } from "../lib/commons-name.js";
import { isEmailConfigured, sendCommonsInvitationEmail } from "../lib/email.js";
import {
  createInvitationToken,
  hashInvitationToken,
  maskInvitationContact,
  normalizeInvitationEmail,
  normalizeInvitationPhone,
} from "../lib/invitation-token.js";
import {
  canInviteDirectlyMembership,
  createMembership,
  effectiveInvitationStatus,
  findCommonsWelcomePost,
  getInvitationPurpose,
  getMembership,
  invitationContactMatch,
  invitationExpiry,
  invitationMatchesPolicy,
  isGuideMembership,
  isStewardMembership,
  markInvitationExpired,
  MAX_FAMILIES_PER_DAY,
  MAX_INVITATIONS_PER_DAY,
  notifyStewards,
  requireActiveMember,
  requireCommonsPolicy,
  requireSteward,
  submitAccessRequest,
  type CommonsPolicy,
  type InvitationPurpose,
} from "./commons-membership.js";
import { memberAppLinkUrl, MEMBER_APP_NAME } from "./onboarding-drip-config.js";
import { createNotificationAndPush } from "./push-notification-service.js";
import {
  familyCharter,
  familyConfigFromSetup,
  familySetupFromConfig,
  type FamilySetupInput,
} from "./family-setup.js";
import { notifyCommonsMemberJoined } from "./member-join-notifications.js";
import { sendCommonsInvitationSMS } from "./sms.js";

type Db = Context["db"];

type AccountUser = {
  id: string;
  email: string;
  name: string | null;
  handle?: string | null;
  phone: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Never an email or phone: invitations are shown to people who aren't members yet. */
function publicName(user: { name: string | null; handle?: string | null } | null) {
  return user?.name?.trim() || (user?.handle ? `@${user.handle}` : null) || "A member";
}

/** Opens the invitation in the member app (expo-router maps it to app/invite/[token]). */
export function invitationAppLink(token: string) {
  return `commons://invite/${token}`;
}

export const FAMILY_PRIVACY_NOTICE =
  "This is a private family space. Only people a steward lets in can see who's here or anything posted, and nothing here shows up in Explore.";

async function assertInvitationRateLimit(db: Db, inviterId: string) {
  const sent = await db.commonsInvitation.count({
    where: { inviterId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  if (sent >= MAX_INVITATIONS_PER_DAY) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You've sent a lot of invitations today. Try again tomorrow.",
    });
  }
}

/**
 * Invitation wording. `hasAccount` is whether the invited email already
 * belongs to an account: those people are told the invitation is waiting in
 * the app, everyone else how to get the app. Either way they still accept it
 * themselves; nobody is added to a commons without agreeing.
 */
export function invitationCopy(params: {
  purpose: InvitationPurpose;
  inviterName: string;
  commonsName: string;
  hasAccount: boolean;
}) {
  const { commonsName } = params;
  if (params.purpose === "APPLY") {
    return {
      heading: `${params.inviterName} invited you to apply to ${commonsName}`,
      emailSteps: params.hasAccount
        ? `Open the ${MEMBER_APP_NAME} app to see the invitation and ${commonsName}'s application. Everyone applies, and a steward reviews each application.`
        : `Get the ${MEMBER_APP_NAME} app and sign in with this email address. You'll find the invitation there with ${commonsName}'s application. Everyone applies, and a steward reviews each application.`,
      ctaLabel: params.hasAccount ? "Open on iOS" : "Download for iOS",
    };
  }
  return {
    heading: `${params.inviterName} invited you to join ${commonsName}`,
    emailSteps: params.hasAccount
      ? `Open the ${MEMBER_APP_NAME} app. Your invitation to join ${commonsName} is waiting on your home screen.`
      : `Get the ${MEMBER_APP_NAME} app and sign in with this email address. Your invitation will be waiting for you.`,
    ctaLabel: params.hasAccount ? "Open on iOS" : "Download for iOS",
  };
}

/**
 * Sends an invitation that's ready to go (status PENDING) by email or text,
 * plus an in-app alert when the email already belongs to an account. A
 * delivery failure never fails the request; the invitation still shows up
 * in the recipient's app once they sign in with that email.
 */
async function deliverInvitation(
  db: Db,
  params: {
    invitation: {
      id: string;
      purpose: InvitationPurpose;
      recipientEmailNormalized: string | null;
      recipientPhoneNormalized: string | null;
      expiresAt: Date;
    };
    token: string;
    inviterName: string;
    policy: CommonsPolicy;
  },
) {
  const commonsName = params.policy.name || "a commons";
  const inAppLink = invitationAppLink(params.token);
  const channels: string[] = [];
  // Logged with the contact masked ("m***@example.com"), never the token.
  const log = {
    invitationId: params.invitation.id,
    purpose: params.invitation.purpose,
    coopId: params.policy.coopId,
    to: maskInvitationContact(params.invitation),
  };
  console.info("[commons-invite] Delivering invitation", log);

  const email = params.invitation.recipientEmailNormalized;
  if (email) {
    const existingUser = await db.user.findUnique({
      where: { email },
      select: { id: true, deletedAt: true },
    });
    const hasAccount = !!existingUser && !existingUser.deletedAt;
    const copy = invitationCopy({
      purpose: params.invitation.purpose,
      inviterName: params.inviterName,
      commonsName,
      hasAccount,
    });

    if (!isEmailConfigured()) {
      console.warn("[commons-invite] Email not sent: RESEND_API_KEY is not set for the API", log);
    } else {
      try {
        const sent = await sendCommonsInvitationEmail({
          to: email,
          subject: copy.heading,
          heading: copy.heading,
          commonsName,
          description: params.policy.description || params.policy.tagline,
          steps: copy.emailSteps,
          ctaLabel: copy.ctaLabel,
          appLinkUrl: memberAppLinkUrl(),
          expiresAt: params.invitation.expiresAt,
        });
        channels.push("email");
        console.info("[commons-invite] Email accepted by Resend", {
          ...log,
          resendId: sent.id,
          from: sent.from,
          hasAccount,
        });
      } catch (error) {
        console.error("[commons-invite] Email failed to send", {
          ...log,
          hasAccount,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (existingUser && hasAccount) {
      await createNotificationAndPush(db, {
        userId: existingUser.id,
        coopId: COMMONS_COOP_ID,
        type: "COMMONS_INVITATION",
        title: copy.heading,
        body:
          params.invitation.purpose === "APPLY"
            ? "Open it to see the commons and apply."
            : "Open it to see the invitation.",
        data: { invitationId: params.invitation.id },
      }).catch((error) => console.error("Failed to push commons invitation:", error));
      channels.push("app");
    }
  }

  const phone = params.invitation.recipientPhoneNormalized;
  if (phone) {
    const { heading } = invitationCopy({
      purpose: params.invitation.purpose,
      inviterName: params.inviterName,
      commonsName,
      hasAccount: false,
    });
    const result = await sendCommonsInvitationSMS({
      recipientPhone: phone,
      text: `${heading} on ${MEMBER_APP_NAME}. Get the app: ${memberAppLinkUrl()} then open your invitation: ${inAppLink} (expires in 14 days)`,
    });
    if (result.success) channels.push("sms");
    else console.warn("[commons-invite] Text not sent", { ...log, error: result.error });
  }

  await db.commonsInvitation.update({
    where: { id: params.invitation.id },
    data: { sentAt: new Date() },
  });

  console.info("[commons-invite] Delivery finished", { ...log, channels });
  return channels;
}

/**
 * A member invites someone by email or phone.
 *
 * - APPLICATION_REQUIRED: any member may send an APPLY referral.
 * - INVITE_ONLY: a steward's or guide's invitation is sent right away
 *   (DIRECT_JOIN); an ordinary member's is a recommendation that waits for a
 *   steward.
 */
export async function createCommonsInvitation(
  db: Db,
  params: {
    coopId: string;
    inviter: AccountUser;
    email?: string;
    phone?: string;
    recipientName?: string;
    message?: string;
  },
) {
  const policy = await requireCommonsPolicy(db, params.coopId);
  const purpose = getInvitationPurpose(policy.joinPolicy, true);
  const membership = await requireActiveMember(db, params.inviter.id, params.coopId);
  const direct = canInviteDirectlyMembership(membership);

  const recipientEmailNormalized = params.email
    ? normalizeInvitationEmail(params.email)
    : null;
  const recipientPhoneNormalized = params.phone
    ? normalizeInvitationPhone(params.phone)
    : null;
  if (params.email && !recipientEmailNormalized) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email address." });
  }
  if (params.phone && !recipientPhoneNormalized) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid phone number." });
  }
  if (!recipientEmailNormalized && !recipientPhoneNormalized) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Add an email or phone number." });
  }
  if (recipientEmailNormalized && recipientEmailNormalized === params.inviter.email.toLowerCase()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That's your own email address." });
  }

  if (recipientEmailNormalized) {
    const recipient = await db.user.findUnique({
      where: { email: recipientEmailNormalized },
      select: { id: true },
    });
    const recipientMembership = recipient
      ? await getMembership(db, recipient.id, params.coopId)
      : null;
    if (recipientMembership?.status === "ACTIVE") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `They're already a member of ${policy.name ?? "this commons"}.`,
      });
    }
  }

  const existing = await db.commonsInvitation.findFirst({
    where: {
      coopId: params.coopId,
      status: { in: ["PENDING", "PENDING_APPROVAL"] },
      expiresAt: { gt: new Date() },
      purpose,
      ...(recipientEmailNormalized
        ? { recipientEmailNormalized }
        : { recipientPhoneNormalized }),
    },
    select: { id: true, status: true },
  });
  if (existing) {
    console.info("[commons-invite] Not sent: this contact already has a pending invitation", {
      invitationId: existing.id,
      status: existing.status,
      coopId: params.coopId,
      to: maskInvitationContact({ recipientEmailNormalized, recipientPhoneNormalized }),
    });
    return { invitationId: existing.id, status: existing.status, alreadyInvited: true, channels: [] };
  }

  await assertInvitationRateLimit(db, params.inviter.id);

  const needsApproval = policy.joinPolicy === "INVITE_ONLY" && !direct;
  const { token, tokenHash } = createInvitationToken();
  const now = new Date();
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.commonsInvitation.create({
      data: {
        coopId: params.coopId,
        inviterId: params.inviter.id,
        purpose,
        recipientEmailNormalized,
        recipientPhoneNormalized,
        recipientName: params.recipientName?.trim() || null,
        message: params.message?.trim() || null,
        tokenHash,
        status: needsApproval ? "PENDING_APPROVAL" : "PENDING",
        expiresAt: invitationExpiry(now),
        ...(direct && policy.joinPolicy === "INVITE_ONLY"
          ? { approvedByUserId: params.inviter.id, approvedAt: now }
          : {}),
      },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.inviter.id,
        action: needsApproval
          ? "COMMONS_INVITATION_RECOMMENDED"
          : "COMMONS_INVITATION_CREATED",
        resource: "CommonsInvitation",
        resourceId: created.id,
        metadata: { coopId: params.coopId, purpose },
      }),
    });
    return created;
  });

  const inviterName = publicName(params.inviter);
  if (needsApproval) {
    console.info("[commons-invite] Not sent yet: the inviter isn't a steward or guide, so it waits for a steward's approval", {
      invitationId: invitation.id,
      coopId: params.coopId,
    });
    void notifyStewards(
      db,
      params.coopId,
      {
        type: "COMMONS_RECOMMENDATION",
        title: `${inviterName} wants to invite ${invitation.recipientName || "someone"}`,
        body: `Approve it to send the invitation to ${policy.name ?? "your commons"}.`,
        data: { invitationId: invitation.id },
      },
      params.inviter.id,
    );
    return { invitationId: invitation.id, status: invitation.status, alreadyInvited: false, channels: [] };
  }

  const channels = await deliverInvitation(db, {
    invitation,
    token,
    inviterName,
    policy,
  });
  return { invitationId: invitation.id, status: invitation.status, alreadyInvited: false, channels };
}

/** A steward approves a member's recommendation, which sends it. */
export async function approveRecommendation(
  db: Db,
  params: { invitationId: string; steward: AccountUser },
) {
  const invitation = await db.commonsInvitation.findUnique({
    where: { id: params.invitationId },
    include: { inviter: { select: { name: true, handle: true } } },
  });
  if (!invitation) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found." });
  }
  await requireSteward(db, params.steward.id, invitation.coopId);
  const policy = await requireCommonsPolicy(db, invitation.coopId);

  // A fresh token: the recommendation's original token was never sent.
  const { token, tokenHash } = createInvitationToken();
  const now = new Date();
  const updated = await db.commonsInvitation.updateMany({
    where: { id: invitation.id, status: "PENDING_APPROVAL" },
    data: {
      status: "PENDING",
      tokenHash,
      approvedByUserId: params.steward.id,
      approvedAt: now,
      expiresAt: invitationExpiry(now),
    },
  });
  if (updated.count === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "This recommendation was already handled." });
  }
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: params.steward.id,
      action: "COMMONS_INVITATION_APPROVED",
      resource: "CommonsInvitation",
      resourceId: invitation.id,
      metadata: { coopId: invitation.coopId },
    }),
  });

  const channels = await deliverInvitation(db, {
    invitation: { ...invitation, expiresAt: invitationExpiry(now) },
    token,
    inviterName: publicName(invitation.inviter),
    policy,
  });
  return { invitationId: invitation.id, channels };
}

/**
 * Revokes a pending invitation, a recommendation, or a shareable link.
 * Stewards can revoke any; a member can withdraw their own.
 */
export async function revokeInvitation(
  db: Db,
  params: { invitationId: string; userId: string },
) {
  const invitation = await db.commonsInvitation.findUnique({
    where: { id: params.invitationId },
    select: { id: true, coopId: true, inviterId: true, status: true },
  });
  if (!invitation) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found." });
  }
  const membership = await getMembership(db, params.userId, invitation.coopId);
  const allowed =
    isStewardMembership(membership) ||
    (membership?.status === "ACTIVE" && invitation.inviterId === params.userId);
  if (!allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only a steward can cancel this invitation." });
  }

  const updated = await db.commonsInvitation.updateMany({
    where: { id: invitation.id, status: { in: ["PENDING", "PENDING_APPROVAL"] } },
    data: { status: "REVOKED", revokedByUserId: params.userId, revokedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "This invitation is no longer pending." });
  }
  await db.auditLog.create({
    data: auditLogEntry({
      actorId: params.userId,
      action: "COMMONS_INVITATION_REVOKED",
      resource: "CommonsInvitation",
      resourceId: invitation.id,
      metadata: { coopId: invitation.coopId, previousStatus: invitation.status },
    }),
  });
  return { revoked: true };
}

/**
 * A reusable link for an invite-only commons. Opening it only lets someone
 * request access; it never admits anyone. The raw token is returned once.
 */
export async function createShareLink(
  db: Db,
  params: { coopId: string; steward: AccountUser },
) {
  const policy = await requireCommonsPolicy(db, params.coopId);
  if (policy.joinPolicy !== "INVITE_ONLY") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Shareable request links are only for invite-only commons.",
    });
  }
  await requireSteward(db, params.steward.id, params.coopId);
  await assertInvitationRateLimit(db, params.steward.id);

  const { token, tokenHash } = createInvitationToken();
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.commonsInvitation.create({
      data: {
        coopId: params.coopId,
        inviterId: params.steward.id,
        purpose: getInvitationPurpose(policy.joinPolicy, false),
        tokenHash,
        status: "PENDING",
        expiresAt: invitationExpiry(),
        approvedByUserId: params.steward.id,
        approvedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.steward.id,
        action: "COMMONS_SHARE_LINK_CREATED",
        resource: "CommonsInvitation",
        resourceId: created.id,
        metadata: { coopId: params.coopId },
      }),
    });
    return created;
  });

  return {
    invitationId: invitation.id,
    token,
    appLink: invitationAppLink(token),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

type InvitationRecord = Prisma.CommonsInvitationGetPayload<{
  include: { inviter: { select: { name: true; handle: true } } };
}>;

/**
 * What an invitation's recipient may see before joining: the commons' name,
 * description and (for families) rules, and who invited them. Never who else
 * is a member or anything posted.
 */
async function describeInvitation(
  db: Db,
  invitation: InvitationRecord,
  viewer: AccountUser | null,
  options: { includeId: boolean },
) {
  const policy = await requireCommonsPolicy(db, invitation.coopId);
  const status = effectiveInvitationStatus(invitation);
  if (status === "EXPIRED" && invitation.status !== "EXPIRED") {
    await markInvitationExpired(db, invitation.id);
  }

  const [membership, application] = viewer
    ? await Promise.all([
        getMembership(db, viewer.id, invitation.coopId),
        db.application.findUnique({
          where: { userId_coopId: { userId: viewer.id, coopId: invitation.coopId } },
          select: { status: true, requestType: true },
        }),
      ])
    : [null, null];

  return {
    invitationId: options.includeId ? invitation.id : null,
    purpose: invitation.purpose as InvitationPurpose,
    status,
    expiresAt: invitation.expiresAt.toISOString(),
    recipientHint: maskInvitationContact(invitation),
    recipientName: options.includeId ? invitation.recipientName : null,
    message: invitation.message,
    inviterName: publicName(invitation.inviter),
    commons: {
      id: policy.coopId,
      name: policy.name || "Commons",
      tagline: policy.tagline,
      description: policy.description || policy.displayMission,
      iconEmoji: policy.iconEmoji,
      iconColor: policy.iconColor,
      joinPolicy: policy.joinPolicy,
      isPrivate: policy.isPrivate,
      rules: policy.joinPolicy === "INVITE_ONLY" ? policy.charterText : null,
      privacyNotice: policy.isPrivate ? FAMILY_PRIVACY_NOTICE : null,
    },
    viewer: viewer
      ? {
          signedIn: true,
          isMember: membership?.status === "ACTIVE",
          contactMatch:
            invitation.purpose === "REQUEST_ACCESS"
              ? null
              : invitationContactMatch(invitation, viewer),
          requestStatus: application?.status ?? null,
        }
      : { signedIn: false, isMember: false, contactMatch: null, requestStatus: null },
  };
}

export type InvitationDescription = Awaited<ReturnType<typeof describeInvitation>>;

async function findInvitationByToken(db: Db, token: string) {
  const invitation = await db.commonsInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { inviter: { select: { name: true, handle: true } } },
  });
  // A recommendation's token was never sent, so it can't be "opened".
  if (!invitation || invitation.status === "PENDING_APPROVAL") {
    throw new TRPCError({ code: "NOT_FOUND", message: "This invitation link isn't valid." });
  }
  return invitation;
}

/** Named invitations addressed to this account's email or phone. */
function invitationsForUserWhere(user: AccountUser): Prisma.CommonsInvitationWhereInput {
  const contacts: Prisma.CommonsInvitationWhereInput[] = [
    { recipientEmailNormalized: user.email.trim().toLowerCase() },
  ];
  if (user.phone) contacts.push({ recipientPhoneNormalized: user.phone });
  return { purpose: { in: ["DIRECT_JOIN", "APPLY"] }, OR: contacts };
}

async function findInvitationForUser(db: Db, invitationId: string, user: AccountUser) {
  const invitation = await db.commonsInvitation.findFirst({
    where: {
      id: invitationId,
      status: { not: "PENDING_APPROVAL" },
      ...invitationsForUserWhere(user),
    },
    include: { inviter: { select: { name: true, handle: true } } },
  });
  if (!invitation) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found." });
  }
  return invitation;
}

export async function previewInvitationByToken(
  db: Db,
  token: string,
  viewer: AccountUser | null,
) {
  const invitation = await findInvitationByToken(db, token);
  return describeInvitation(db, invitation, viewer, { includeId: false });
}

export async function getInvitationForUser(
  db: Db,
  invitationId: string,
  viewer: AccountUser,
) {
  const invitation = await findInvitationForUser(db, invitationId, viewer);
  return describeInvitation(db, invitation, viewer, { includeId: true });
}

/** Pending invitations waiting for this account, for commons it isn't in yet. */
export async function listInvitationsForUser(db: Db, user: AccountUser) {
  const invitations = await db.commonsInvitation.findMany({
    where: {
      status: "PENDING",
      expiresAt: { gt: new Date() },
      ...invitationsForUserWhere(user),
    },
    include: { inviter: { select: { name: true, handle: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const described = await Promise.all(
    invitations.map((invitation) =>
      describeInvitation(db, invitation, user, { includeId: true }),
    ),
  );
  // One card per commons, and none for commons they're already in.
  const seen = new Set<string>();
  return described.filter((invitation) => {
    if (invitation.viewer.isMember || seen.has(invitation.commons.id)) return false;
    seen.add(invitation.commons.id);
    return invitation.status === "PENDING";
  });
}

export type AcceptInvitationResult =
  | { outcome: "JOINED"; coopId: string; welcomePostId: string | null }
  | { outcome: "ALREADY_MEMBER"; coopId: string; welcomePostId: string | null }
  | { outcome: "REQUESTED"; coopId: string; reason: string; alreadyRequested: boolean }
  | { outcome: "APPLY"; coopId: string; invitationId: string };

/**
 * The recipient acts on an invitation (by link token, or by id for an
 * invitation addressed to their account):
 *
 * - DIRECT_JOIN + signed-in email matches: joins after accepting the rules.
 * - DIRECT_JOIN otherwise (phone-only match or a different account): a
 *   steward-reviewed access request, never a membership.
 * - REQUEST_ACCESS (shareable link): an access request.
 * - APPLY: nothing changes here; the client opens the application.
 */
export async function acceptCommonsInvitation(
  db: Db,
  params: {
    user: AccountUser;
    token?: string;
    invitationId?: string;
    acceptRules: boolean;
    note?: string;
  },
): Promise<AcceptInvitationResult> {
  const invitation = params.token
    ? await findInvitationByToken(db, params.token)
    : params.invitationId
      ? await findInvitationForUser(db, params.invitationId, params.user)
      : null;
  if (!invitation) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Missing invitation." });
  }

  const policy = await requireCommonsPolicy(db, invitation.coopId);
  const membership = await getMembership(db, params.user.id, invitation.coopId);
  if (membership?.status === "ACTIVE") {
    return {
      outcome: "ALREADY_MEMBER",
      coopId: invitation.coopId,
      welcomePostId: await findCommonsWelcomePost(db, invitation.coopId),
    };
  }

  const status = effectiveInvitationStatus(invitation);
  if (status === "EXPIRED") {
    await markInvitationExpired(db, invitation.id);
    throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation has expired. Ask for a new one." });
  }
  if (status === "REVOKED") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation was cancelled." });
  }
  if (status === "ACCEPTED") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation has already been used." });
  }

  const purpose = invitation.purpose as InvitationPurpose;
  if (!invitationMatchesPolicy(purpose, policy.joinPolicy)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation is no longer valid." });
  }

  if (purpose === "APPLY") {
    return { outcome: "APPLY", coopId: invitation.coopId, invitationId: invitation.id };
  }

  if (!params.acceptRules) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Agree to ${policy.name ?? "the commons"}' rules to continue.`,
    });
  }

  const commonsName = policy.name || "this commons";
  const contactMatch = purpose === "DIRECT_JOIN" ? invitationContactMatch(invitation, params.user) : null;

  if (purpose === "DIRECT_JOIN" && contactMatch === "EMAIL") {
    const now = new Date();
    await db.$transaction(async (tx) => {
      // Single use: only one account can move it out of PENDING.
      const claimed = await tx.commonsInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "ACCEPTED", acceptedByUserId: params.user.id, acceptedAt: now },
      });
      if (claimed.count === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "This invitation has already been used." });
      }
      await createMembership(tx, {
        coopId: invitation.coopId,
        userId: params.user.id,
        approvedBy: invitation.inviterId,
        method: "INVITATION",
      });
      // An earlier pending request is settled by the invitation.
      await tx.application.updateMany({
        where: {
          userId: params.user.id,
          coopId: invitation.coopId,
          status: { in: ["SUBMITTED", "UNDER_REVIEW"] },
        },
        data: {
          status: "APPROVED",
          reviewedBy: invitation.inviterId,
          reviewedByUserId: invitation.inviterId,
          reviewedAt: now,
          invitationId: invitation.id,
        },
      });
      await tx.auditLog.create({
        data: auditLogEntry({
          actorId: params.user.id,
          action: "COMMONS_INVITATION_ACCEPTED",
          resource: "CommonsInvitation",
          resourceId: invitation.id,
          metadata: { coopId: invitation.coopId, rulesAccepted: true },
        }),
      });
    });

    void createNotificationAndPush(db, {
      userId: invitation.inviterId,
      coopId: invitation.coopId,
      type: "COMMONS_INVITATION_ACCEPTED",
      title: `${publicName(params.user)} joined ${commonsName}`,
      body: "They accepted your invitation.",
      data: { coopId: invitation.coopId },
    }).catch((error) => console.error("Failed to notify inviter:", error));
    void notifyCommonsMemberJoined(db, {
      coopId: invitation.coopId,
      userId: params.user.id,
      exceptUserIds: [invitation.inviterId],
    }).catch((error) => console.error("Failed to notify stewards of new member:", error));

    return {
      outcome: "JOINED",
      coopId: invitation.coopId,
      welcomePostId: await findCommonsWelcomePost(db, invitation.coopId),
    };
  }

  const reason =
    purpose === "REQUEST_ACCESS"
      ? "SHARE_LINK"
      : contactMatch === "PHONE"
        ? "UNVERIFIED_PHONE"
        : "CONTACT_MISMATCH";
  const request = await submitAccessRequest(db, {
    coopId: invitation.coopId,
    commonsName,
    user: params.user,
    invitation: { id: invitation.id, inviterId: invitation.inviterId, purpose },
    reason,
    note: params.note,
  });
  return {
    outcome: "REQUESTED",
    coopId: invitation.coopId,
    reason,
    alreadyRequested: request.alreadyRequested,
  };
}

/**
 * Resolves the invitation an application to an APPLICATION_REQUIRED commons
 * came from, so the inviter is recorded as the referral. Doesn't admit anyone.
 */
export async function resolveApplyReferral(
  db: Db,
  params: { coopId: string; user: AccountUser; invitationId?: string; token?: string },
) {
  if (!params.invitationId && !params.token) return null;
  const invitation = params.token
    ? await findInvitationByToken(db, params.token)
    : await findInvitationForUser(db, params.invitationId!, params.user);
  if (
    invitation.coopId !== params.coopId ||
    invitation.purpose !== "APPLY" ||
    effectiveInvitationStatus(invitation) !== "PENDING"
  ) {
    return null;
  }
  return { invitationId: invitation.id, referredByUserId: invitation.inviterId };
}

/** Everything the invite/steward screen needs for one commons. */
export async function getInvitationOverview(
  db: Db,
  params: { coopId: string; user: AccountUser },
) {
  const policy = await requireCommonsPolicy(db, params.coopId);
  const membership = await requireActiveMember(db, params.user.id, params.coopId);
  const steward = isStewardMembership(membership);
  const guide = !steward && isGuideMembership(membership);
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 14 * DAY_MS);

  const invitations = await db.commonsInvitation.findMany({
    where: {
      coopId: params.coopId,
      purpose: { in: ["DIRECT_JOIN", "APPLY"] },
      ...(steward ? {} : { inviterId: params.user.id }),
      OR: [
        { status: { in: ["PENDING", "PENDING_APPROVAL"] }, expiresAt: { gt: now } },
        { status: "ACCEPTED", acceptedAt: { gte: recentCutoff } },
      ],
    },
    include: { inviter: { select: { name: true, handle: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const [shareLinks, requests, members] = steward
    ? await Promise.all([
        policy.joinPolicy === "INVITE_ONLY"
          ? db.commonsInvitation.findMany({
              where: {
                coopId: params.coopId,
                purpose: "REQUEST_ACCESS",
                status: "PENDING",
                expiresAt: { gt: now },
              },
              include: { inviter: { select: { name: true, handle: true } } },
              orderBy: { createdAt: "desc" },
              take: 20,
            })
          : Promise.resolve([]),
        policy.joinPolicy === "INVITE_ONLY"
          ? db.application.findMany({
              where: { coopId: params.coopId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
              include: {
                user: { select: { id: true, name: true, handle: true, email: true } },
                invitation: {
                  select: {
                    purpose: true,
                    recipientName: true,
                    inviter: { select: { name: true, handle: true } },
                  },
                },
              },
              orderBy: { updatedAt: "asc" },
              take: 100,
            })
          : Promise.resolve([]),
        db.userCoopMembership.findMany({
          where: { coopId: params.coopId, status: "ACTIVE", user: { isBot: false } },
          include: { user: { select: { id: true, name: true, handle: true } } },
          orderBy: { joinedAt: "asc" },
          take: 200,
        }),
      ])
    : [[], [], []];

  const acceptedIds = invitations
    .map((invitation) => invitation.acceptedByUserId)
    .filter((id): id is string => !!id);
  const acceptedUsers = acceptedIds.length
    ? await db.user.findMany({
        where: { id: { in: acceptedIds } },
        select: { id: true, name: true, handle: true },
      })
    : [];
  const acceptedById = new Map(acceptedUsers.map((user) => [user.id, user]));

  return {
    commons: {
      id: policy.coopId,
      name: policy.name || "Commons",
      joinPolicy: policy.joinPolicy,
      isPrivate: policy.isPrivate,
    },
    isSteward: steward,
    isGuide: guide,
    // Members of an invite-only commons recommend; stewards and guides invite.
    canInviteDirectly: policy.joinPolicy === "APPLICATION_REQUIRED" || steward || guide,
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      purpose: invitation.purpose,
      status: invitation.status,
      contact: invitation.recipientEmailNormalized || invitation.recipientPhoneNormalized,
      contactType: invitation.recipientEmailNormalized ? "EMAIL" : "PHONE",
      recipientName: invitation.recipientName,
      inviterName: publicName(invitation.inviter),
      isMine: invitation.inviterId === params.user.id,
      acceptedByName: invitation.acceptedByUserId
        ? publicName(acceptedById.get(invitation.acceptedByUserId) ?? null)
        : null,
      createdAt: invitation.createdAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
    })),
    shareLinks: shareLinks.map((link) => ({
      id: link.id,
      createdByName: publicName(link.inviter),
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
    })),
    requests: requests.map((application) => {
      const data = (application.data ?? {}) as Record<string, unknown>;
      return {
        id: application.id,
        requestType: application.requestType,
        applicant: {
          id: application.user.id,
          name: application.user.name,
          handle: application.user.handle,
          email: application.user.email,
        },
        note: typeof data.note === "string" ? data.note : null,
        reason: typeof data.reason === "string" ? data.reason : null,
        invitedAs: application.invitation?.recipientName ?? null,
        invitedByName: application.invitation && application.invitation.purpose !== "REQUEST_ACCESS"
          ? publicName(application.invitation.inviter)
          : null,
        requestedAt: application.updatedAt.toISOString(),
      };
    }),
    members: members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      handle: member.user.handle,
      isSteward: isStewardMembership(member),
      isGuide: !isStewardMembership(member) && isGuideMembership(member),
      isYou: member.user.id === params.user.id,
    })),
  };
}

/**
 * Starts a private, invite-only family commons with the creator as its
 * first steward and a pinned welcome post that new family members land on.
 * Lighter than a platform-created commons: no funding shop, coin or wallet.
 */
export async function createFamilyCommons(
  db: Db,
  params: {
    user: AccountUser;
    name: string;
    description?: string;
    iconEmoji?: string;
    iconColor?: string;
    /** The guided setup: goals, mission and the family agreement. */
    setup?: FamilySetupInput;
  },
) {
  const createdBy = `user:${params.user.id}`;
  const recent = await db.coopConfig.count({
    where: { createdBy, version: 1, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  if (recent >= MAX_FAMILIES_PER_DAY) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You've started a few families today. Try again tomorrow.",
    });
  }

  const name = cleanCommonsName(params.name);
  // Unguessable, so a private family can't be found by trying ids.
  const coopId = `family-${randomBytes(6).toString("hex")}`;
  const description = params.description?.trim() || `A private space for ${name}.`;
  const now = new Date();
  const guided = familyConfigFromSetup({
    name,
    creatorName: publicName(params.user),
    setup: params.setup,
  });

  const result = await db.$transaction(async (tx) => {
    await assertCommonsNameAvailable(tx, name);
    await tx.coopConfig.create({
      data: {
        coopId,
        version: 1,
        isActive: true,
        name,
        slug: coopId,
        description,
        displayMission: guided.displayMission,
        iconEmoji: params.iconEmoji || "🏡",
        iconColor: params.iconColor || null,
        displayOrder: 999,
        isPrivate: true,
        joinPolicy: "INVITE_ONLY",
        applicationQuestions: [],
        charterText: guided.charterText,
        missionGoals: guided.missionGoals,
        familySetup: guided.familySetup,
        votingWindowDays: guided.votingWindowDays,
        approvalThresholdPercent: guided.approvalThresholdPercent,
        quorumPercent: guided.quorumPercent,
        structuralWeights: { feasibility: 0.4, risk: 0.35, accountability: 0.25 },
        scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
        proposalCategories: [
          { key: "family_decision", label: "Family decisions", isActive: true },
          { key: "other", label: "Other", isActive: true },
        ],
        sectorExclusions: [],
        createdBy,
      },
    });

    await createMembership(tx, {
      coopId,
      userId: params.user.id,
      approvedBy: params.user.id,
      roles: ["member", "steward"],
      method: "CREATOR",
    });

    const post = await tx.commonsPost.create({
      data: {
        coopId,
        circleId: `general:${coopId}`,
        authorId: params.user.id,
        title: `Welcome to ${name}`,
        content: `This is our private family space. Say hello in the comments, share what's new, and ask for help when you need it. Only family members a steward lets in can see anything here.`,
        tag: "Update",
        classificationSignals: { source: "family_welcome" },
        isPinned: true,
        pinnedAt: now,
        pinnedById: params.user.id,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.user.id,
        action: "COMMONS_CREATED",
        resource: "CoopConfig",
        resourceId: coopId,
        metadata: {
          joinPolicy: "INVITE_ONLY",
          kind: "FAMILY",
          goalCount: params.setup?.goals?.length ?? 0,
          guidedSetup: Boolean(params.setup),
        },
      }),
    });

    return { coopId, welcomePostId: post.id };
  });

  return result;
}

async function activeFamilyConfig(db: Db, coopId: string) {
  const config = await db.coopConfig.findFirst({
    where: { coopId, isActive: true },
    orderBy: { version: "desc" },
  });
  if (!config || config.joinPolicy !== "INVITE_ONLY" || !coopId.startsWith("family-")) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Family not found." });
  }
  return config;
}

/**
 * Stewards may change the family's goals and agreement only while every
 * member is a steward. Once anyone else is in, it's a family decision.
 */
async function familySetupLock(db: Db, coopId: string) {
  const members = await db.userCoopMembership.findMany({
    where: { coopId, status: "ACTIVE", user: { isBot: false } },
    select: { status: true, roles: true },
  });
  const nonStewards = members.filter((member) => !isStewardMembership(member)).length;
  return {
    canEdit: nonStewards === 0,
    nonStewards,
    lockedReason: nonStewards
      ? `${nonStewards === 1 ? "1 person here isn't a steward" : `${nonStewards} people here aren't stewards`}, so changing the family's goals and agreement is now a family decision. Stewards can change them only while everyone in the family is a steward.`
      : null,
  };
}

async function familyCreatorName(db: Db, createdBy: string) {
  const creatorId = createdBy.startsWith("user:") ? createdBy.slice("user:".length) : null;
  const creator = creatorId
    ? await db.user.findUnique({ where: { id: creatorId }, select: { name: true, handle: true } })
    : null;
  return publicName(creator);
}

/**
 * The agreement a set of answers would produce. For an existing family (a
 * steward editing it) it names the family's real creator and name.
 */
export async function previewFamilyAgreementText(
  db: Db,
  params: { user: AccountUser; name: string; setup: FamilySetupInput; coopId?: string },
) {
  if (!params.coopId) {
    return familyCharter({ name: params.name, creatorName: publicName(params.user), setup: params.setup });
  }
  const config = await activeFamilyConfig(db, params.coopId);
  await requireSteward(db, params.user.id, params.coopId);
  return familyCharter({
    name: config.name || params.name,
    creatorName: await familyCreatorName(db, config.createdBy),
    setup: params.setup,
  });
}

/** A family's current goals, mission and agreement choices, for its stewards. */
export async function getFamilySetup(db: Db, params: { coopId: string; user: AccountUser }) {
  const config = await activeFamilyConfig(db, params.coopId);
  await requireSteward(db, params.user.id, params.coopId);
  const lock = await familySetupLock(db, params.coopId);
  const setup = familySetupFromConfig(config);
  return {
    coopId: config.coopId,
    name: config.name || "Family",
    setup,
    isSetUp: setup.goals.length > 0 || !!setup.mission,
    ...lock,
  };
}

/**
 * Saves new answers for a family's goals, mission and agreement. Only a
 * steward, and only while everyone in the family is a steward. Each change
 * bumps the config version and is recorded in its audit trail.
 */
export async function updateFamilySetup(
  db: Db,
  params: { coopId: string; user: AccountUser; setup: FamilySetupInput },
) {
  const config = await activeFamilyConfig(db, params.coopId);
  await requireSteward(db, params.user.id, params.coopId);

  const name = config.name || "Family";
  const guided = familyConfigFromSetup({
    name,
    creatorName: await familyCreatorName(db, config.createdBy),
    setup: params.setup,
  });
  const fields = {
    displayMission: guided.displayMission,
    charterText: guided.charterText,
    missionGoals: guided.missionGoals,
    votingWindowDays: guided.votingWindowDays,
    approvalThresholdPercent: guided.approvalThresholdPercent,
    quorumPercent: guided.quorumPercent,
    familySetup: guided.familySetup,
  };
  const diff = Object.entries(fields)
    .map(([field, after]) => ({ field, before: (config as Record<string, unknown>)[field] ?? null, after }))
    .filter(({ before, after }) => JSON.stringify(before) !== JSON.stringify(after));

  await db.$transaction(async (tx) => {
    // Checked inside the transaction so someone joining mid-save can't be skipped.
    const lock = await familySetupLock(tx as Db, params.coopId);
    if (!lock.canEdit) {
      throw new TRPCError({ code: "FORBIDDEN", message: lock.lockedReason! });
    }
    if (!diff.length) return;
    const last = await tx.coopConfigAudit.findFirst({
      where: { coopConfigId: config.id, status: "APPLIED" },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const updated = await tx.coopConfig.updateMany({
      where: { id: config.id, version: config.version },
      data: { ...fields, version: config.version + 1 },
    });
    if (updated.count === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Someone else just changed the family's setup. Reload and try again.",
      });
    }
    await tx.coopConfigAudit.create({
      data: {
        coopConfigId: config.id,
        changedBy: `user:${params.user.id}`,
        reason: "A steward updated the family's goals and agreement.",
        diff: diff as Prisma.InputJsonValue,
        sequence: (last?.sequence ?? 0) + 1,
        status: "APPLIED",
        section: "familySetup",
      },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: params.user.id,
        action: "FAMILY_SETUP_UPDATED",
        resource: "CoopConfig",
        resourceId: params.coopId,
        metadata: { fields: diff.map(({ field }) => field), version: config.version + 1 },
      }),
    });
  });

  if (diff.length) {
    void notifyStewards(
      db,
      params.coopId,
      {
        type: "FAMILY_SETUP_UPDATED",
        title: `${publicName(params.user)} updated ${name}'s goals and agreement`,
        body: "Open the family to see what changed.",
      },
      params.user.id,
    );
  }

  return { changed: diff.length > 0, ...(await getFamilySetup(db, params)) };
}

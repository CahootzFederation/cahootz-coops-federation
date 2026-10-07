import { db } from "@repo/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "../context.js";
import { createCommonsInvitation } from "./commons-invitations.js";
import { canInviteDirectlyMembership, getMembership } from "./commons-membership.js";
import { createNotificationAndPush } from "./push-notification-service.js";
import { payloadHash } from "./sage-ride-match-agent.js";

/**
 * "Should we invite them?" for families. When a person who isn't a member keeps coming up in a family's
 * feed ("Aunt Denise", "cousin Ray"), Sage asks the member who mentions them most whether to invite them,
 * and collects a phone number or email. That becomes an ordinary invitation: a steward's or guide's goes
 * out right away, anyone else's waits for a steward's one-tap Approve and send.
 *
 * The model only lists names it saw in a post or comment it was already analyzing (no extra call).
 * Everything else is code: family commons only, a repeat threshold, skipping names that match a member or
 * an existing invitation, a cooldown per name, one open ask per member, and a 60-day purge. Sage never
 * contacts the person itself and never stores contact details outside the invitation the member creates.
 */
export const PERSON_INVITE_SOURCE = "sage_person_invite";
export const PERSON_INVITE_REVIEW = "INVITE_PERSON";
export const MENTION_THRESHOLD = 3;
export const MENTION_WINDOW_DAYS = 30;
export const NAME_COOLDOWN_DAYS = 90;
export const MEMBER_ASK_GAP_DAYS = 7;
export const MENTION_RETENTION_DAYS = 60;
const MAX_PEOPLE_PER_ITEM = 3;
const DAY_MS = 86_400_000;

const RELATION_WORDS = new Set([
  "aunt", "auntie", "aunty", "uncle", "cousin", "grandma", "grandmother", "granny", "nana", "grandpa", "grandfather",
  "granddad", "papa", "pop", "mom", "mother", "mama", "dad", "father", "brother", "sister", "son", "daughter",
  "nephew", "niece", "godmother", "godfather", "stepmom", "stepdad", "stepbrother", "stepsister", "grandson",
  "granddaughter", "bro", "sis", "baby", "big", "lil", "little", "great", "friend", "husband", "wife", "partner",
]);
const FILLER_WORDS = new Set(["a", "an", "some", "this", "that", "one", "my", "our", "your", "the", "his", "her", "their", "dear", "ms", "mr", "mrs", "miss", "dr"]);

export type MentionedPerson = { name: string; relation: string };

/**
 * The key two mentions must share to count as the same person. A proper name ("Aunt Denise" -> "denise") is
 * shared across members; a bare relation ("Grandma") means different people to different members, so it
 * only counts within one member's own mentions.
 */
export function personKey(person: MentionedPerson, mentionedById: string): { nameKey: string; displayName: string; relation: string | null } | null {
  const raw = person.name.trim().replace(/\s+/g, " ");
  if (!raw || raw.length > 40 || /[@\d<>/\\]/.test(raw)) return null;
  const tokens = raw.toLowerCase().replace(/[^a-z\s'-]/g, "").split(" ").filter(Boolean);
  const relationToken = tokens.find((token) => RELATION_WORDS.has(token));
  const nameTokens = tokens.filter((token) => token.length > 1 && !RELATION_WORDS.has(token) && !FILLER_WORDS.has(token)).slice(0, 3);
  const relation = (person.relation.trim().toLowerCase().slice(0, 30) || relationToken) ?? null;
  const displayName = raw.replace(/^(my|our|your|the)\s+/i, "").slice(0, 40);
  if (nameTokens.length) return { nameKey: nameTokens.join(" "), displayName, relation };
  if (relationToken && relationToken !== "friend" && relationToken !== "baby") {
    return { nameKey: `rel:${relationToken}:${mentionedById}`, displayName, relation };
  }
  return null;
}

/** Records who a post or comment mentioned. Returns the keys recorded. Idempotent per source. */
export async function recordPersonMentions(input: {
  coopId: string; mentionedById: string; sourceType: string; sourceId: string; people: MentionedPerson[]; now?: Date;
}): Promise<string[]> {
  const keys = new Map<string, NonNullable<ReturnType<typeof personKey>>>();
  for (const person of input.people.slice(0, MAX_PEOPLE_PER_ITEM * 2)) {
    const key = personKey(person, input.mentionedById);
    if (key && !keys.has(key.nameKey)) keys.set(key.nameKey, key);
    if (keys.size === MAX_PEOPLE_PER_ITEM) break;
  }
  if (!keys.size) return [];
  await db.sagePersonMention.createMany({
    data: [...keys.values()].map((key) => ({
      coopId: input.coopId, nameKey: key.nameKey, displayName: key.displayName, relation: key.relation,
      mentionedById: input.mentionedById, sourceType: input.sourceType, sourceId: input.sourceId,
      ...(input.now ? { createdAt: input.now } : {}),
    })),
    skipDuplicates: true,
  });
  return [...keys.keys()];
}

function nameTokens(value: string | null | undefined): string[] {
  return (value ?? "").toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((token) => token.length > 1);
}

/** Whether a member's name or handle could be this person, so Sage doesn't ask to invite someone already here. */
export function mayBeMember(nameKey: string, members: Array<{ name: string | null; handle: string | null }>): boolean {
  if (nameKey.startsWith("rel:")) return false;
  const first = nameKey.split(" ")[0]!;
  return members.some((member) => nameTokens(member.name).includes(first) || (member.handle ?? "").toLowerCase().startsWith(first));
}

/** Whether an open or accepted invitation already names this person. */
export function alreadyInvited(nameKey: string, displayName: string, recipientNames: Array<string | null>): boolean {
  const wanted = nameKey.startsWith("rel:") ? nameTokens(displayName) : nameKey.split(" ");
  return recipientNames.some((recipient) => {
    const tokens = nameTokens(recipient);
    return wanted.length > 0 && wanted.every((token) => tokens.includes(token));
  });
}

export type PersonInviteResult = { created: boolean; actionId?: string; askedUserId?: string; reason: string };

/**
 * After a mention is recorded: if this person has come up often enough, ask one member whether to invite
 * them. Every rule here is deterministic; the model has no say in whether or whom Sage asks.
 */
export async function maybeSuggestPersonInvite(coopId: string, nameKey: string, now = new Date()): Promise<PersonInviteResult> {
  const config = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { joinPolicy: true, name: true } });
  if (config?.joinPolicy !== "INVITE_ONLY") return { created: false, reason: "Only families get invite suggestions" };

  const mentions = await db.sagePersonMention.findMany({
    where: { coopId, nameKey, createdAt: { gte: new Date(now.getTime() - MENTION_WINDOW_DAYS * DAY_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (mentions.length < MENTION_THRESHOLD) return { created: false, reason: `Mentioned ${mentions.length} of ${MENTION_THRESHOLD} times needed` };
  const latest = mentions[0]!;

  const recent = await db.commonsAction.findFirst({
    where: { coopId, sourceType: PERSON_INVITE_SOURCE, sourceId: { startsWith: `${nameKey}@` }, createdAt: { gte: new Date(now.getTime() - NAME_COOLDOWN_DAYS * DAY_MS) } },
    select: { id: true },
  });
  if (recent) return { created: false, actionId: recent.id, reason: "Sage already asked about this person recently" };

  const members = await db.userCoopMembership.findMany({
    where: { coopId, status: "ACTIVE", user: { deletedAt: null } },
    select: { userId: true, roles: true, status: true, user: { select: { name: true, handle: true, isBot: true } } },
    take: 500,
  });
  if (mayBeMember(nameKey, members.filter((member) => !member.user.isBot).map((member) => member.user))) {
    return { created: false, reason: "A member has that name, so they may already be here" };
  }
  const invitations = await db.commonsInvitation.findMany({
    where: { coopId, recipientName: { not: null }, OR: [{ status: { in: ["PENDING", "PENDING_APPROVAL", "ACCEPTED"] } }, { createdAt: { gte: new Date(now.getTime() - NAME_COOLDOWN_DAYS * DAY_MS) } }] },
    select: { recipientName: true },
    take: 500,
  });
  if (alreadyInvited(nameKey, latest.displayName, invitations.map((invitation) => invitation.recipientName))) {
    return { created: false, reason: "Someone with that name was already invited" };
  }

  // Ask the member who mentions them most (ties: most recent), if they're active and not already being asked.
  const tally = new Map<string, { count: number; last: number }>();
  for (const mention of mentions) {
    const entry = tally.get(mention.mentionedById) ?? { count: 0, last: 0 };
    tally.set(mention.mentionedById, { count: entry.count + 1, last: Math.max(entry.last, mention.createdAt.getTime()) });
  }
  const activeHumans = new Map(members.filter((member) => !member.user.isBot).map((member) => [member.userId, member]));
  const candidates = [...tally.entries()].filter(([userId]) => activeHumans.has(userId))
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last);
  let asked: string | null = null;
  for (const [userId] of candidates) {
    const busy = await db.commonsActionReview.findFirst({
      where: { userId, reviewType: PERSON_INVITE_REVIEW, OR: [{ status: "PENDING" }, { createdAt: { gte: new Date(now.getTime() - MEMBER_ASK_GAP_DAYS * DAY_MS) } }] },
      select: { id: true },
    });
    if (!busy) { asked = userId; break; }
  }
  if (!asked) return { created: false, reason: "Everyone who mentioned them was asked about someone else this week" };

  const direct = canInviteDirectlyMembership(activeHumans.get(asked)!);
  const name = latest.displayName;
  const count = mentions.length;
  const payload = { capability: "invite_person", name, relation: latest.relation ?? "", mentions: count };
  const hash = payloadHash(payload);
  const evidence = `${name} came up ${count} times in ${config.name ?? "the family"}'s posts and comments in the last ${MENTION_WINDOW_DAYS} days, and isn't a member.`;
  const action = await db.commonsAction.create({
    data: {
      coopId, sourceType: PERSON_INVITE_SOURCE, sourceId: `${nameKey}@${now.toISOString().slice(0, 10)}`, sourcePostId: latest.sourceId,
      sourceAuthorId: asked, contentHash: hash, position: 0, type: "SUGGEST_ACTION", status: "PENDING",
      summary: `Invite ${name}?`, evidence, confidence: 1, charterConfigId: "sage-person-invite:v1",
      payload, payloadHash: hash, revision: 1,
      participants: { create: [{ userId: asked, role: "SUBJECT" }] },
      reviews: { create: {
        userId: asked, reviewType: PERSON_INVITE_REVIEW, payloadHash: hash, status: "PENDING",
        presentationData: {
          title: `Should we invite ${name}?`,
          body: direct
            ? `${name} keeps coming up. Add a phone number or email and the invitation goes out right away. They decide whether to join.`
            : `${name} keeps coming up. Add a phone number or email and a steward can send the invitation with one tap. They decide whether to join.`,
          name, direct,
        },
      } },
      auditEvents: { create: { eventType: "SUGGESTION_CREATED", metadata: { kind: "person_invite", mentions: count } } },
    },
    select: { id: true },
  });
  await createNotificationAndPush(db, {
    userId: asked, coopId, type: "SAGE_SUGGESTION_NEEDS_YOU",
    title: `Should we invite ${name}?`, body: `${name} has come up ${count} times lately. Want to invite them?`,
    data: { actionId: action.id },
  }).catch((error) => console.error("Could not notify about person invite", error));
  return { created: true, actionId: action.id, askedUserId: asked, reason: `Mentioned ${count} times` };
}

const InvitePayloadZ = z.object({
  name: z.string().trim().min(1, "Add their name.").max(80),
  email: z.string().trim().max(200).optional().transform((value) => value || undefined),
  phone: z.string().trim().max(40).optional().transform((value) => value || undefined),
});

/**
 * The member said yes and gave contact details. Creates the invitation through the normal path (which
 * checks membership, validates the contact, dedupes and rate-limits), then records the outcome.
 */
export async function invitePersonFromReview(
  database: Context["db"],
  params: {
    action: { id: string; coopId: string; payload: unknown };
    review: { id: string };
    user: { id: string; email: string; name: string | null; handle: string | null; phone: string | null };
    input: Record<string, unknown> | undefined;
  },
) {
  const parsed = InvitePayloadZ.safeParse(params.input ?? {});
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Check the details." });
  const { name, email, phone } = parsed.data;
  const mentions = (params.action.payload as { mentions?: unknown } | null)?.mentions;
  const membership = await getMembership(database, params.user.id, params.action.coopId);
  const result = await createCommonsInvitation(database, {
    coopId: params.action.coopId, inviter: params.user, email, phone, recipientName: name,
    stewardNote: typeof mentions === "number" ? `Sage noticed ${name} came up ${mentions} times in the family feed.` : undefined,
  });
  const now = new Date();
  await database.$transaction([
    database.commonsActionReview.update({ where: { id: params.review.id }, data: { status: "APPROVED", respondedAt: now } }),
    database.commonsAction.update({ where: { id: params.action.id }, data: { status: "APPROVED", reviewedBy: params.user.id, reviewedAt: now } }),
    database.commonsActionAudit.create({ data: { actionId: params.action.id, actorId: params.user.id, eventType: "REVIEW_APPROVED", metadata: { reviewType: PERSON_INVITE_REVIEW } } }),
    database.commonsActionAudit.create({ data: {
      actionId: params.action.id, actorId: params.user.id, eventType: "ACTION_EXECUTED",
      metadata: { kind: "person_invite", resultEntityType: "CommonsInvitation", resultEntityId: result.invitationId, invitationStatus: result.status, alreadyInvited: result.alreadyInvited },
    } }),
  ]);
  return {
    invitationStatus: result.status, alreadyInvited: result.alreadyInvited,
    sentDirectly: canInviteDirectlyMembership(membership) && result.status === "PENDING",
  };
}

/** Mentions are only needed to count repeats; drop them after 60 days. */
export async function purgePersonMentions(coopId: string, now = new Date()) {
  return db.sagePersonMention.deleteMany({ where: { coopId, createdAt: { lt: new Date(now.getTime() - MENTION_RETENTION_DAYS * DAY_MS) } } });
}

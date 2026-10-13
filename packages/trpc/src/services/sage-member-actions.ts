import { db } from "@repo/db";

import { ensureSageBotUser } from "../lib/bot.js";
import { askIntroductionHelper, createIntroductionSuggestion } from "./sage-introductions.js";
import { enqueueSageActionExecute } from "./sage-dispatch.js";
import { payloadHash } from "./sage-ride-match-agent.js";
import { checkSageOutput, cleanseUntrustedText } from "./untrusted-input.js";

/**
 * Actions Sage takes for a member from a private conversation (a check-in or a DM). The model can only
 * propose; publishing or introducing waits for the member's plain "yes" to the exact ask, which code
 * checks here. Posts go out from Sage's own account without the member's name, so the member stays
 * anonymous; anyone who replies is relayed back privately with an offer of the usual two-sided
 * introduction.
 *
 * A proposal is an ordinary CommonsAction + review (APPROVE_SUGGESTION, or ACCEPT_INTRODUCTION for an
 * introduction), so it is hash-checked, audited and visible in the member's Sage suggestions too. The
 * review's presentationData.conversationGroupId ties it to the conversation where Sage asked.
 */

export const MEMBER_POST_SOURCE = "sage_member_post";
export const MEMBER_POST_CAPABILITY = "post_for_member";
export const MEMBER_POST_TAGS = ["Ask", "Need", "Opportunity", "Offer"] as const;
export type MemberPostTag = (typeof MEMBER_POST_TAGS)[number];
export const MEMBER_POSTS_PER_DAY = 1;
export const MEMBER_POST_FOLLOW_UP_DAYS = 3;
const ASK_TTL_MS = 3 * 86_400_000;
const DAY_MS = 86_400_000;

const YES = new Set(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please do", "do it", "go ahead", "post it", "yes please", "sounds good", "please"]);
const NO = new Set(["no", "nope", "no thanks", "not now", "cancel", "dont", "don't", "never mind", "nevermind"]);

/** Only a short, unambiguous answer counts. "Yes but change the title" goes back to the model instead. */
export function confirmationAnswer(content: string): "YES" | "NO" | null {
  const normalized = content.trim().toLowerCase().replace(/[.!,]+$/g, "").replace(/\s+/g, " ");
  if (YES.has(normalized)) return "YES";
  if (NO.has(normalized)) return "NO";
  return null;
}

type Member = { id: string; name: string | null; email: string; handle?: string | null };

/** True if the text would identify the member: their name, handle or email. Posts stay anonymous. */
export function mentionsMember(text: string, member: Member): boolean {
  const haystack = text.toLowerCase();
  const tokens = [
    ...(member.name ?? "").split(/\s+/),
    member.email.split("@")[0] ?? "",
    member.handle ?? "",
  ].map((token) => token.trim().toLowerCase()).filter((token) => token.length >= 3);
  return tokens.some((token) => new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(haystack));
}

/** The Commons a member is active in, with their display names. */
export async function memberCommons(userId: string): Promise<Array<{ coopId: string; name: string }>> {
  const memberships = await db.userCoopMembership.findMany({ where: { userId, status: "ACTIVE" }, select: { coopId: true }, take: 50 });
  if (!memberships.length) return [];
  const configs = await db.coopConfig.findMany({
    where: { coopId: { in: memberships.map((membership) => membership.coopId) }, isActive: true },
    orderBy: [{ coopId: "asc" }, { version: "desc" }], select: { coopId: true, name: true },
  });
  const names = new Map<string, string>();
  for (const config of configs) if (!names.has(config.coopId)) names.set(config.coopId, config.name || config.coopId);
  return memberships.map((membership) => ({ coopId: membership.coopId, name: names.get(membership.coopId) ?? membership.coopId }));
}

/** Retires earlier unanswered asks in the conversation, so a "yes" only ever answers the newest one. */
async function supersedePendingAsks(userId: string, conversationGroupId: string) {
  const pending = await db.commonsActionReview.findMany({
    where: { userId, status: "PENDING", presentationData: { path: ["conversationGroupId"], equals: conversationGroupId } },
    select: { id: true, actionId: true },
  });
  for (const review of pending) {
    await db.commonsActionReview.update({ where: { id: review.id }, data: { status: "SUPERSEDED" } });
    await db.commonsAction.updateMany({ where: { id: review.actionId, status: "PENDING" }, data: { status: "DISMISSED" } });
    await db.commonsActionAudit.create({ data: { actionId: review.actionId, eventType: "ASK_SUPERSEDED", metadata: { conversationGroupId } } });
  }
}

export type Proposal = { ok: true; ask: string; actionId: string } | { ok: false; reason: string };

/** Saves a post Sage would publish for the member and returns the exact question to ask them. */
export async function proposeMemberPost(input: {
  memberId: string; conversationGroupId: string; coopId: string; title: string; body: string; tag: MemberPostTag; now?: Date;
}): Promise<Proposal> {
  const now = input.now ?? new Date();
  const member = await db.user.findUnique({ where: { id: input.memberId }, select: { id: true, name: true, email: true, handle: true } });
  if (!member) return { ok: false, reason: "Member not found" };
  const commons = (await memberCommons(member.id)).find((entry) => entry.coopId === input.coopId);
  if (!commons) return { ok: false, reason: "The member isn't an active member of that Commons. Ask which of their Commons to use (list_my_commons)." };
  if (!MEMBER_POST_TAGS.includes(input.tag)) return { ok: false, reason: `tag must be one of ${MEMBER_POST_TAGS.join(", ")}` };
  const title = input.title.trim().slice(0, 120);
  const body = input.body.trim().slice(0, 1500);
  if (!title || !body) return { ok: false, reason: "The post needs a title and a body" };
  const check = checkSageOutput(`${title}\n${body}`);
  if (!check.ok) return { ok: false, reason: `The post can't include links, @mentions or claims that something was done (${check.problems.join(", ")}). Rewrite it.` };
  if (mentionsMember(`${title}\n${body}`, member)) {
    return { ok: false, reason: "The post would identify the member. Sage posts anonymously (\"A member is looking for...\"); remove their name, handle and email." };
  }
  const postedToday = await db.commonsAction.count({
    where: { sourceType: MEMBER_POST_SOURCE, sourceAuthorId: member.id, status: "APPROVED", reviewedAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  if (postedToday >= MEMBER_POSTS_PER_DAY) return { ok: false, reason: "Sage already posted for this member in the last day. Offer to post again tomorrow." };

  await supersedePendingAsks(member.id, input.conversationGroupId);
  const payload = { capability: MEMBER_POST_CAPABILITY, title, body, tag: input.tag, conversationGroupId: input.conversationGroupId };
  const hash = payloadHash(payload);
  const sourceId = `${member.id}:${now.getTime()}`;
  const action = await db.commonsAction.create({
    data: {
      coopId: commons.coopId, sourceType: MEMBER_POST_SOURCE, sourceId, sourcePostId: sourceId, sourceAuthorId: member.id,
      contentHash: hash, position: 0, type: "SUGGEST_ACTION", status: "PENDING",
      summary: `Post in ${commons.name}: ${title}`.slice(0, 2000), evidence: "The member asked for help in a private conversation with Sage.",
      confidence: 1, charterConfigId: "sage-member-post:v1", payload, payloadHash: hash, revision: 1,
      participants: { create: { userId: member.id, role: "SUBJECT" } },
      reviews: { create: {
        userId: member.id, reviewType: "APPROVE_SUGGESTION", payloadHash: hash, status: "PENDING",
        presentationData: {
          title, body, capability: MEMBER_POST_CAPABILITY, commonsName: commons.name, conversationGroupId: input.conversationGroupId,
          reason: `Sage will post this in ${commons.name} from its own account, without your name.`,
        },
      } },
      auditEvents: { create: { eventType: "SUGGESTION_CREATED", metadata: { kind: "member_post", tag: input.tag } } },
    },
    select: { id: true },
  });
  return {
    ok: true, actionId: action.id,
    ask: `Here's what I'd post in ${commons.name}. It comes from Sage, without your name:\n\n${title}\n${body}\n\nWant me to post it? Reply yes, or tell me what to change.`,
  };
}

/** Offers the member a consent-first introduction to someone whose profile fits their need. */
export async function proposeIntroduction(input: {
  memberId: string; conversationGroupId: string; coopId: string; helperUserId: string; need: string; matched: string[];
}): Promise<Proposal> {
  const commons = (await memberCommons(input.memberId)).find((entry) => entry.coopId === input.coopId);
  if (!commons) return { ok: false, reason: "The member isn't an active member of that Commons." };
  const created = await createIntroductionSuggestion({
    coopId: input.coopId, needUserId: input.memberId, helperUserId: input.helperUserId,
    needSummary: input.need, reason: "The member asked for help in a private conversation with Sage.",
  });
  if (!created.created || !created.actionId) return { ok: false, reason: created.reason ?? "Couldn't suggest that introduction" };
  return attachAsk(created.actionId, input.memberId, input.conversationGroupId,
    `Someone in ${commons.name} lists ${input.matched.slice(0, 3).join(", ")} on their profile. Want me to introduce you? Nothing is shared until you both say yes. Reply yes or no.`);
}

/** Ties an introduction's review to this conversation so the member can answer it here. */
async function attachAsk(actionId: string, memberId: string, conversationGroupId: string, ask: string): Promise<Proposal> {
  const review = await db.commonsActionReview.findFirst({ where: { actionId, userId: memberId, status: "PENDING" }, select: { id: true, presentationData: true } });
  if (!review) return { ok: false, reason: "The introduction is no longer waiting for an answer" };
  await supersedePendingAsks(memberId, conversationGroupId);
  await db.commonsActionReview.update({
    where: { id: review.id },
    data: { status: "PENDING", presentationData: { ...((review.presentationData as object | null) ?? {}), conversationGroupId } },
  });
  return { ok: true, ask, actionId };
}

/**
 * The member's reply to Sage's latest ask in this conversation. A plain yes or no is handled here,
 * without a model call; anything else returns null and the conversation continues normally. The caller
 * posts `reply` (if any) and then runs `afterReply` (if any).
 */
export async function handleConversationConfirmation(input: {
  conversationGroupId: string; memberId: string; sageId: string; content: string; now?: Date;
}): Promise<{ reply?: string; afterReply?: () => Promise<void> } | null> {
  const answer = confirmationAnswer(input.content);
  if (!answer) return null;
  const now = input.now ?? new Date();
  const review = await db.commonsActionReview.findFirst({
    where: {
      userId: input.memberId, status: "PENDING", reviewType: { in: ["APPROVE_SUGGESTION", "ACCEPT_INTRODUCTION"] },
      createdAt: { gte: new Date(now.getTime() - ASK_TTL_MS) },
      presentationData: { path: ["conversationGroupId"], equals: input.conversationGroupId },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!review) return null;
  // The ask must be the last thing Sage said, so "yes" can't answer a question that's scrolled away.
  const lastSage = await db.groupComment.findFirst({
    where: { groupId: input.conversationGroupId, authorId: input.sageId }, orderBy: { createdAt: "desc" }, select: { createdAt: true },
  });
  if (!lastSage || lastSage.createdAt < review.updatedAt) return null;
  const action = await db.commonsAction.findUnique({ where: { id: review.actionId } });
  if (!action || action.status !== "PENDING" || action.payloadHash !== review.payloadHash) return null;

  const claimed = await db.commonsActionReview.updateMany({
    where: { id: review.id, status: "PENDING" }, data: { status: answer === "YES" ? "APPROVED" : "DECLINED", respondedAt: now },
  });
  if (!claimed.count) return null;
  const isPost = review.reviewType === "APPROVE_SUGGESTION";
  const commonsName = String((review.presentationData as { commonsName?: unknown } | null)?.commonsName ?? "the Commons");
  if (answer === "NO") {
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "DISMISSED" } });
    await db.commonsActionAudit.create({ data: { actionId: action.id, actorId: input.memberId, eventType: "REVIEW_DECLINED", metadata: { reviewType: review.reviewType, via: "conversation" } } });
    return { reply: isPost ? "Okay, I won't post it." : "Okay, I won't make the introduction." };
  }
  await db.commonsActionAudit.create({ data: { actionId: action.id, actorId: input.memberId, eventType: "REVIEW_APPROVED", metadata: { reviewType: review.reviewType, via: "conversation" } } });
  // Publishing sends its own "It's posted" message in this conversation, after the post exists.
  if (isPost) return { afterReply: () => enqueueSageActionExecute(action.id, action.revision) };
  await askIntroductionHelper(action.id);
  return { reply: "I've asked them. If they say yes too, I'll start a private chat for the two of you." };
}

async function sendInConversation(conversationGroupId: string, content: string) {
  const group = await db.group.findUnique({ where: { id: conversationGroupId }, select: { id: true, coopId: true, directKey: true } });
  if (!group) return;
  const sage = await ensureSageBotUser(db, group.coopId);
  const { sendDirectCircleMessage } = await import("./direct-circles.js");
  await sendDirectCircleMessage(db, { group, sender: sage, content });
}

/** The member's post this comment answers, if Sage posted it for them. */
async function memberPostFor(postId: string) {
  const post = await db.commonsPost.findUnique({ where: { id: postId }, select: { id: true, coopId: true, title: true, classificationSignals: true } });
  const signals = post?.classificationSignals as { source?: unknown; actionId?: unknown } | null;
  if (!post || signals?.source !== MEMBER_POST_SOURCE || typeof signals.actionId !== "string") return null;
  const action = await db.commonsAction.findUnique({ where: { id: signals.actionId }, select: { id: true, payload: true, participants: { where: { role: "SUBJECT" }, select: { userId: true } } } });
  const memberId = action?.participants[0]?.userId;
  const conversationGroupId = (action?.payload as { conversationGroupId?: unknown } | null)?.conversationGroupId;
  if (!action || !memberId || typeof conversationGroupId !== "string") return null;
  return { post, actionId: action.id, memberId, conversationGroupId };
}

/**
 * Someone replied to a post Sage made for a member. Sage tells the member privately, quoting the reply,
 * and offers the two-sided introduction. Once per person per post; Sage's and the member's own
 * comments are ignored.
 */
export async function relayReplyToMember(commentId: string): Promise<"RELAYED" | "SKIPPED"> {
  const comment = await db.commonsComment.findUnique({
    where: { id: commentId }, select: { id: true, postId: true, content: true, authorId: true, author: { select: { isBot: true } } },
  });
  if (!comment || comment.author.isBot) return "SKIPPED";
  const target = await memberPostFor(comment.postId);
  if (!target || comment.authorId === target.memberId) return "SKIPPED";
  const already = await db.commonsActionAudit.findFirst({
    where: { actionId: target.actionId, eventType: "REPLY_RELAYED", metadata: { path: ["commenterId"], equals: comment.authorId } }, select: { id: true },
  });
  if (already) return "SKIPPED";
  await db.commonsActionAudit.create({ data: { actionId: target.actionId, eventType: "REPLY_RELAYED", metadata: { commenterId: comment.authorId, commentId: comment.id } } });

  const commons = (await memberCommons(target.memberId)).find((entry) => entry.coopId === target.post.coopId);
  const excerpt = cleanseUntrustedText(comment.content, { maxChars: 240 }).text;
  const intro = await createIntroductionSuggestion({
    coopId: target.post.coopId, needUserId: target.memberId, helperUserId: comment.authorId,
    needSummary: target.post.title, reason: "They replied to the post Sage made for the member.",
  });
  const heard = `Someone replied to your post in ${commons?.name ?? "the Commons"}: “${excerpt}”`;
  if (intro.created && intro.actionId) {
    const asked = await attachAsk(intro.actionId, target.memberId, target.conversationGroupId,
      `${heard}\n\nWant me to introduce you? Nothing is shared until you both say yes. Reply yes or no.`);
    if (asked.ok) {
      await sendInConversation(target.conversationGroupId, asked.ask);
      return "RELAYED";
    }
  }
  await sendInConversation(target.conversationGroupId, `${heard}\n\nYou can answer them on the post.`);
  return "RELAYED";
}

/** The wake loop's nudge when nobody has answered the member's post yet. */
export async function remindAboutMemberPost(task: { postId: string | null; subjectId: string }): Promise<void> {
  const target = await memberPostFor(task.postId ?? task.subjectId);
  if (!target) return;
  const commons = (await memberCommons(target.memberId)).find((entry) => entry.coopId === target.post.coopId);
  await sendInConversation(target.conversationGroupId,
    `Nobody has replied to your post in ${commons?.name ?? "the Commons"} yet. Want me to look for other openings, or introduce you to someone whose profile fits?`);
}

/** Lets Sage change when it checks back on the member's latest post from this conversation. */
export async function rescheduleMemberPostFollowUp(input: { memberId: string; conversationGroupId: string; days: number; now?: Date }) {
  const now = input.now ?? new Date();
  const days = Math.min(14, Math.max(1, Math.round(input.days)));
  const latest = await db.commonsAction.findFirst({
    where: { sourceType: MEMBER_POST_SOURCE, sourceAuthorId: input.memberId, payload: { path: ["conversationGroupId"], equals: input.conversationGroupId } },
    orderBy: { createdAt: "desc" }, select: { id: true, status: true },
  });
  if (!latest) return { ok: false as const, reason: "There's no post from this conversation to follow up on yet." };
  if (latest.status === "PENDING") return { ok: false as const, reason: "The post isn't published yet. Sage follows up automatically once it is." };
  const task = await db.sageTask.findFirst({ where: { sourceActionId: latest.id, subjectType: "member_post", status: "OPEN" }, select: { id: true } });
  if (!task) return { ok: false as const, reason: "Sage isn't following that post anymore." };
  const nextWakeAt = new Date(now.getTime() + days * DAY_MS);
  await db.sageTask.update({ where: { id: task.id }, data: { dueAt: nextWakeAt, nextWakeAt, events: { create: { eventType: "RESCHEDULED", detail: `Check back in ${days} days` } } } });
  return { ok: true as const, days };
}

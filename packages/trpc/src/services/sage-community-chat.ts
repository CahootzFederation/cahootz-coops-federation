import { TRPCError } from "@trpc/server";

import type { Context } from "../context.js";
import { runSageCommonsReply } from "../agents/registry.js";
import { requireActiveMember } from "./commons-membership.js";
import { loadMemberMemory, memberMemoryLines } from "./sage-member-memory.js";
import { claimSageMessage, listSagePacks, readSageAllowance, releaseSageMessage } from "./sage-message-allowance.js";
import { safeFirstName } from "./sage-reply-templates.js";
import { traceSageReply } from "./sage-reply-trails.js";
import { cleanseUntrustedText } from "./untrusted-input.js";

type Db = Context["db"];

/**
 * Ask Sage: a member's private chat with Sage about one Commons, apart from the post board. Each answer
 * Sage writes with a model uses one message from the member's allowance (see sage-message-allowance.ts).
 * The chat is a source interaction: it's kept here, and nothing in it becomes Sage memory on its own.
 */

const DAY = 24 * 60 * 60 * 1000;
export const CHAT_PAGE_SIZE = 50;
/** Earlier turns Sage reads for continuity. */
export const CHAT_HISTORY_TURNS = 12;
const SNAPSHOT_DAYS = 14;
const SNAPSHOT_POSTS = 15;
const SNAPSHOT_CHARS = 6000;

const realPerson = { isBot: false, deletedAt: null };

function shortDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function snippet(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * What members of this Commons can already see: published Pulse cards, recent General-feed posts,
 * upcoming General events and open proposals. Never private circles, DMs, member memory or names.
 */
export async function buildCommunitySnapshot(db: Db, coopId: string, now = new Date()) {
  const general = { OR: [{ circleId: null }, { circleId: `general:${coopId}` }] };
  const [pulse, posts, events, proposals] = await Promise.all([
    db.aIObservation.findMany({
      where: {
        type: "community_pulse", scopeType: "commons", scopeId: coopId, visibility: "COMMONS_MEMBERS", status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" }, take: 3, select: { summary: true },
    }),
    db.commonsPost.findMany({
      where: { coopId, ...general, author: realPerson, createdAt: { gte: new Date(now.getTime() - SNAPSHOT_DAYS * DAY), lte: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: SNAPSHOT_POSTS,
      select: { title: true, content: true, tag: true, createdAt: true, _count: { select: { comments: true } } },
    }),
    db.event.findMany({
      where: { coopId, ...general, startAt: { gte: now } },
      orderBy: { startAt: "asc" }, take: 5,
      select: { startAt: true, isOnline: true, post: { select: { title: true } } },
    }),
    db.proposal.findMany({
      where: { coopId, status: { in: ["SUBMITTED", "VOTABLE"] } },
      orderBy: { createdAt: "desc" }, take: 5, select: { title: true, status: true },
    }),
  ]);

  const sections: string[] = [];
  if (pulse.length) sections.push(`Community Pulse:\n${pulse.map((row) => `- ${snippet(row.summary, 300)}`).join("\n")}`);
  if (posts.length) {
    sections.push(`Recent posts (last ${SNAPSHOT_DAYS} days, newest first):\n${posts.map((post) => {
      const replies = post._count.comments === 1 ? "1 reply" : `${post._count.comments} replies`;
      return `- ${shortDate(post.createdAt)} · ${post.tag} · "${snippet(post.title, 100)}": ${snippet(post.content, 200)} (${replies})`;
    }).join("\n")}`);
  }
  if (events.length) {
    sections.push(`Upcoming events:\n${events.map((event) =>
      `- ${shortDate(event.startAt)}: ${snippet(event.post.title, 100)}${event.isOnline ? " (online)" : ""}`).join("\n")}`);
  }
  if (proposals.length) {
    sections.push(`Open proposals:\n${proposals.map((proposal) =>
      `- ${snippet(proposal.title, 120)} (${proposal.status === "VOTABLE" ? "voting open" : "under review"})`).join("\n")}`);
  }
  if (!sections.length) return "";
  return cleanseUntrustedText(sections.join("\n\n"), { maxChars: SNAPSHOT_CHARS }).text;
}

function mapMessage(message: { id: string; role: string; content: string; createdAt: Date }) {
  return { id: message.id, fromSage: message.role === "SAGE", body: message.content, createdAt: message.createdAt.toISOString() };
}

async function commonsName(db: Db, coopId: string) {
  const config = await db.coopConfig.findFirst({
    where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { name: true },
  });
  return config?.name || coopId;
}

export async function loadSageChat(db: Db, input: { userId: string; coopId: string; before?: string; now?: Date }) {
  await requireActiveMember(db, input.userId, input.coopId);
  const records = await db.sageChatMessage.findMany({
    where: { userId: input.userId, coopId: input.coopId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_PAGE_SIZE + 1,
    ...(input.before ? { cursor: { id: input.before }, skip: 1 } : {}),
  });
  const hasMore = records.length > CHAT_PAGE_SIZE;
  const page = (hasMore ? records.slice(0, CHAT_PAGE_SIZE) : records).reverse();
  const name = await commonsName(db, input.coopId);
  const [allowance, store] = await Promise.all([
    readSageAllowance(db, { userId: input.userId, coopId: input.coopId, now: input.now }),
    listSagePacks(db, input.coopId, name),
  ]);
  return {
    coopId: input.coopId,
    commonsName: name,
    messages: page.map(mapMessage),
    olderCursor: hasMore ? page[0]!.id : null,
    allowance: { ...allowance, resetsAt: allowance.resetsAt.toISOString() },
    storeReady: store.storeReady,
    packs: store.packs,
  };
}

class OutOfSageMessagesError extends Error {}

export async function sendSageChatMessage(
  db: Db,
  input: { userId: string; coopId: string; content: string; now?: Date },
) {
  await requireActiveMember(db, input.userId, input.coopId);
  const content = input.content.trim();
  if (!content) throw new TRPCError({ code: "BAD_REQUEST", message: "Type a message for Sage first." });

  // Out of messages: nothing is saved, so the member's text stays in the box.
  const before = await readSageAllowance(db, { userId: input.userId, coopId: input.coopId, now: input.now });
  if (before.left <= 0) return { status: "OUT_OF_MESSAGES" as const, messages: [] };

  const [sender, prior] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { name: true } }),
    db.sageChatMessage.findMany({
      where: { userId: input.userId, coopId: input.coopId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CHAT_HISTORY_TURNS,
    }),
  ]);
  const message = await db.sageChatMessage.create({
    data: { userId: input.userId, coopId: input.coopId, role: "MEMBER", content },
  });
  const firstName = safeFirstName(sender?.name ?? null) ?? undefined;
  const threadContext = prior.reverse()
    .map((turn) => `${turn.role === "SAGE" ? "Sage" : firstName ?? "Member"}: ${turn.content}`).join("\n");

  let claimed = false;
  let reply: { id: string; role: string; content: string; createdAt: Date } | null = null;
  try {
    const [snapshot, remembered] = await Promise.all([
      buildCommunitySnapshot(db, input.coopId, input.now),
      loadMemberMemory({ memberId: input.userId, purpose: "sage chat reply", focusCoopId: input.coopId, before: message.createdAt })
        .then(memberMemoryLines).catch(() => [] as string[]),
    ]);
    await traceSageReply(
      { kind: "chat", coopId: input.coopId, messageId: message.id },
      { message: content, threadContext: threadContext || undefined, threadCount: prior.length, remembered },
      async (cleanMessage, thread) => {
        // Only a model answer uses a message; refusals above this point are fixed replies and free.
        const claim = await claimSageMessage(db, {
          userId: input.userId, coopId: input.coopId, source: "CHAT", sourceId: message.id, now: input.now,
        });
        if (!claim.ok) throw new OutOfSageMessagesError();
        claimed = true;
        const answered = await runSageCommonsReply({
          coopId: input.coopId, message: cleanMessage, threadContext: thread, channel: "chat",
          communityContext: snapshot, memberMemory: remembered, memberName: firstName,
        });
        // No real answer (the stock "I'm not sure" reply) doesn't use a message.
        if (answered.grounding?.usedFallback) {
          await releaseSageMessage(db, { source: "CHAT", sourceId: message.id });
          claimed = false;
        }
        return answered;
      },
      async (text) => {
        reply = await db.sageChatMessage.create({
          data: { userId: input.userId, coopId: input.coopId, role: "SAGE", content: text },
        });
      },
    );
  } catch (error) {
    // The answer was already saved (only the trail failed to record), so the member keeps it.
    if (reply) return { status: "SENT" as const, messages: [message, reply].map(mapMessage) };
    if (claimed) await releaseSageMessage(db, { source: "CHAT", sourceId: message.id }).catch(console.error);
    await db.sageChatMessage.delete({ where: { id: message.id } }).catch(console.error);
    if (error instanceof OutOfSageMessagesError) return { status: "OUT_OF_MESSAGES" as const, messages: [] };
    console.error("Ask Sage reply failed:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Sage couldn't answer just now. That message didn't count, so try again in a minute.",
    });
  }
  return { status: "SENT" as const, messages: [message, ...(reply ? [reply] : [])].map(mapMessage) };
}

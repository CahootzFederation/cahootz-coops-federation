import { tool } from "@openai/agents";
import { db } from "@repo/db";
import { z } from "zod";

import {
  MEMBER_POST_TAGS, memberCommons, proposeIntroduction, proposeMemberPost, rescheduleMemberPostFollowUp,
} from "../../services/sage-member-actions.js";
import { scheduleMemberCheckIn } from "../../services/sage-proactive.js";
import { cleanseUntrustedText } from "../../services/untrusted-input.js";
import { buildCommentTools } from "./comment-tools.js";
import { findMembersForNeed } from "./specialist-tools.js";

/**
 * Sage's member action toolkit: what an agent may do for one member it is talking to privately.
 * Hand any agent these tools with `buildMemberActionTools({ memberId, conversationGroupId })`.
 *
 * - list_my_commons, search_opportunities: read-only, scoped to the member's own Commons.
 * - propose_post, suggest_introduction: never act directly. They save a proposal, and the exact question
 *   for the member is added to the agent's reply by the caller (`state.asks`). A plain "yes" from the member
 *   is checked in code (handleConversationConfirmation) before anything is published or shared.
 * - follow_up_later: changes when Sage checks back on a post it made for the member.
 * - schedule_check_in: Sage promises to message the member back about something later, and does.
 *
 * Every tool returns { ok, ... } rather than throwing, so the model can explain a refusal to the member.
 *
 * buildSageReplyTools hands the same toolkit to a public @mention reply, minus what needs a private
 * conversation (see there), so Sage can do nearly the same things in a thread as in a DM.
 */

export interface MemberActionContext {
  memberId: string;
  /** The private conversation (DM group) where Sage is talking with the member. */
  conversationGroupId: string;
}

/** Where a Sage reply is going: the member's private DM with Sage, or a public thread in one Commons. */
export type SageReplyPlace =
  | { kind: "dm"; memberId: string; conversationGroupId: string; coopId: string }
  | { kind: "thread"; memberId: string; coopId: string };

export interface MemberActionState {
  /** Exact questions to append to the agent's reply, in order. Only the last one can be answered with "yes". */
  asks: string[];
  /** What the tools did, for the decision trail. */
  log: string[];
}

export const MEMBER_ACTION_INSTRUCTIONS = [
  "You can act for this member with tools instead of only giving advice:",
  "- search_opportunities first when they need something (work, a ride, food, a skill). Mention what you found in plain words.",
  "- propose_post when it would help to ask their Commons. Write it so it never names or identifies them (\"A member is looking for...\"). Use list_my_commons and, if they're in more than one Commons, ask which one before proposing.",
  "- suggest_introduction when someone's profile fits their need.",
  "- follow_up_later if they want you to check back on their post sooner or later than three days.",
  "- schedule_check_in whenever you say you'll check back with them about something (an interview, an appointment, how a plan went), or they ask you to. Then you can honestly say you will.",
  "After propose_post or suggest_introduction, the exact post or introduction and the yes/no question are shown right after your reply. So keep your reply to one short sentence, don't quote or restate the post, and don't ask for confirmation yourself. Never claim you posted or introduced anyone; that only happens after they say yes.",
].join("\n");

/** The same toolkit in a public thread: what it finds can be read by everyone in this Commons. */
export const THREAD_ACTION_INSTRUCTIONS = [
  "You can look things up and act for this member with tools instead of only giving advice:",
  "- search_opportunities when they need something (work, a ride, food, a skill). It only searches this Commons. Mention what you found in plain words.",
  "- search_commons_documents, list_commons_resources and count_members_offering for facts the thread lacks (guides, what members have shared, how many could help).",
  "- schedule_check_in whenever you say you'll check back with them about something, or they ask you to. You'll message them privately then, so you can honestly say you will.",
  "This reply is public. Never mention their other Commons or anything private about them. If posting anonymously or an introduction would help, tell them to message you directly and you can set it up there.",
].join("\n");

/** Extra read-only lookups a DM reply shares with the public reply and the feed agent. */
const DM_LOOKUP_INSTRUCTIONS = "- search_commons_documents, list_commons_resources and count_members_offering for facts about this Commons (guides, what members have shared, how many could help).";

const snippet = (text: string | null | undefined, max = 160) => cleanseUntrustedText(text ?? "", { maxChars: max }).text;

function searchWords(query: string): string[] {
  return [...new Set(query.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2))].slice(0, 6);
}

export function buildMemberActionTools(ctx: MemberActionContext, state: MemberActionState = { asks: [], log: [] }, options: { onlyCoopId?: string; coopId?: string } = {}) {
  const listMyCommons = tool({
    name: "list_my_commons",
    description: "The Commons this member belongs to (coopId and name). Use it to choose or ask where to post.",
    parameters: z.object({}),
    execute: async () => {
      const commons = await memberCommons(ctx.memberId);
      state.log.push(`Listed the member's ${commons.length} Commons`);
      return { ok: true, commons };
    },
  });

  const searchOpportunities = tool({
    name: "search_opportunities",
    description: "Read-only search of the member's Commons for posts (openings, offers, resources), member stores, published resources and upcoming events that match what they need. No names are returned.",
    parameters: z.object({
      query: z.string().min(2).max(200),
      coopId: z.string().nullable().default(null).describe("Limit to one of the member's Commons, or null for all of them"),
    }),
    execute: async ({ query, coopId }) => {
      const commons = (await memberCommons(ctx.memberId)).filter((entry) => !options.onlyCoopId || entry.coopId === options.onlyCoopId);
      const scoped = coopId ? commons.filter((entry) => entry.coopId === coopId) : commons;
      const words = searchWords(query);
      if (!scoped.length || !words.length) return { ok: true, posts: [], stores: [], resources: [], events: [] };
      const coopIds = scoped.map((entry) => entry.coopId);
      const nameOf = new Map(scoped.map((entry) => [entry.coopId, entry.name]));
      const textMatch = (fields: string[]) => ({ OR: words.flatMap((word) => fields.map((field) => ({ [field]: { contains: word, mode: "insensitive" as const } }))) });
      const now = new Date();
      const [posts, stores, resources, events] = await Promise.all([
        db.commonsPost.findMany({
          where: { coopId: { in: coopIds }, AND: [{ OR: [{ circleId: null }, { circleId: { in: coopIds.map((id) => `general:${id}`) } }] }, textMatch(["title", "content"])] },
          orderBy: { createdAt: "desc" }, take: 5, select: { id: true, coopId: true, tag: true, title: true, content: true, createdAt: true },
        }),
        db.store.findMany({
          where: { coopId: { in: coopIds }, status: "APPROVED", deletedAt: null, ...textMatch(["name", "description"]) },
          take: 5, select: { id: true, coopId: true, name: true, description: true, category: true },
        }),
        db.commonsResource.findMany({
          where: { coopId: { in: coopIds }, status: "PUBLISHED", ...textMatch(["title", "description"]) },
          take: 5, select: { id: true, coopId: true, kind: true, title: true, description: true },
        }),
        db.event.findMany({
          where: { coopId: { in: coopIds }, startAt: { gte: now }, post: textMatch(["title", "content"]) },
          orderBy: { startAt: "asc" }, take: 5, select: { id: true, coopId: true, startAt: true, post: { select: { id: true, title: true } } },
        }),
      ]);
      state.log.push(`Searched for "${query.slice(0, 60)}": ${posts.length} posts, ${stores.length} stores, ${resources.length} resources, ${events.length} events`);
      return {
        ok: true,
        posts: posts.map((post) => ({ postId: post.id, commons: nameOf.get(post.coopId), tag: post.tag, title: snippet(post.title, 120), excerpt: snippet(post.content), postedAt: post.createdAt.toISOString().slice(0, 10) })),
        stores: stores.map((store) => ({ storeId: store.id, commons: nameOf.get(store.coopId), name: snippet(store.name, 80), category: store.category, description: snippet(store.description) })),
        resources: resources.map((resource) => ({ resourceId: resource.id, commons: nameOf.get(resource.coopId), kind: resource.kind, title: snippet(resource.title, 120), description: snippet(resource.description) })),
        events: events.map((event) => ({ eventPostId: event.post.id, commons: nameOf.get(event.coopId), title: snippet(event.post.title, 120), startsAt: event.startAt.toISOString() })),
      };
    },
  });

  const proposePost = tool({
    name: "propose_post",
    description: "Propose a post Sage will publish in one of the member's Commons from Sage's own account, without their name. Nothing is posted until the member says yes to the exact text.",
    parameters: z.object({
      coopId: z.string().describe("One of the member's Commons (from list_my_commons)"),
      title: z.string().min(3).max(120),
      body: z.string().min(10).max(1500).describe("Written about \"a member\", never naming or identifying them"),
      tag: z.enum(MEMBER_POST_TAGS),
    }),
    execute: async (input) => {
      const result = await proposeMemberPost({ memberId: ctx.memberId, conversationGroupId: ctx.conversationGroupId, ...input });
      if (!result.ok) {
        state.log.push(`Couldn't propose a post: ${result.reason}`);
        return result;
      }
      state.asks.push(result.ask);
      state.log.push(`Proposed a post: ${input.title}`);
      return { ok: true, note: "Saved. The exact post and the yes/no question are added after your reply." };
    },
  });

  const suggestIntroduction = tool({
    name: "suggest_introduction",
    description: "Find a member of one of this member's Commons whose profile fits their need and offer a consent-first introduction. No names are shared until both people say yes.",
    parameters: z.object({ coopId: z.string(), need: z.string().min(3).max(300) }),
    execute: async ({ coopId, need }) => {
      const [best] = await findMembersForNeed({ db, requestingUserId: ctx.memberId, coopId }, need, ctx.memberId, 1);
      if (!best) {
        state.log.push(`No member profile matched "${need.slice(0, 60)}"`);
        return { ok: false, reason: "Nobody's profile in that Commons matches yet. Offer to post instead." };
      }
      const result = await proposeIntroduction({
        memberId: ctx.memberId, conversationGroupId: ctx.conversationGroupId, coopId, helperUserId: best.userId, need, matched: best.matched,
      });
      if (!result.ok) {
        state.log.push(`Couldn't suggest an introduction: ${result.reason}`);
        return result;
      }
      state.asks.push(result.ask);
      state.log.push(`Offered an introduction for "${need.slice(0, 60)}"`);
      return { ok: true, note: "Saved. The yes/no question is added after your reply. Don't name the other person." };
    },
  });

  const followUpLater = tool({
    name: "follow_up_later",
    description: "Change when Sage checks back with the member on whether anyone answered the post it made for them (1-14 days).",
    parameters: z.object({ days: z.number().int().min(1).max(14) }),
    execute: async ({ days }) => {
      const result = await rescheduleMemberPostFollowUp({ memberId: ctx.memberId, conversationGroupId: ctx.conversationGroupId, days });
      state.log.push(result.ok ? `Will check back in ${days} days` : `Couldn't reschedule: ${result.reason}`);
      return result;
    },
  });

  const scheduleCheckIn = tool({
    name: "schedule_check_in",
    description: "Promise to message this member back in 1-14 days about something specific, e.g. \"how the interview went\". Sage sends it then, unless you've already talked about it. Replaces any earlier promise.",
    parameters: z.object({
      days: z.number().int().min(1).max(14),
      about: z.string().min(3).max(120).describe("A short phrase about them, never naming anyone else"),
    }),
    execute: async ({ days, about }) => {
      const coopId = options.coopId ?? (await db.group.findUnique({ where: { id: ctx.conversationGroupId }, select: { coopId: true } }))?.coopId;
      if (!coopId) return { ok: false, reason: "Conversation not found" };
      const result = await scheduleMemberCheckIn({ memberId: ctx.memberId, coopId, about, days });
      state.log.push(result.ok ? `Promised to check back in ${result.days} days: ${about}` : `Couldn't schedule a check-in: ${result.reason}`);
      return result.ok ? { ok: true, days: result.days } : result;
    },
  });

  return { tools: [listMyCommons, searchOpportunities, proposePost, suggestIntroduction, followUpLater, scheduleCheckIn], state };
}

/**
 * The tools every Sage conversation reply gets, DM or public @mention. Both get the feed agent's read-only
 * Commons lookups, search_opportunities and schedule_check_in. Only a DM also gets list_my_commons,
 * propose_post, suggest_introduction and follow_up_later: each depends on the member's other Commons or on
 * a private "yes" (handleConversationConfirmation), which a public thread can't give.
 */
export function buildSageReplyTools(place: SageReplyPlace) {
  const state: MemberActionState = { asks: [], log: [] };
  const lookups = buildCommentTools({ db, requestingUserId: place.memberId, coopId: place.coopId }, [], (summary) => state.log.push(summary));
  if (place.kind === "dm") {
    const actions = buildMemberActionTools({ memberId: place.memberId, conversationGroupId: place.conversationGroupId }, state);
    return { tools: [...actions.tools, ...lookups], state: actions.state, instructions: `${MEMBER_ACTION_INSTRUCTIONS}\n${DM_LOOKUP_INSTRUCTIONS}` };
  }
  const actions = buildMemberActionTools({ memberId: place.memberId, conversationGroupId: "" }, state, { onlyCoopId: place.coopId, coopId: place.coopId });
  const shared = new Set(["search_opportunities", "schedule_check_in"]);
  return { tools: [...actions.tools.filter((entry) => shared.has(entry.name)), ...lookups], state: actions.state, instructions: THREAD_ACTION_INSTRUCTIONS };
}

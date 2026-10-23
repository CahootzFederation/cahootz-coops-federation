import { createHash } from "node:crypto";
import { db, type Prisma } from "@repo/db";
import { PULSE_TYPE } from "./community-pulse.js";

export const PULSE_PUBLISHER = "sage-community-pulse";
const DAY = 86_400_000;
const WINDOW_DAYS = 14;
const MAX_POSTS = 200;

export interface PulseActivity {
  id: string;
  authorId: string;
  tag: string;
  createdAt: Date;
  comments: { id: string; authorId: string }[];
}

/** Count-backed interpretations only. No member text, identities, or private memory is published. */
export function describeCommunityPulse(posts: PulseActivity[], now: Date) {
  const authors = new Set(posts.map(p => p.authorId));
  const answered = posts.filter(p => p.comments.some(c => c.authorId !== p.authorId));
  const waiting = posts.filter(p => p.tag === "Need" && p.comments.length < 200 && p.createdAt.getTime() <= now.getTime() - 2 * DAY && !p.comments.some(c => c.authorId !== p.authorId));
  const basis = `Based on the latest ${posts.length} eligible General-feed posts from the past ${WINDOW_DAYS} days${posts.length === MAX_POSTS ? " (a capped sample)" : ""}. Replies here mean replies from another person, not Sage.`;
  const uncertainty = "Posts and replies don’t tell us whether help happened offline or what everyone wants. This is a starting point, not a verdict on the community.";
  // Suppress small-group counts and patterns: a sparse feed is not evidence about individual members.
  if (authors.size < 3) return {
    kind: "limited_activity", title: "Still getting a read",
    summary: "There isn’t enough recent shared activity in General for me to describe a community-wide pattern yet. A small, open invitation could give people a way to connect.",
    basis: `I checked recent General-feed activity over the past ${WINDOW_DAYS} days. I’m leaving out small-group counts and personal details.`,
    uncertainty: "A quiet feed doesn’t mean a quiet community. People may be connecting elsewhere, and I can’t infer their preferences from silence.", confidence: 0.35,
  };
  if (new Set(waiting.map(p => p.authorId)).size >= 3) return {
    kind: "unanswered_requests", title: "Requests could use a response",
    summary: "Several shared requests have been waiting for a reply. Helping people find a first response could be a useful place to focus together.",
    basis: `${basis} ${waiting.length} posts tagged Need, from at least three people, have no reply from another person after two days.`, uncertainty, confidence: 0.75,
  };
  if (answered.length >= 3 && new Set(answered.map(p => p.authorId)).size >= 3) return {
    kind: "conversations", title: "Conversations are taking shape",
    summary: "People are responding to one another in General. There may be room to turn some of those conversations into a small shared activity.",
    basis: `${basis} ${answered.length} posts from at least three people received a reply from someone else.`, uncertainty, confidence: 0.7,
  };
  return {
    kind: "shared_activity", title: "A place to start together",
    summary: "People are sharing in General, but I don’t yet see a clear pattern to build around. A simple invitation with a time and place could help us learn what people want to do together.",
    basis, uncertainty, confidence: 0.5,
  };
}

const realPerson: Prisma.UserWhereInput = {
  isBot: false, deletedAt: null,
  NOT: [{ email: { endsWith: "@test.cahootz.local", mode: "insensitive" } }, { handle: { startsWith: "e2e_", mode: "insensitive" } }],
};
const notTestText = { contains: "E2E", mode: "insensitive" as const };

/** Existing Sage wake loop calls this. No model calls or token costs; wording comes from checked facts.
 * The transaction lock and unique day key prevent concurrent workers publishing duplicate cards.
 */
export async function publishCommunityPulse(coopId: string, now = new Date(), client = db) {
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${PULSE_PUBLISHER}:${coopId}`}))::text`;
    const config = await tx.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { isDemo: true } });
    if (!config || config.isDemo) return { skipped: "inactive_or_demo" };
    const owned = { type: PULSE_TYPE, scopeType: "commons", scopeId: coopId, generatedByAgentKey: PULSE_PUBLISHER };
    const last = await tx.aIObservation.findFirst({ where: owned, orderBy: { createdAt: "desc" }, select: { id: true, details: true, reviewAt: true, expiresAt: true, createdAt: true } });
    if (last && (last.createdAt.getTime() > now.getTime() - DAY || (last.reviewAt && last.reviewAt > now))) return { skipped: "not_due", observationId: last.id };
    const posts = await tx.commonsPost.findMany({
      where: {
        coopId, OR: [{ circleId: null }, { circleId: `general:${coopId}` }],
        createdAt: { gte: new Date(now.getTime() - WINDOW_DAYS * DAY), lte: now }, author: realPerson,
        NOT: [{ title: notTestText }, { content: notTestText }],
      }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_POSTS,
      select: { id: true, authorId: true, tag: true, createdAt: true,
        comments: { where: { author: realPerson, createdAt: { lte: now }, NOT: { content: notTestText } },
          // Only need to know whether another person replied; cap each post's evidence too.
          orderBy: { id: "asc" }, take: 200, select: { id: true, authorId: true } },
      },
    });
    const description = describeCommunityPulse(posts, now);
    const { confidence, ...published } = description;
    const fingerprint = createHash("sha256").update(JSON.stringify(published)).digest("hex");
    const previous = last?.details as { fingerprint?: string } | null;
    if (last && previous?.fingerprint === fingerprint && last.expiresAt && last.expiresAt > now) {
      await tx.aIObservation.update({ where: { id: last.id }, data: { reviewAt: new Date(now.getTime() + DAY) } });
      return { skipped: "unchanged", observationId: last.id };
    }
    const observation = await tx.aIObservation.create({ data: {
      ...owned, systemKey: `${PULSE_PUBLISHER}:${coopId}:${now.toISOString().slice(0, 10)}`,
      summary: published.summary, confidence, visibility: "COMMONS_MEMBERS", status: "ACTIVE",
      details: { ...published, fingerprint, method: "aggregate_rules_v1", windowStart: new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString(), windowEnd: now.toISOString() },
      createdAt: now, reviewAt: new Date(now.getTime() + DAY), expiresAt: new Date(now.getTime() + 7 * DAY),
      sources: { create: posts.map(p => ({ sourceType: "commons_post", sourceId: p.id })) },
    }, select: { id: true } });
    // New wording always gets a new row. Existing feedback stays attached to its original statement.
    await tx.aIObservation.updateMany({ where: { ...owned, id: { not: observation.id }, status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
    return { published: true, observationId: observation.id };
  }, { timeout: 15_000 });
}

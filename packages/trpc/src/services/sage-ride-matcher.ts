import { db } from "@repo/db";
import type { CommonsAction } from "@repo/db";

const RIDE_OFFER_PATTERN = /\b(i can (give|offer)|i have (room|space)|driving (to|by|out)|happy to give a ride|can drop you|got (room|space) in (my|the) car)\b/i;
const CANDIDATE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/** Deterministic (no model) match: scans the same circle's recent chat for someone other than the subject offering a ride. */
export async function findRideMatchCandidate(action: Pick<CommonsAction, "circleId" | "sourceAuthorId">): Promise<{ candidateUserId: string } | null> {
  if (!action.circleId) return null;
  const candidates = await db.groupComment.findMany({
    where: {
      groupId: action.circleId,
      authorId: { not: action.sourceAuthorId },
      createdAt: { gte: new Date(Date.now() - CANDIDATE_LOOKBACK_MS) },
      author: { isBot: false },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const match = candidates.find((candidate) => RIDE_OFFER_PATTERN.test(candidate.content));
  return match ? { candidateUserId: match.authorId } : null;
}

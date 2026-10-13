import { db } from "@repo/db";

import { findMembersForNeed } from "../agents/tools/specialist-tools.js";
import { auditLogEntry } from "../lib/audit.js";
import { sendProactiveSageMessage } from "./sage-proactive.js";
import { checkSageOutput, cleanseUntrustedText } from "./untrusted-input.js";

/**
 * Needs nobody answered. A Need or Ask post in a Commons feed that has had no reply from anyone but its
 * author for 48 hours: Sage privately asks one member whose profile fits to take a look. The post is
 * already public, so nothing private is shared; the helper answers on the post if they can.
 *
 * Deterministic, no model call. Every ask is outreach, so it counts toward the helper's weekly limit.
 */

export const NEED_QUIET_HOURS = 48;
export const NEED_MAX_AGE_DAYS = 14;
export const HELPERS_PER_NEED = 2;
export const NEED_ASKS_PER_COMMONS_PER_DAY = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const ASKED = "SAGE_NEED_HELPER_ASKED";

async function commonsName(coopId: string) {
  const config = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { name: true } });
  return config?.name || coopId;
}

export async function askHelpersForUnansweredNeeds(
  coopId: string, now = new Date(),
  /** Internal test control (E2E fixtures); never accepted by a public API. */
  options: { postIds?: string[] } = {},
): Promise<{ considered: number; asked: number }> {
  const askedToday = await db.auditLog.count({
    where: { action: ASKED, occurredAt: { gte: new Date(now.getTime() - DAY_MS) }, metadata: { path: ["coopId"], equals: coopId } },
  });
  let budget = NEED_ASKS_PER_COMMONS_PER_DAY - askedToday;
  if (budget <= 0) return { considered: 0, asked: 0 };

  const posts = await db.commonsPost.findMany({
    where: {
      coopId,
      ...(options.postIds ? { id: { in: options.postIds } } : {}),
      OR: [{ tag: { in: ["Need", "Ask"] } }, { classification: "need" }],
      AND: [{ OR: [{ circleId: null }, { circleId: `general:${coopId}` }] }],
      createdAt: { gte: new Date(now.getTime() - NEED_MAX_AGE_DAYS * DAY_MS), lte: new Date(now.getTime() - NEED_QUIET_HOURS * HOUR_MS) },
      author: { isBot: false },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, title: true, content: true, authorId: true },
  });

  const name = await commonsName(coopId);
  let asked = 0;
  for (const post of posts) {
    if (budget <= 0) break;
    const answered = await db.commonsComment.findFirst({ where: { postId: post.id, authorId: { not: post.authorId } }, select: { id: true } });
    if (answered) continue;
    const prior = await db.auditLog.findMany({
      where: { action: ASKED, resourceId: post.id }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true, metadata: true },
    });
    if (prior.length >= HELPERS_PER_NEED) continue;
    // A second helper only after the first has had a week.
    if (prior[0] && prior[0].occurredAt > new Date(now.getTime() - 7 * DAY_MS)) continue;
    const alreadyAsked = new Set(prior.map((entry) => String((entry.metadata as { helperId?: unknown } | null)?.helperId ?? "")));

    const title = cleanseUntrustedText(post.title, { maxChars: 100 }).text;
    if (!title || !checkSageOutput(title).ok) continue;
    const candidates = (await findMembersForNeed({ db, requestingUserId: null, coopId }, `${post.title} ${post.content}`, post.authorId, 5))
      .filter((candidate) => !alreadyAsked.has(candidate.userId));
    for (const helper of candidates) {
      // One need per helper per week, so the same skilled member isn't asked about everything.
      const recentForHelper = await db.auditLog.findFirst({
        where: { action: ASKED, occurredAt: { gte: new Date(now.getTime() - 7 * DAY_MS) }, metadata: { path: ["helperId"], equals: helper.userId } },
        select: { id: true },
      });
      if (recentForHelper) continue;
      const skills = helper.matched.slice(0, 3).map((skill) => cleanseUntrustedText(skill, { maxChars: 40 }).text).join(", ");
      const content = `A post in ${name} asks for help with “${title}”. Your profile mentions ${skills}. Could you take a look and reply there if you can help?`;
      if (!checkSageOutput(content).ok) continue;
      const sent = await sendProactiveSageMessage({ userId: helper.userId, kind: "need", key: `${post.id}:${helper.userId}`, content, now });
      if (sent.status !== "SENT") continue;
      await db.auditLog.create({
        data: auditLogEntry({
          actorId: "system/sage", action: ASKED, resource: "CommonsPost", resourceId: post.id,
          metadata: { coopId, helperId: helper.userId, matched: helper.matched.slice(0, 3) },
        }),
      });
      asked++;
      budget--;
      break;
    }
  }
  return { considered: posts.length, asked };
}

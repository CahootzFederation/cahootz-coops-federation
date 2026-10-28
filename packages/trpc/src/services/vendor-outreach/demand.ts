import { db as defaultDb } from "@repo/db";

import { ensureSageBotUser } from "../../lib/bot.js";
import { countQuestionResponders } from "../sage-community-question.js";
import { retrieveCommunityInsights } from "../sage-community-memory.js";
import { isoWeekKey } from "../sage-community-rhythm.js";
import { checkSageOutput } from "../untrusted-input.js";
import { proposeCampaigns } from "./campaigns.js";
import { dealCategoriesInText, dealCategoryByKey, dealCategoryForTheme, dealQuestionText } from "./categories.js";
import { approvedItemsForCommons, itemQuestionText, type PricedItem } from "./item-questions.js";

type Db = typeof defaultDb;

/**
 * Weekly demand check: is there something members want that a local business
 * could sell this Commons at a better price? If so, Sage asks the whole Commons.
 *
 * Evidence is either a community pattern Sage already holds (built from private
 * check-ins, so no person ever sees it) or a cluster of public Need posts. Either
 * way, the only output is one fixed question to everyone. Nothing here names a
 * member, quotes a member, or mentions a count. A campaign (phase 2) later cites
 * only the public answers to this question.
 */
export const DEAL_INTEREST_SOURCE = "deal_interest";
export const DEAL_INTEREST_CLASSIFICATION = "sage_deal_interest";
const CONFIG_KEY = "vendor-demand:v1";

/** No Sage question of any kind to a Commons more often than this. */
export const DEAL_QUESTION_COMMONS_COOLDOWN_DAYS = 7;
/** The same deal category is asked about at most once in this many days. */
export const DEAL_QUESTION_CATEGORY_COOLDOWN_DAYS = 60;
/** Public Need posts only count as evidence from this many different members. */
export const DEAL_NEED_MIN_AUTHORS = 3;
export const DEAL_NEED_LOOKBACK_DAYS = 30;
/** Answers are counted once a question has been up this long. */
export const DEAL_INTEREST_COUNT_AFTER_DAYS = 7;
/** Small Commons are skipped: a question to two people isn't a demand signal. */
export const DEAL_MIN_ACTIVE_MEMBERS = 3;
const DAY_MS = 86_400_000;

export type DealEvidence =
  | { kind: "community_pattern"; categoryKey: string; observationId: string; confidence: number }
  | { kind: "need_posts"; categoryKey: string; postCount: number; authorCount: number; postIds: string[] };

export interface AskedDealQuestion { categoryKey: string | null; productId?: string | null; createdAt: Date }

export type DealItem = PricedItem & { categoryKey: string };

/** Group recent public Need posts by deal category, keeping only categories enough different members raised. */
export function needPostEvidence(posts: Array<{ id: string; authorId: string; title: string; content: string }>): DealEvidence[] {
  const byCategory = new Map<string, { postIds: string[]; authors: Set<string> }>();
  for (const post of posts) {
    for (const key of dealCategoriesInText(`${post.title}\n${post.content}`)) {
      const entry = byCategory.get(key) ?? { postIds: [], authors: new Set<string>() };
      entry.postIds.push(post.id);
      entry.authors.add(post.authorId);
      byCategory.set(key, entry);
    }
  }
  return [...byCategory.entries()]
    .filter(([, entry]) => entry.authors.size >= DEAL_NEED_MIN_AUTHORS)
    .map(([categoryKey, entry]) => ({
      kind: "need_posts" as const,
      categoryKey,
      postCount: entry.postIds.length,
      authorCount: entry.authors.size,
      postIds: entry.postIds.slice(0, 20),
    }));
}

/**
 * Which category Sage asks about now, if any. Nothing if the Commons got any Sage
 * question in the last week. Otherwise the strongest evidence whose category
 * wasn't asked in the last 60 days: community patterns first, then the Need-post
 * cluster with the most different members.
 */
export function pickDealQuestion(evidence: DealEvidence[], asked: AskedDealQuestion[], now: Date): DealEvidence | null {
  const since = (days: number) => now.getTime() - days * DAY_MS;
  if (asked.some((entry) => entry.createdAt.getTime() > since(DEAL_QUESTION_COMMONS_COOLDOWN_DAYS))) return null;
  const recent = new Set(
    asked.filter((entry) => entry.createdAt.getTime() > since(DEAL_QUESTION_CATEGORY_COOLDOWN_DAYS)).map((entry) => entry.categoryKey),
  );
  const strength = (item: DealEvidence) => (item.kind === "community_pattern" ? 1000 + item.confidence : item.authorCount);
  return evidence
    .filter((item) => dealCategoryByKey(item.categoryKey) && !recent.has(item.categoryKey))
    .sort((a, b) => strength(b) - strength(a))[0] ?? null;
}

/**
 * Which approved item (from the product-discovery bot) the question names, if
 * any. With member demand, only an item in that category; without it, the best
 * item not asked about in 60 days whose category wasn't either. The weekly
 * limit is checked before this.
 */
export function pickDealItem(choice: DealEvidence | null, items: DealItem[], asked: AskedDealQuestion[], now: Date): DealItem | null {
  const since = now.getTime() - DEAL_QUESTION_CATEGORY_COOLDOWN_DAYS * DAY_MS;
  const recent = asked.filter((entry) => entry.createdAt.getTime() > since);
  const recentItems = new Set(recent.map((entry) => entry.productId).filter(Boolean));
  const recentCategories = new Set(recent.map((entry) => entry.categoryKey));
  const fresh = items.filter((item) => !recentItems.has(item.productId));
  if (choice) return fresh.find((item) => item.categoryKey === choice.categoryKey) ?? null;
  return fresh.find((item) => item.categoryKey === "other" || !recentCategories.has(item.categoryKey)) ?? null;
}

function productOf(payload: unknown): string | null {
  const id = (payload as { sourcedProductId?: unknown } | null)?.sourcedProductId;
  return typeof id === "string" ? id : null;
}

function categoryOf(payload: unknown): string | null {
  const key = (payload as { dealCategory?: unknown } | null)?.dealCategory;
  return typeof key === "string" ? key : null;
}

async function gatherEvidence(db: Db, coopId: string, now: Date): Promise<DealEvidence[]> {
  const patterns = await retrieveCommunityInsights(coopId, "vendor-demand", now);
  const fromPatterns = patterns.flatMap((pattern) => {
    const category = dealCategoryForTheme(pattern.themeKey);
    return category
      ? [{ kind: "community_pattern" as const, categoryKey: category.key, observationId: pattern.id, confidence: pattern.confidence }]
      : [];
  });
  const posts = await db.commonsPost.findMany({
    where: {
      coopId,
      createdAt: { gte: new Date(now.getTime() - DEAL_NEED_LOOKBACK_DAYS * DAY_MS) },
      OR: [{ circleId: null }, { circleId: `general:${coopId}` }],
      AND: [{ OR: [{ tag: { in: ["Need", "Ask"] } }, { classification: "need" }] }],
      author: { isBot: false },
    },
    select: { id: true, authorId: true, title: true, content: true },
    take: 500,
  });
  return [...fromPatterns, ...needPostEvidence(posts)];
}

export type DemandResult =
  | { asked: true; actionId: string; postId: string; categoryKey: string; productId: string | null; evidence: DealEvidence["kind"] | "approved_item" }
  | { asked: false; reason: string };

/** Posts at most one deal-interest question for a Commons this week. Safe to run twice. */
export async function askCommonsAboutDeals(coopId: string, now = new Date(), db: Db = defaultDb): Promise<DemandResult> {
  const activeMembers = await db.userCoopMembership.count({ where: { coopId, status: "ACTIVE", user: { isBot: false } } });
  if (activeMembers < DEAL_MIN_ACTIVE_MEMBERS) return { asked: false, reason: "Too few active members" };

  const previous = await db.commonsAction.findMany({
    where: {
      coopId,
      type: "ASK_COMMONS",
      status: { not: "FAILED" },
      createdAt: { gte: new Date(now.getTime() - DEAL_QUESTION_CATEGORY_COOLDOWN_DAYS * DAY_MS) },
    },
    select: { createdAt: true, payload: true },
  });
  const asked = previous.map((row) => ({ categoryKey: categoryOf(row.payload), productId: productOf(row.payload), createdAt: row.createdAt }));
  if (asked.some((entry) => entry.createdAt.getTime() > now.getTime() - DEAL_QUESTION_COMMONS_COOLDOWN_DAYS * DAY_MS)) {
    return { asked: false, reason: "Asked recently, or no clear demand" };
  }
  const choice = pickDealQuestion(await gatherEvidence(db, coopId, now), asked, now);
  // A platform admin approved these items for this Commons, so one can be asked about even without a demand signal.
  const item = pickDealItem(choice, await approvedItemsForCommons(db, coopId, now), asked, now);
  if (!choice && !item) return { asked: false, reason: "Asked recently, or no clear demand" };
  const categoryKey = choice?.categoryKey ?? item!.categoryKey;
  const questionKey = item ? `item:${item.productId}` : categoryKey;
  const evidenceKind = choice?.kind ?? "approved_item";

  const text = item ? itemQuestionText(item) : dealQuestionText(categoryKey)!;
  if (!checkSageOutput(`${text.title}\n${text.body}`).ok) return { asked: false, reason: "The question failed Sage's output check" };

  const sage = await ensureSageBotUser(db, coopId);
  // Claim first: one question per Commons, category and week even if two runs overlap.
  let action;
  try {
    action = await db.commonsAction.create({
      data: {
        coopId,
        sourceType: DEAL_INTEREST_SOURCE,
        sourceId: `${coopId}:${questionKey}:${isoWeekKey(now)}`,
        // Replaced with the question post's id once it's posted, like Sage's community questions.
        sourcePostId: `${coopId}:${questionKey}`,
        sourceAuthorId: sage.id,
        contentHash: questionKey,
        position: 0,
        type: "ASK_COMMONS",
        status: "PENDING",
        summary: item
          ? `Sage asked the Commons about a group buy on ${item.name}`
          : `Sage asked the Commons about a deal on ${dealCategoryByKey(categoryKey)!.label}`,
        confidence: choice?.kind === "community_pattern" ? choice.confidence : 0.6,
        draftText: text.body,
        generatedDraftText: text.body,
        charterConfigId: CONFIG_KEY,
        originObservationId: choice?.kind === "community_pattern" ? choice.observationId : null,
        payload: {
          dealCategory: categoryKey,
          title: text.title,
          body: text.body,
          // Kind only for patterns: the pattern itself stays internal. Need posts are public.
          evidence: choice?.kind === "need_posts"
            ? { kind: choice.kind, postCount: choice.postCount, authorCount: choice.authorCount, postIds: choice.postIds }
            : { kind: evidenceKind },
          ...(item ? { sourcedProductId: item.productId, item } : {}),
        },
        auditEvents: { create: { eventType: "SUGGESTION_CREATED", metadata: { kind: DEAL_INTEREST_SOURCE, evidence: evidenceKind } } },
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { asked: false, reason: "Already asked this week" };
    throw error;
  }

  try {
    const post = await db.commonsPost.create({
      data: {
        coopId,
        circleId: `general:${coopId}`,
        authorId: sage.id,
        title: text.title,
        content: text.body,
        tag: "Idea",
        classification: DEAL_INTEREST_CLASSIFICATION,
        classificationConfidence: 1,
        classificationSignals: { version: 1, source: DEAL_INTEREST_SOURCE, actionId: action.id },
      },
      select: { id: true },
    });
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "PUBLISHED", sourcePostId: post.id } });
    await db.commonsActionAudit.create({
      data: { actionId: action.id, eventType: "QUESTION_POSTED", metadata: { resultEntityType: "CommonsPost", resultEntityId: post.id } },
    });
    return { asked: true, actionId: action.id, postId: post.id, categoryKey, productId: item?.productId ?? null, evidence: evidenceKind };
  } catch (error) {
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "FAILED" } }).catch(() => {});
    throw error;
  }
}

/**
 * Records how many members answered each deal question once it has been up a
 * week. This public count is what a campaign proposal (phase 2) may cite.
 */
export async function countDealInterest(coopId: string, now = new Date(), db: Db = defaultDb) {
  const due = await db.commonsAction.findMany({
    where: {
      coopId,
      sourceType: DEAL_INTEREST_SOURCE,
      status: "PUBLISHED",
      createdAt: { lte: new Date(now.getTime() - DEAL_INTEREST_COUNT_AFTER_DAYS * DAY_MS) },
    },
    select: { id: true, sourcePostId: true, payload: true },
  });
  let counted = 0;
  for (const action of due) {
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.interestCount === "number" || !action.sourcePostId) continue;
    const interestCount = await countQuestionResponders(action.sourcePostId);
    if (interestCount === null) continue;
    await db.commonsAction.update({
      where: { id: action.id },
      data: { payload: { ...payload, interestCount, interestCountedAt: now.toISOString() } },
    });
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "INTEREST_COUNTED", metadata: { interestCount } } });
    counted++;
  }
  return { counted };
}

/** The weekly job: count last week's answers, then maybe ask a new question, for every Commons. */
export async function runVendorDemandSweep(options: { now?: Date; coopIds?: string[] } = {}, db: Db = defaultDb) {
  const now = options.now ?? new Date();
  const configs = await db.coopConfig.findMany({
    where: { isActive: true, isDemo: false, ...(options.coopIds ? { coopId: { in: options.coopIds } } : {}) },
    select: { coopId: true },
    distinct: ["coopId"],
  });
  const results: Array<Record<string, unknown>> = [];
  let failed = 0;
  for (const { coopId } of configs) {
    try {
      const interest = await countDealInterest(coopId, now, db);
      const campaigns = await proposeCampaigns(coopId, now, db);
      const question = await askCommonsAboutDeals(coopId, now, db);
      results.push({ coopId, ...interest, ...campaigns, question });
    } catch (error) {
      failed++;
      results.push({ coopId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { commons: configs.length, failed, results };
}

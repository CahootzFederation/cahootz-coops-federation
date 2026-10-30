import { db as defaultDb } from "@repo/db";

import { countQuestionResponders } from "../sage-community-question.js";
import { dealCategoryByKey } from "./categories.js";
import { DEAL_INTEREST_SOURCE } from "./demand.js";

type Db = typeof defaultDb;

/**
 * The platform admin's view of demand and prospects. Demand rows are Sage's
 * public questions and how many members answered; they never include the
 * private patterns behind a question.
 */
export async function listDemandForAdmin(db: Db = defaultDb) {
  const questions = await db.commonsAction.findMany({
    where: { sourceType: DEAL_INTEREST_SOURCE, status: { in: ["PUBLISHED", "PENDING"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, coopId: true, createdAt: true, sourcePostId: true, payload: true },
  });
  return Promise.all(
    questions.map(async (question) => {
      const payload = (question.payload ?? {}) as Record<string, unknown>;
      const counted = typeof payload.interestCount === "number" ? (payload.interestCount as number) : null;
      const evidence = (payload.evidence ?? {}) as { kind?: string; postCount?: number; authorCount?: number };
      return {
        id: question.id,
        coopId: question.coopId,
        categoryKey: payload.dealCategory as string,
        categoryLabel: dealCategoryByKey(payload.dealCategory as string)?.label ?? String(payload.dealCategory),
        itemName: typeof (payload.item as { name?: unknown } | undefined)?.name === "string" ? (payload.item as { name: string }).name : null,
        title: payload.title as string,
        askedAt: question.createdAt,
        postId: question.sourcePostId,
        // A final count after a week, or the live count before that.
        interestCount: counted ?? (await countQuestionResponders(question.sourcePostId)) ?? 0,
        interestFinal: counted !== null,
        evidenceKind: evidence.kind === "need_posts" ? "Public Need posts" : "Sage's community patterns",
        needPosts: evidence.kind === "need_posts" ? { posts: evidence.postCount ?? 0, members: evidence.authorCount ?? 0 } : null,
      };
    }),
  );
}

export async function listProspectsForAdmin(db: Db = defaultDb) {
  const prospects = await db.vendorProspect.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      responses: { orderBy: { respondedAt: "desc" }, take: 1, select: { interest: true, contactName: true, bestContact: true, offerIdea: true, respondedAt: true } },
      // Item seller searches this business is part of, so a yes can start that item's Group Buy.
      campaignProspects: {
        where: { campaign: { sourcedProductId: { not: null } } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { campaign: { select: { coopId: true, sourcedProduct: { select: { id: true, name: true } } } } },
      },
      referrals: {
        orderBy: { createdAt: "asc" },
        select: {
          coopId: true,
          howKnown: true,
          mayNameReferrer: true,
          createdAt: true,
          referredBy: { select: { name: true, email: true } },
        },
      },
    },
  });
  return prospects.map((prospect) => ({
    id: prospect.id,
    businessName: prospect.businessName,
    categoryLabel: dealCategoryByKey(prospect.category)?.label ?? "Something else",
    description: prospect.description,
    website: prospect.website,
    email: prospect.email,
    phone: prospect.phone,
    city: prospect.city,
    state: prospect.state,
    sourceType: prospect.sourceType,
    status: prospect.status,
    statusNote: prospect.statusNote,
    sourceUrl: prospect.sourceUrl,
    convertedOfferId: prospect.convertedOfferId,
    lastContactedAt: prospect.lastContactedAt,
    latestResponse: prospect.responses[0] ?? null,
    item: prospect.campaignProspects[0]?.campaign.sourcedProduct
      ? { coopId: prospect.campaignProspects[0].campaign.coopId, ...prospect.campaignProspects[0].campaign.sourcedProduct }
      : null,
    createdAt: prospect.createdAt,
    referralCount: prospect.referrals.length,
    commons: [...new Set(prospect.referrals.map((referral) => referral.coopId))],
    referrals: prospect.referrals.map((referral) => ({
      coopId: referral.coopId,
      howKnown: referral.howKnown,
      mayNameReferrer: referral.mayNameReferrer,
      referrer: referral.referredBy.name || referral.referredBy.email,
      createdAt: referral.createdAt,
    })),
  }));
}

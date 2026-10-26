import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db as defaultDb } from "@repo/db";

import { auditLogEntry } from "../../lib/audit.js";
import { sendSlackNotification } from "../slack-notification-service.js";
import { dealCategoryByKey } from "./categories.js";
import { DEAL_INTEREST_SOURCE } from "./demand.js";
import { checkOutreachText } from "./outreach-check.js";

type Db = typeof defaultDb;

/**
 * Phase 2: Sage proposes an outreach campaign when enough members answered a
 * deal question, and a platform admin approves it. Approval is the "explicit
 * workflow authorization" Sage needs before it contacts anyone outside the
 * Commons; nothing is found or sent for a campaign that isn't ACTIVE.
 */
export const CAMPAIGN_MIN_INTEREST = 5;
export const CAMPAIGN_DAYS = 30;
const DAY_MS = 86_400_000;

/** Services suit a member price; goods bought in bulk suit a Group Buy. */
const MEMBER_DEAL_CATEGORIES = new Set(["auto_repair", "home_repair", "phones_internet"]);

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that campaign." });
}

async function audit(db: Db, actorId: string, action: string, campaignId: string, metadata?: Record<string, unknown>) {
  await db.auditLog.create({
    data: auditLogEntry({ actorId, action, resource: "VendorCampaign", resourceId: campaignId, metadata }),
  });
}

/**
 * Turns answered deal questions into proposed campaigns. Only the public answer
 * count and public Need posts are carried over; nothing private.
 */
export async function proposeCampaigns(coopId: string, now = new Date(), db: Db = defaultDb) {
  const questions = await db.commonsAction.findMany({
    where: { coopId, sourceType: DEAL_INTEREST_SOURCE, status: "PUBLISHED" },
    select: { id: true, sourcePostId: true, payload: true, createdAt: true },
  });
  let proposed = 0;
  for (const question of questions) {
    const payload = (question.payload ?? {}) as Record<string, unknown>;
    const interestCount = typeof payload.interestCount === "number" ? payload.interestCount : null;
    const category = dealCategoryByKey(payload.dealCategory as string);
    if (!category || interestCount === null || interestCount < CAMPAIGN_MIN_INTEREST) continue;
    const evidence = (payload.evidence ?? {}) as { kind?: string; postCount?: number; authorCount?: number };
    try {
      const campaign = await db.vendorCampaign.create({
        data: {
          coopId,
          category: category.key,
          offerType: MEMBER_DEAL_CATEGORIES.has(category.key) ? "MEMBER_DEAL" : "GROUP_BUY",
          searchTerms: [category.label, ...category.keywords.slice(0, 3)],
          demandActionId: question.id,
          demandEvidence: {
            interestCount,
            questionPostId: question.sourcePostId,
            askedAt: question.createdAt.toISOString(),
            needPosts: evidence.kind === "need_posts" ? { posts: evidence.postCount ?? 0, members: evidence.authorCount ?? 0 } : null,
          },
        },
      });
      proposed++;
      await audit(db, "system:sage", "VENDOR_CAMPAIGN_PROPOSED", campaign.id, { coopId, category: category.key, interestCount });
      await sendSlackNotification({
        text: `Sage proposed a vendor outreach campaign: ${category.label} for ${coopId} (${interestCount} members said they'd buy). Review it in the admin portal under Vendor Outreach.`,
      }).catch(() => false);
    } catch (error) {
      // One campaign per question: a rerun finds it already proposed.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  return { proposed };
}

export const approveCampaignSchema = z.object({
  area: z.string().trim().min(2, "Add the city or area to search near.").max(120),
  searchTerms: z.array(z.string().trim().min(2).max(60)).min(1).max(8).optional(),
  maxEmails: z.number().int().min(1).max(50).optional(),
  maxSearches: z.number().int().min(0).max(10).optional(),
  pitchPoints: z.string().trim().max(300).optional().nullable(),
});

/** A platform admin approves a campaign, which lets Sage find and email businesses within its limits. */
export async function approveCampaign(db: Db, actorId: string, campaignId: string, raw: z.input<typeof approveCampaignSchema>, now = new Date()) {
  const input = approveCampaignSchema.parse(raw);
  const campaign = await db.vendorCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) notFound();
  if (campaign.status !== "PROPOSED") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only a proposed campaign can be approved." });
  }
  if (input.pitchPoints) {
    const check = checkOutreachText(input.pitchPoints, { maxChars: 300 });
    if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `The extra line can't be used: ${check.reason}` });
  }
  const updated = await db.vendorCampaign.updateMany({
    where: { id: campaignId, status: "PROPOSED" },
    data: {
      status: "ACTIVE",
      area: input.area,
      ...(input.searchTerms ? { searchTerms: input.searchTerms } : {}),
      ...(input.maxEmails ? { maxEmails: input.maxEmails } : {}),
      ...(input.maxSearches !== undefined ? { maxSearches: input.maxSearches } : {}),
      pitchPoints: input.pitchPoints ?? null,
      approvedById: actorId,
      approvedAt: now,
      expiresAt: new Date(now.getTime() + CAMPAIGN_DAYS * DAY_MS),
    },
  });
  if (updated.count === 0) throw new TRPCError({ code: "CONFLICT", message: "Someone else just changed this campaign. Refresh and try again." });
  await audit(db, actorId, "VENDOR_CAMPAIGN_APPROVED", campaignId, { area: input.area, maxEmails: input.maxEmails });
}

const MOVES: Record<string, { from: string[]; to: "REJECTED" | "PAUSED" | "ACTIVE" | "COMPLETED"; action: string }> = {
  reject: { from: ["PROPOSED"], to: "REJECTED", action: "VENDOR_CAMPAIGN_REJECTED" },
  pause: { from: ["ACTIVE"], to: "PAUSED", action: "VENDOR_CAMPAIGN_PAUSED" },
  resume: { from: ["PAUSED"], to: "ACTIVE", action: "VENDOR_CAMPAIGN_RESUMED" },
  complete: { from: ["ACTIVE", "PAUSED"], to: "COMPLETED", action: "VENDOR_CAMPAIGN_COMPLETED" },
};

/** Reject, pause, resume or end a campaign. Pausing stops all sending at once. */
export async function moveCampaign(db: Db, actorId: string, campaignId: string, move: keyof typeof MOVES, reason?: string, now = new Date()) {
  const rule = MOVES[move]!;
  const campaign = await db.vendorCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) notFound();
  if (move === "resume" && campaign.expiresAt && campaign.expiresAt <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This campaign has run its 30 days. Let Sage propose a new one." });
  }
  const updated = await db.vendorCampaign.updateMany({
    where: { id: campaignId, status: { in: rule.from as any } },
    data: { status: rule.to, ...(move === "reject" ? { rejectReason: reason?.slice(0, 500) ?? null } : {}) },
  });
  if (updated.count === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This campaign is ${campaign.status.toLowerCase()}, so it can't be changed that way.` });
  }
  await audit(db, actorId, rule.action, campaignId, reason ? { reason } : undefined);
}

export async function listCampaignsForAdmin(db: Db = defaultDb) {
  const campaigns = await db.vendorCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      prospects: {
        select: {
          status: true,
          skipReason: true,
          prospect: { select: { id: true, businessName: true, email: true, phone: true, sourceType: true, status: true } },
        },
      },
    },
  });
  return campaigns.map((campaign) => {
    const count = (status: string) => campaign.prospects.filter((prospect) => prospect.status === status).length;
    return {
      id: campaign.id,
      coopId: campaign.coopId,
      category: campaign.category,
      categoryLabel: dealCategoryByKey(campaign.category)?.label ?? campaign.category,
      offerType: campaign.offerType,
      searchTerms: campaign.searchTerms,
      area: campaign.area,
      demandEvidence: campaign.demandEvidence,
      pitchPoints: campaign.pitchPoints,
      maxEmails: campaign.maxEmails,
      maxSearches: campaign.maxSearches,
      searchesUsed: campaign.searchesUsed,
      status: campaign.status,
      rejectReason: campaign.rejectReason,
      approvedAt: campaign.approvedAt,
      expiresAt: campaign.expiresAt,
      createdAt: campaign.createdAt,
      counts: {
        found: campaign.prospects.length,
        queued: count("QUEUED"),
        sent: count("SENT") + count("FOLLOWED_UP") + count("RESPONDED"),
        responded: count("RESPONDED"),
        skipped: count("SKIPPED"),
      },
      prospects: campaign.prospects.map((row) => ({
        prospectId: row.prospect.id,
        businessName: row.prospect.businessName,
        email: row.prospect.email,
        phone: row.prospect.phone,
        source: row.prospect.sourceType,
        status: row.status,
        skipReason: row.skipReason,
        pipeline: row.prospect.status,
      })),
    };
  });
}

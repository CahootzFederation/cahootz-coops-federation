import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db as defaultDb } from "@repo/db";

import { auditLogEntry } from "../../lib/audit.js";
import { sendSlackNotification } from "../slack-notification-service.js";
import { dealCategoryByKey } from "./categories.js";
import { hashReplyToken } from "./email-builder.js";

type Db = typeof defaultDb;

/** "Not right now" means we don't contact them again for this long. */
export const DECLINE_QUIET_DAYS = 180;
const DAY_MS = 86_400_000;

async function findByToken(db: Db, token: string) {
  if (!token || token.length < 20 || token.length > 100) return null;
  return db.campaignProspect.findUnique({
    where: { replyTokenHash: hashReplyToken(token) },
    include: {
      prospect: true,
      campaign: { select: { id: true, coopId: true, category: true, area: true, offerType: true, sourcedProduct: { select: { name: true } } } },
      responses: { orderBy: { respondedAt: "desc" }, take: 1, select: { interest: true } },
    },
  });
}

function invalidLink(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "This link doesn't work anymore. Reply to our email and we'll help." });
}

/** What the public reply page shows. Nothing about the community beyond a general area. */
export async function loadReplyPage(db: Db, token: string) {
  const row = await findByToken(db, token);
  if (!row) invalidLink();
  return {
    businessName: row.prospect.businessName,
    categoryLabel: row.campaign.sourcedProduct?.name ?? dealCategoryByKey(row.campaign.category)?.label ?? "local goods",
    area: row.campaign.area,
    offerType: row.campaign.offerType,
    answered: row.responses[0]?.interest ?? null,
  };
}

export const vendorResponseSchema = z.object({
  interest: z.enum(["YES", "NOT_NOW", "UNSUBSCRIBE"]),
  contactName: z.string().trim().max(120).optional(),
  bestContact: z.string().trim().max(200).optional(),
  offerIdea: z.string().trim().max(1000).optional(),
});

/**
 * A vendor answers. Yes goes to a platform admin to follow up (Sage stops here);
 * not right now pauses contact for 180 days; unsubscribe is permanent.
 */
export async function recordVendorResponse(db: Db, token: string, raw: z.input<typeof vendorResponseSchema>, now = new Date()) {
  const input = vendorResponseSchema.parse(raw);
  const row = await findByToken(db, token);
  if (!row) invalidLink();

  await db.vendorResponse.create({
    data: {
      prospectId: row.prospectId,
      campaignProspectId: row.id,
      interest: input.interest,
      contactName: input.contactName || null,
      bestContact: input.bestContact || null,
      offerIdea: input.offerIdea || null,
      respondedAt: now,
    },
  });
  await db.campaignProspect.update({ where: { id: row.id }, data: { status: "RESPONDED", respondedAt: now } });

  if (input.interest === "YES") {
    await db.vendorProspect.update({ where: { id: row.prospectId }, data: { status: "INTERESTED" } });
    await sendSlackNotification({
      text: `A business said yes to a deal: ${row.prospect.businessName} (${dealCategoryByKey(row.campaign.category)?.label ?? row.campaign.category}, ${row.campaign.area ?? row.campaign.coopId}). Follow up from Vendor Outreach in the admin portal.`,
    }).catch(() => false);
  } else if (input.interest === "NOT_NOW") {
    await db.vendorProspect.update({
      where: { id: row.prospectId },
      data: { status: "DECLINED", declinedUntil: new Date(now.getTime() + DECLINE_QUIET_DAYS * DAY_MS) },
    });
  } else {
    await suppressProspect(db, row.prospect, "UNSUBSCRIBED");
  }
  await db.auditLog.create({
    data: auditLogEntry({ actorId: "vendor", action: "VENDOR_RESPONDED", resource: "VendorProspect", resourceId: row.prospectId, metadata: { interest: input.interest, campaignId: row.campaign.id } }),
  });
  return { interest: input.interest };
}

/** One-click unsubscribe from the email link or header. */
export async function unsubscribeByToken(db: Db, token: string) {
  const row = await findByToken(db, token);
  if (!row) invalidLink();
  await suppressProspect(db, row.prospect, "UNSUBSCRIBED");
  if (row.status !== "RESPONDED") await db.campaignProspect.update({ where: { id: row.id }, data: { status: "RESPONDED", respondedAt: new Date() } });
  return { unsubscribed: true };
}

export async function suppressProspect(db: Db, prospect: { id: string; emailNormalized: string | null }, reason: "UNSUBSCRIBED" | "ADMIN" | "BOUNCED") {
  if (prospect.emailNormalized) {
    await db.outreachSuppression.upsert({
      where: { email: prospect.emailNormalized },
      create: { email: prospect.emailNormalized, reason },
      update: {},
    });
  }
  await db.vendorProspect.update({ where: { id: prospect.id }, data: { status: reason === "UNSUBSCRIBED" ? "UNSUBSCRIBED" : reason === "BOUNCED" ? "BOUNCED" : "SKIPPED" } });
}

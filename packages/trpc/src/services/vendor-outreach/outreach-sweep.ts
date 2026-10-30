import { db as defaultDb } from "@repo/db";

import { outreachEmailReady, sendVendorOutreachEmail } from "../../lib/email.js";
import { sageAutonomyAllowed } from "../sage-autonomy.js";
import { dealCategoryByKey } from "./categories.js";
import { discoverForCampaign, type DiscoveryDeps } from "./discovery.js";
import { personalLineFor, runVendorDraft, type DraftRunner } from "./draft.js";
import { buildOutreachEmail, hashReplyToken, replyToken, replyUrls } from "./email-builder.js";
import { outreachSettings } from "./settings.js";
import { verifyProspect } from "./verify.js";

type Db = typeof defaultDb;

/** Outreach emails across the whole platform per day (first emails and follow-ups together). */
export const DAILY_OUTREACH_LIMIT = 20;
/** One follow-up, this long after the first email, then stop. */
export const FOLLOW_UP_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

export type OutreachSender = typeof sendVendorOutreachEmail;

export interface OutreachSweepDeps extends DiscoveryDeps {
  send?: OutreachSender;
  draft?: DraftRunner;
  /** Overrides the weekday 9-5 Eastern sending window (tests and fixtures). */
  ignoreSendingWindow?: boolean;
}

export interface OutreachSweepResult {
  campaignsExpired: number;
  campaignsCompleted: number;
  discovered: number;
  sent: number;
  dryRun: number;
  followUps: number;
  skipped: number;
  live: boolean;
  outsideWindow: boolean;
}

/** Weekdays, 9am to 5pm Eastern. */
export function inSendingWindow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return !!weekday && !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 17;
}

function startOfEasternDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return new Date(now.getTime() - (hour * 60 + minute) * 60_000 - now.getUTCSeconds() * 1000);
}

async function forbiddenNamesFor(db: Db, coopId: string) {
  const config = await db.coopConfig.findFirst({ where: { coopId, isActive: true }, orderBy: { version: "desc" }, select: { name: true, slug: true } });
  return [config?.name, config?.slug, coopId].filter((name): name is string => !!name);
}

/**
 * Phase 4: the hourly outreach sweep. Expires old campaigns, runs discovery for
 * newly approved ones, then sends first emails and one follow-up inside the
 * limits. Every email step is claimed by a unique row before it's sent, so an
 * overlapping or retried run never emails a business twice.
 */
export async function runOutreachSweep(db: Db = defaultDb, now = new Date(), deps: OutreachSweepDeps = {}): Promise<OutreachSweepResult> {
  const result: OutreachSweepResult = { campaignsExpired: 0, campaignsCompleted: 0, discovered: 0, sent: 0, dryRun: 0, followUps: 0, skipped: 0, live: false, outsideWindow: false };

  const expired = await db.vendorCampaign.updateMany({ where: { status: { in: ["ACTIVE", "PAUSED"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  result.campaignsExpired = expired.count;

  const toDiscover = await db.vendorCampaign.findMany({ where: { status: "ACTIVE", discoveredAt: null }, select: { id: true } });
  for (const { id } of toDiscover) {
    const found = await discoverForCampaign(db, id, { ...deps, now });
    result.discovered += found.found;
  }

  const settings = await outreachSettings(db, outreachEmailReady);
  result.live = settings.live;
  if (!deps.ignoreSendingWindow && !inSendingWindow(now)) {
    result.outsideWindow = true;
    return result;
  }

  const sentToday = await db.outreachMessage.count({ where: { status: { in: ["SENT", "DRY_RUN"] }, sentAt: { gte: startOfEasternDay(now) } } });
  let room = Math.max(0, DAILY_OUTREACH_LIMIT - sentToday);
  const send = deps.send ?? sendVendorOutreachEmail;
  const draft = deps.draft ?? runVendorDraft;
  const allowed = deps.autonomyAllowed ?? sageAutonomyAllowed;

  const campaigns = await db.vendorCampaign.findMany({ where: { status: "ACTIVE", discoveredAt: { not: null } } });
  for (const campaign of campaigns) {
    const category = dealCategoryByKey(campaign.category);
    const interestCount = Number((campaign.demandEvidence as { interestCount?: number })?.interestCount ?? 0);
    if (!category || !campaign.area) continue;
    const forbiddenNames = await forbiddenNamesFor(db, campaign.coopId);
    const item = campaign.sourcedProductId
      ? await db.sourcedProduct.findUnique({ where: { id: campaign.sourcedProductId }, select: { name: true } })
      : null;

    const deliver = async (row: { id: string; personalLine: string | null; prospect: { id: string; businessName: string; email: string | null; description: string | null } }, step: "FIRST" | "FOLLOW_UP") => {
      const token = replyToken(row.id);
      const urls = replyUrls(token);
      const email = buildOutreachEmail({
        step,
        businessName: row.prospect.businessName,
        categoryLabel: category.label,
        itemName: item?.name ?? null,
        area: campaign.area!,
        interestCount,
        offerType: campaign.offerType,
        personalLine: row.personalLine,
        pitchPoints: campaign.pitchPoints,
        postalAddress: settings.postalAddress,
        ...urls,
      });
      // Claim the step first; the unique key stops a second run from sending it again.
      let message;
      try {
        message = await db.outreachMessage.create({
          data: { campaignProspectId: row.id, step, toEmail: row.prospect.email!, subject: email.subject, body: email.text, status: settings.live ? "SENT" : "DRY_RUN", sentAt: now },
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") return false;
        throw error;
      }
      if (settings.live) {
        try {
          const sent = await send({ to: row.prospect.email!, subject: email.subject, html: email.html, text: email.text, oneClickUnsubscribeUrl: urls.oneClickUnsubscribeUrl });
          await db.outreachMessage.update({ where: { id: message.id }, data: { resendId: sent.id } });
        } catch (error) {
          await db.outreachMessage.update({ where: { id: message.id }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : String(error) } });
          return false;
        }
      }
      return { hash: hashReplyToken(token), live: settings.live };
    };

    // First emails.
    const queued = await db.campaignProspect.findMany({
      where: { campaignId: campaign.id, status: "QUEUED" },
      include: { prospect: true },
      orderBy: { createdAt: "asc" },
    });
    for (const row of queued) {
      if (room <= 0) break;
      const firstSent = await db.outreachMessage.count({ where: { step: "FIRST", status: { in: ["SENT", "DRY_RUN"] }, campaignProspect: { campaignId: campaign.id } } });
      if (firstSent >= campaign.maxEmails) break;
      // Check again right before sending: someone may have unsubscribed since discovery.
      const check = await verifyProspect(db, row.prospect, { now, checkMx: false });
      if (!check.ok) {
        await db.campaignProspect.update({ where: { id: row.id }, data: { status: "SKIPPED", skipReason: check.reason } });
        result.skipped++;
        continue;
      }
      const personalLine = row.personalLine ?? (await allowed(campaign.coopId)
        ? await personalLineFor({ coopId: campaign.coopId, businessName: row.prospect.businessName, about: row.prospect.description, categoryLabel: item?.name ?? category.label, forbiddenNames }, draft)
        : null);
      const delivered = await deliver({ ...row, personalLine }, "FIRST");
      if (!delivered) continue;
      await db.campaignProspect.update({ where: { id: row.id }, data: { status: "SENT", firstSentAt: now, replyTokenHash: delivered.hash, personalLine } });
      await db.vendorProspect.update({ where: { id: row.prospectId }, data: { status: "CONTACTED", lastContactedAt: now } });
      room--;
      if (delivered.live) result.sent++;
      else result.dryRun++;
    }

    // One follow-up, a week later, for businesses that haven't answered.
    const due = await db.campaignProspect.findMany({
      where: { campaignId: campaign.id, status: "SENT", firstSentAt: { lte: new Date(now.getTime() - FOLLOW_UP_AFTER_DAYS * DAY_MS) } },
      include: { prospect: true },
    });
    for (const row of due) {
      if (room <= 0) break;
      const check = await verifyProspect(db, { ...row.prospect, lastContactedAt: null }, { now, checkMx: false });
      if (!check.ok) {
        await db.campaignProspect.update({ where: { id: row.id }, data: { status: "SKIPPED", skipReason: check.reason } });
        continue;
      }
      const delivered = await deliver(row, "FOLLOW_UP");
      if (!delivered) continue;
      await db.campaignProspect.update({ where: { id: row.id }, data: { status: "FOLLOWED_UP", followUpSentAt: now } });
      await db.vendorProspect.update({ where: { id: row.prospectId }, data: { status: "FOLLOWED_UP", lastContactedAt: now } });
      room--;
      result.followUps++;
    }

    // Done when nobody is waiting for a first email or a follow-up.
    const waiting = await db.campaignProspect.count({ where: { campaignId: campaign.id, status: { in: ["QUEUED", "SENT"] } } });
    if (waiting === 0) {
      const done = await db.vendorCampaign.updateMany({ where: { id: campaign.id, status: "ACTIVE" }, data: { status: "COMPLETED" } });
      result.campaignsCompleted += done.count;
    }
  }
  return result;
}

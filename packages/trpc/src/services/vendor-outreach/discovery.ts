import type { Context } from "../../context.js";

import { sageAutonomyAllowed } from "../sage-autonomy.js";
import { dealCategoryByKey } from "./categories.js";
import { businessDomain, normalizeEmail } from "./referrals.js";
import { runVendorResearch, type ResearchRunner } from "./research-agent.js";
import { enabledDirectoryHints, enabledSourceTypes, suggestSource } from "./sources.js";
import { verifyProspect, type MxResolver } from "./verify.js";

type Db = Context["db"];

export interface DiscoveryDeps {
  now?: Date;
  research?: ResearchRunner;
  resolveMx?: MxResolver;
  autonomyAllowed?: (coopId: string) => Promise<boolean>;
}

type ProspectSeed = {
  businessName: string;
  category: string;
  email?: string | null;
  website?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  description?: string | null;
  sourceType: "CAHOOTZ_SHOP" | "WEB_SEARCH";
  sourceUrl?: string | null;
  storeId?: string | null;
};

/** One prospect per business across the platform: match by email, then website domain, then shop. */
async function findOrCreateProspect(db: Db, seed: ProspectSeed) {
  const emailNormalized = normalizeEmail(seed.email ?? undefined);
  const domain = businessDomain(seed.website ?? undefined, seed.email ?? undefined);
  const existing =
    (emailNormalized ? await db.vendorProspect.findUnique({ where: { emailNormalized } }) : null) ??
    (domain ? await db.vendorProspect.findFirst({ where: { domain } }) : null) ??
    (seed.storeId ? await db.vendorProspect.findFirst({ where: { storeId: seed.storeId } }) : null);
  if (existing) return existing;
  try {
    return await db.vendorProspect.create({
      data: {
        businessName: seed.businessName.slice(0, 120),
        category: seed.category,
        description: seed.description?.slice(0, 500) ?? null,
        website: seed.website?.slice(0, 300) ?? null,
        domain,
        email: seed.email?.trim() ?? null,
        emailNormalized,
        phone: seed.phone?.slice(0, 40) ?? null,
        city: seed.city?.slice(0, 100) ?? null,
        state: seed.state?.slice(0, 50) ?? null,
        sourceType: seed.sourceType,
        sourceUrl: seed.sourceUrl?.slice(0, 500) ?? null,
        storeId: seed.storeId ?? null,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002" && emailNormalized) {
      return db.vendorProspect.findUniqueOrThrow({ where: { emailNormalized } });
    }
    throw error;
  }
}

function inArea(area: string | null, city: string | null | undefined) {
  if (!area || !city) return true;
  return area.toLowerCase().includes(city.toLowerCase()) || city.toLowerCase().includes(area.toLowerCase().split(",")[0]!.trim());
}

/**
 * Phase 3: finds businesses for an ACTIVE campaign and queues the ones that
 * pass the checks. Runs once per campaign (discoveredAt), and only for a
 * campaign a platform admin approved.
 */
export async function discoverForCampaign(db: Db, campaignId: string, deps: DiscoveryDeps = {}) {
  const now = deps.now ?? new Date();
  const campaign = await db.vendorCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "ACTIVE" || campaign.discoveredAt) return { found: 0, queued: 0, skipped: 0, searched: false };
  const category = dealCategoryByKey(campaign.category);
  if (!category) return { found: 0, queued: 0, skipped: 0, searched: false };

  const sources = await enabledSourceTypes(db);
  const prospectIds = new Set<string>();

  if (sources.has("CAHOOTZ_SHOP")) {
    const stores = await db.store.findMany({
      where: { status: "APPROVED", deletedAt: null, category: { in: category.storeCategories } },
      select: { id: true, name: true, email: true, phone: true, website: true, city: true, state: true, description: true },
      take: 50,
    });
    for (const store of stores.filter((candidate) => inArea(campaign.area, candidate.city))) {
      const prospect = await findOrCreateProspect(db, {
        businessName: store.name, category: category.key, email: store.email, website: store.website, phone: store.phone,
        city: store.city, state: store.state, description: store.description, sourceType: "CAHOOTZ_SHOP", storeId: store.id,
      });
      prospectIds.add(prospect.id);
    }
  }

  if (sources.has("MEMBER_REFERRAL")) {
    const referred = await db.vendorProspect.findMany({
      where: { category: category.key, sourceType: "MEMBER_REFERRAL" },
      select: { id: true, city: true },
      take: 50,
    });
    for (const prospect of referred.filter((candidate) => inArea(campaign.area, candidate.city))) prospectIds.add(prospect.id);
  }

  let searched = false;
  const allowed = deps.autonomyAllowed ?? sageAutonomyAllowed;
  if (sources.has("WEB_SEARCH") && campaign.area && campaign.searchesUsed < campaign.maxSearches && (await allowed(campaign.coopId))) {
    searched = true;
    await db.vendorCampaign.update({ where: { id: campaign.id }, data: { searchesUsed: { increment: 1 } } });
    const result = await (deps.research ?? runVendorResearch)({
      coopId: campaign.coopId,
      categoryLabel: category.label,
      searchTerms: campaign.searchTerms,
      area: campaign.area,
      directoryHints: await enabledDirectoryHints(db),
      item: campaign.sourcedProductId
        ? await db.sourcedProduct.findUnique({ where: { id: campaign.sourcedProductId }, select: { name: true, supplierName: true, sourceUrl: true } })
        : null,
    }).catch((error) => {
      console.error("[Vendor outreach] Web research failed:", error);
      return null;
    });
    for (const business of result?.businesses ?? []) {
      if (!business.name.trim()) continue;
      const prospect = await findOrCreateProspect(db, {
        businessName: business.name, category: category.key, email: business.email, website: business.website,
        phone: business.phone, city: business.city, description: business.whyFit, sourceType: "WEB_SEARCH", sourceUrl: business.contactSourceUrl,
      });
      prospectIds.add(prospect.id);
    }
    for (const suggestion of result?.suggestedSources ?? []) await suggestSource(db, suggestion);
  }

  let queued = 0;
  let skipped = 0;
  for (const prospectId of prospectIds) {
    const prospect = await db.vendorProspect.findUniqueOrThrow({ where: { id: prospectId } });
    const check = await verifyProspect(db, prospect, { now, resolveMx: deps.resolveMx });
    // Only queue up to the email limit; anyone else is kept for a later campaign.
    const room = check.ok && queued < campaign.maxEmails;
    try {
      await db.campaignProspect.create({
        data: {
          campaignId: campaign.id,
          prospectId,
          status: room ? "QUEUED" : "SKIPPED",
          skipReason: check.ok ? (room ? null : "OVER_LIMIT") : check.reason,
        },
      });
      if (room) queued++;
      else skipped++;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  await db.vendorCampaign.update({ where: { id: campaign.id }, data: { discoveredAt: now } });
  return { found: prospectIds.size, queued, skipped, searched };
}

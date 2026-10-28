import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import {
  DEAL_CATEGORIES,
  listCampaignsForAdmin,
  listDemandForAdmin,
  listItemsForAdmin,
  listProspectsForAdmin,
  listSourcesForAdmin,
  outreachFunnel,
  outreachSettings,
} from '@repo/trpc/services/vendor-outreach';
import { offerPricingSettings } from '@repo/trpc/services/marketplace-offers';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Everything on the Vendor Outreach page: demand, campaigns, businesses, discovered items, sources and the funnel. */
export async function GET() {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    const [demand, campaigns, prospects, items, sources, funnel, settings, pricing] = await Promise.all([
      listDemandForAdmin(db),
      listCampaignsForAdmin(db),
      listProspectsForAdmin(db),
      listItemsForAdmin(db),
      listSourcesForAdmin(db),
      outreachFunnel(db),
      outreachSettings(db),
      offerPricingSettings(db),
    ]);
    return NextResponse.json({ demand, campaigns, prospects, items, sources, funnel, sendingLive: settings.live,
      pricing,
      categories: DEAL_CATEGORIES.map(({ key, label }) => ({ key, label })),
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { createOffer, listOffersForAdmin, offerPricingSettings } from '@repo/trpc/services/marketplace-offers';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

export async function GET(_request: Request, { params }: { params: Promise<{ coopId: string }> }) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { coopId } = await params;
  try {
    const [offers, pricing] = await Promise.all([listOffersForAdmin(db, coopId), offerPricingSettings(db)]);
    return NextResponse.json({ offers, minShareCents: pricing.minShareCents, itemMarginBps: pricing.itemMarginBps });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ coopId: string }> }) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { coopId } = await params;
  try {
    const offer = await createOffer(db, admin.actorId, coopId, await request.json());
    return NextResponse.json({ offer }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

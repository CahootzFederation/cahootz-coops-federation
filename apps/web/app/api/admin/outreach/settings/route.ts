import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { updateOfferPricingSettings } from '@repo/trpc/services/marketplace-offers';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Platform admins adjust the Group Buy pricing rules (margin, minimum shares, pack size, minimum savings). */
export async function POST(request: Request) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    const pricing = await updateOfferPricingSettings(db, admin.actorId, await request.json());
    return NextResponse.json({ pricing });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

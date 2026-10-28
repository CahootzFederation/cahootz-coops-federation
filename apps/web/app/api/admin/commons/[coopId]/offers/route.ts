import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { createOffer, listOffersForAdmin, offerPricingSettings } from '@repo/trpc/services/marketplace-offers';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

export async function GET(_request: Request, { params }: { params: Promise<{ coopId: string }> }) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { coopId } = await params;
  try {
    const [offers, allProducts, pricing] = await Promise.all([
      listOffersForAdmin(db, coopId),
      // Products an offer can be built on: active items in any approved shop. A vendor
      // serving this Commons may be registered in another one; this Commons' shops come first.
      db.product.findMany({
        where: { isActive: true, kind: 'STANDARD', store: { status: 'APPROVED', deletedAt: null, businessId: { not: null } } },
        select: { id: true, name: true, priceUSD: true, store: { select: { id: true, name: true, coopId: true } } },
        orderBy: [{ store: { name: 'asc' } }, { name: 'asc' }],
        take: 500,
      }),
      offerPricingSettings(db),
    ]);
    const products = [
      ...allProducts.filter((product) => product.store.coopId === coopId),
      ...allProducts.filter((product) => product.store.coopId !== coopId),
    ];
    return NextResponse.json({ offers, products, minShareCents: pricing.minShareCents });
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

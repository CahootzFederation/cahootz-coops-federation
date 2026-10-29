import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { itemOfferDraft } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** What the Group Buy form fills in when it starts from a discovered item. */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { productId } = await params;
  try {
    const vendor = new URL(request.url).searchParams.get('vendor');
    return NextResponse.json(await itemOfferDraft(db, productId, new Date(), vendor));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { reviewItem, startSellerSearch } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/**
 * Review an item the product-discovery bot found ({ action: "review" }), or start
 * looking for a seller of an approved one ({ action: "findSeller" }).
 */
export async function POST(request: Request) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    const { action, ...body } = (await request.json()) as { action?: string } & Record<string, unknown>;
    if (action === 'review') {
      await reviewItem(db, admin.actorId, body as Parameters<typeof reviewItem>[2]);
      return NextResponse.json({ ok: true });
    }
    if (action === 'findSeller') {
      return NextResponse.json(await startSellerSearch(db, admin.actorId, body as Parameters<typeof startSellerSearch>[2]));
    }
    return NextResponse.json({ error: "We didn't recognize that action. Refresh and try again." }, { status: 400 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

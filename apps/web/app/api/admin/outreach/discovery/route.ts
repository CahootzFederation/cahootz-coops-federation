import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { startProductDiscoveryRun } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Start a product-discovery run for one profile. What it finds lands on Product ideas as candidates. */
export async function POST(request: Request) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    const body = (await request.json()) as Parameters<typeof startProductDiscoveryRun>[2];
    return NextResponse.json(await startProductDiscoveryRun(db, admin.actorId, body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

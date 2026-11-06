import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { updateDiscoveryProfile } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Change what the product bot looks for on one profile. Every later search uses it. */
export async function POST(request: Request) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    const body = (await request.json()) as Parameters<typeof updateDiscoveryProfile>[2];
    return NextResponse.json(await updateDiscoveryProfile(db, admin.actorId, body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

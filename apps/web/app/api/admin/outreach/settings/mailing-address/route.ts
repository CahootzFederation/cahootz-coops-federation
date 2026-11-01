import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { updateOutreachPostalAddress } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Platform admins set the mailing address printed at the bottom of every outreach email. */
export async function POST(request: Request) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    return NextResponse.json(await updateOutreachPostalAddress(db, admin.actorId, await request.json()));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

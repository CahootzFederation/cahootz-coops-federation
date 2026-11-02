import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { updateProspect } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Pipeline actions on a business: in talks, converted (with the offer), declined, or do not email. */
export async function POST(request: Request, { params }: { params: Promise<{ prospectId: string }> }) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { prospectId } = await params;
  try {
    await updateProspect(db, admin.actorId, prospectId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

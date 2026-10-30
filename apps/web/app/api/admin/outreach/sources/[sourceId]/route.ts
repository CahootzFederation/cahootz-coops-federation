import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@repo/db';
import { setSourceStatus } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Turn a place Sage may search on or off. Sage's suggestions do nothing until enabled here. */
export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { sourceId } = await params;
  try {
    const { status } = z.object({ status: z.enum(['ENABLED', 'DISABLED']) }).parse(await request.json());
    await setSourceStatus(db, admin.actorId, sourceId, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

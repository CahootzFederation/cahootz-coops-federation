import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { offersReport } from '@repo/trpc/services/marketplace-offers';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

export async function GET() {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    return NextResponse.json({ rows: await offersReport(db) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

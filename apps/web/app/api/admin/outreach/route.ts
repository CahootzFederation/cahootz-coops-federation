import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { listDemandForAdmin, listProspectsForAdmin } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

/** Sage's deal questions (with how many members answered) and the businesses members recommended. */
export async function GET() {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  try {
    const [demand, prospects] = await Promise.all([listDemandForAdmin(db), listProspectsForAdmin(db)]);
    return NextResponse.json({ demand, prospects });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

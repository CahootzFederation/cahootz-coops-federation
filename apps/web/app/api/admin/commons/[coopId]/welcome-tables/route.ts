import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import {
  getWelcomeTableConfig,
  listWelcomeTableHistory,
  updateWelcomeTableConfig,
} from '@repo/trpc/services/welcome-tables';

async function requireAdminSession() {
  const session = await getSession();
  const isAdmin = !!session && (isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email));
  return isAdmin ? session : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ coopId: string }> },
) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { coopId } = await params;
  const { db } = await import('@repo/db');

  const [configResult, history] = await Promise.all([
    getWelcomeTableConfig(db, coopId),
    listWelcomeTableHistory(db, coopId),
  ]);

  return NextResponse.json({
    config: configResult?.config ?? null,
    activeTable: configResult?.activeTable ?? null,
    history,
  });
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  capacity: z.number().int().min(1).max(500).optional(),
  guideUserId: z.string().min(1).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ coopId: string }> },
) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const body = await request.json();
  const result = patchSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid welcome lounge config update.' }, { status: 400 });
  }

  const { coopId } = await params;
  const { db } = await import('@repo/db');
  const config = await updateWelcomeTableConfig(db, coopId, result.data, session.address);

  return NextResponse.json({ config });
}

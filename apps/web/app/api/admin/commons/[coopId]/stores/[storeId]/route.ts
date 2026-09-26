import { NextResponse } from 'next/server';

import { isPlatformAdminEmail, isPlatformAdminWallet } from '@repo/trpc/lib/admin-config';
import { getCommonsStoreDetail } from '@repo/trpc/services/platform-admin';

import { getSession } from '@/lib/signature-verification';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ coopId: string; storeId: string }> },
) {
  const session = await getSession();
  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { coopId, storeId } = await params;
  const store = await getCommonsStoreDetail(coopId, storeId);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  return NextResponse.json({ store });
}

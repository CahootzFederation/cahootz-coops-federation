import { NextResponse } from 'next/server';

import { isPlatformAdminEmail, isPlatformAdminWallet } from '@repo/trpc/lib/admin-config';
import { listCommonsStores } from '@repo/trpc/services/platform-admin';

import { getSession } from '@/lib/signature-verification';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ coopId: string }> },
) {
  const session = await getSession();
  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { coopId } = await params;
  return NextResponse.json({ stores: await listCommonsStores(coopId) });
}

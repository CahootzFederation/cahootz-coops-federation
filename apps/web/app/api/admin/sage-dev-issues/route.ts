import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { getDevIssueCadence, listSageDevIssueDrafts } from '@repo/trpc/services/sage-dev-issues';

/** Sage's issue ideas and how often it drafts them. Platform admins only; members never see these. */
export async function GET() {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const [cadence, drafts] = await Promise.all([getDevIssueCadence(), listSageDevIssueDrafts()]);

  return NextResponse.json({ cadence, drafts });
}

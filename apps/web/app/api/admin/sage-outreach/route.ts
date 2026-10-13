import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { listSageOutreachHistory } from '@repo/trpc/services/sage-weekly-outreach';

/** Most recent Sage check-in per member, for the platform admin outreach page. */
export async function GET() {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const history = await listSageOutreachHistory();

  return NextResponse.json({ history });
}

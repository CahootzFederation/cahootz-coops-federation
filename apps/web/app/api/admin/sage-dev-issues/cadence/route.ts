import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { DEV_ISSUE_CADENCES, setDevIssueCadence } from '@repo/trpc/services/sage-dev-issues';

/** Switches Sage's issue ideas between weekly and monthly. Takes effect on the next daily check. */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { cadence?: unknown } | null;
  const cadence = DEV_ISSUE_CADENCES.find((value) => value === body?.cadence);
  if (!cadence) {
    return NextResponse.json({ error: 'Pick weekly or monthly.' }, { status: 400 });
  }

  await setDevIssueCadence(cadence, session.userId ?? session.email ?? session.address);
  return NextResponse.json({ cadence });
}

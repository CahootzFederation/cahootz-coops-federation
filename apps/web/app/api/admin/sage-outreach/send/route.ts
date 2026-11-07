import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { sendSageOutreachNow } from '@repo/trpc/services/sage-weekly-outreach';

/** Sends a Sage check-in to the member the platform admin chose. Audited with the admin as the actor. */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { userId?: unknown } | null;
  if (typeof body?.userId !== 'string' || !body.userId) {
    return NextResponse.json({ error: 'Choose a member to send the check-in to.' }, { status: 400 });
  }

  try {
    const result = await sendSageOutreachNow(body.userId, { sentBy: session.userId ?? session.email ?? session.address });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send check-in.' },
      { status: 400 }
    );
  }
}

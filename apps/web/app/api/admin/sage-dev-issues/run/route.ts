import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { runSageDevIssueSuggestion } from '@repo/trpc/services/sage-dev-issues';

/** Drafts this period's issue idea now instead of waiting for the daily check. One model call at most. */
export async function POST() {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  try {
    return NextResponse.json(await runSageDevIssueSuggestion());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sage couldn't draft an issue. Try again in a bit." },
      { status: 500 }
    );
  }
}

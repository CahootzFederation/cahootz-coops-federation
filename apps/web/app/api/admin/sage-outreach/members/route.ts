import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { searchOutreachMembers } from '@repo/trpc/services/sage-weekly-outreach';

/** Active members matching ?q= (name or email), for choosing who gets a Sage check-in. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const members = await searchOutreachMembers(request.nextUrl.searchParams.get('q') ?? '');

  return NextResponse.json({ members });
}

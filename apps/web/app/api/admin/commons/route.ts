import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { listCommonsWithStats } from '@repo/trpc/services/platform-admin';

/**
 * List every commons with member/application/post counts.
 * Re-checks the allowlist server-side against the session rather than
 * trusting session.isPlatformAdmin, since the allowlist can change without
 * the session being refreshed.
 */
export async function GET() {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const commons = await listCommonsWithStats();

  return NextResponse.json({ commons });
}

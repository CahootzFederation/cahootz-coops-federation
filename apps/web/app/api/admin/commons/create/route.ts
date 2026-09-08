import { NextResponse } from 'next/server';
import { db, getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { createCommonsConfig } from '@repo/trpc/routers/coop-config';

/**
 * Creates a new commons' CoopConfig row. Gated by the same iron-session
 * check that protects the rest of /portal/admin - if you can log into the
 * admin portal (wallet or email), you can create a commons. No separate
 * wallet allowlist to keep in sync with PLATFORM_ADMIN_EMAILS.
 *
 * Called from apps/web/app/initialize/page.tsx after contracts are
 * deployed client-side (that part still needs a connected wallet to sign
 * transactions and pay gas - this route only gates the database write).
 */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  try {
    const commons = await createCommonsConfig(db, body);
    return NextResponse.json({ commons });
  } catch (error) {
    console.error('[admin] createCommonsConfig failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create commons.' },
      { status: 400 }
    );
  }
}

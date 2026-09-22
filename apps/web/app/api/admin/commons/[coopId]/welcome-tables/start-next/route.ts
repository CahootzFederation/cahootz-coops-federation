import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { startNextWelcomeTable } from '@repo/trpc/services/welcome-tables';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ coopId: string }> },
) {
  const session = await getSession();
  const isAdmin = !!session && (isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email));
  if (!session || !isAdmin) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { coopId } = await params;
  const { db } = await import('@repo/db');

  try {
    const group = await startNextWelcomeTable(db, coopId, session.address);
    return NextResponse.json({
      groupId: group.id,
      name: group.name,
      welcomeTableNumber: group.welcomeTableNumber,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start the next welcome lounge.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

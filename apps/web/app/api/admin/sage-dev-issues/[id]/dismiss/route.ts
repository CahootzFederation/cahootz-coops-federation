import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { dismissSageDevIssueDraft } from '@repo/trpc/services/sage-dev-issues';

/** Drops one of Sage's drafts without posting it. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { id } = await params;
  try {
    await dismissSageDevIssueDraft(id, session.userId ?? session.email ?? session.address);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't dismiss that draft." },
      { status: 400 }
    );
  }
}

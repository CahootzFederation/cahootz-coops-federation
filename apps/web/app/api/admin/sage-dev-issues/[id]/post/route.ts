import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { postSageDevIssueDraft } from '@repo/trpc/services/sage-dev-issues';

/** Posts one of Sage's drafts to the public GitHub repo, with the admin recorded as the poster. */
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
    const draft = await postSageDevIssueDraft(id, session.userId ?? session.email ?? session.address);
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't post to GitHub. Try again in a bit." },
      { status: 400 }
    );
  }
}

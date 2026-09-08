import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { listCommonsMembers } from '@repo/trpc/services/platform-admin';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ coopId: string }> }
) {
  const session = await getSession();

  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { coopId } = await params;
  const { searchParams } = new URL(request.url);

  const result = await listCommonsMembers(coopId, {
    search: searchParams.get('search') || undefined,
    page: Number(searchParams.get('page')) || 1,
    pageSize: Number(searchParams.get('pageSize')) || undefined,
  });

  return NextResponse.json(result);
}

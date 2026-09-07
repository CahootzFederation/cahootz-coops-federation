import { NextResponse } from 'next/server';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { listCommonsApplications } from '@repo/trpc/services/platform-admin';

const VALID_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

function parseStatus(value: string | null): ValidStatus | undefined {
  return value && (VALID_STATUSES as readonly string[]).includes(value) ? (value as ValidStatus) : undefined;
}

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

  const result = await listCommonsApplications(coopId, {
    search: searchParams.get('search') || undefined,
    status: parseStatus(searchParams.get('status')),
    page: Number(searchParams.get('page')) || 1,
    pageSize: Number(searchParams.get('pageSize')) || undefined,
  });

  return NextResponse.json(result);
}

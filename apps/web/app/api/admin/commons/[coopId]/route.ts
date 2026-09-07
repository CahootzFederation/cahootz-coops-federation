import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { getCommonsDetail, setCommonsPrivate } from '@repo/trpc/services/platform-admin';

async function requireAdmin() {
  const session = await getSession();
  const isAdmin = !!session && (isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email));
  return isAdmin;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ coopId: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const { coopId } = await params;
  const commons = await getCommonsDetail(coopId);

  if (!commons) {
    return NextResponse.json({ error: 'Commons not found' }, { status: 404 });
  }

  return NextResponse.json({ commons });
}

const patchSchema = z.object({
  isPrivate: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ coopId: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const body = await request.json();
  const result = patchSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: 'isPrivate (boolean) is required.' }, { status: 400 });
  }

  const { coopId } = await params;
  const updated = await setCommonsPrivate(coopId, result.data.isPrivate);

  if (!updated) {
    return NextResponse.json({ error: 'Commons not found' }, { status: 404 });
  }

  const commons = await getCommonsDetail(coopId);
  return NextResponse.json({ commons });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/signature-verification';
import { isPlatformAdminWallet, isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { getCommonsDetail, setCommonsIcon, setCommonsPrivate } from '@repo/trpc/services/platform-admin';

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
  isPrivate: z.boolean().optional(),
  iconEmoji: z.string().max(16).nullable().optional(),
  iconColor: z.string().max(16).nullable().optional(),
}).refine(
  (data) => data.isPrivate !== undefined || data.iconEmoji !== undefined || data.iconColor !== undefined,
  { message: 'At least one field is required.' },
);

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
    return NextResponse.json({ error: 'isPrivate (boolean), iconEmoji, and/or iconColor are required.' }, { status: 400 });
  }

  const { coopId } = await params;
  const { isPrivate, iconEmoji, iconColor } = result.data;

  if (isPrivate !== undefined) {
    const updated = await setCommonsPrivate(coopId, isPrivate);
    if (!updated) {
      return NextResponse.json({ error: 'Commons not found' }, { status: 404 });
    }
  }

  if (iconEmoji !== undefined || iconColor !== undefined) {
    const current = await getCommonsDetail(coopId);
    if (!current) {
      return NextResponse.json({ error: 'Commons not found' }, { status: 404 });
    }
    await setCommonsIcon(
      coopId,
      iconEmoji !== undefined ? iconEmoji : current.iconEmoji,
      iconColor !== undefined ? iconColor : current.iconColor,
    );
  }

  const commons = await getCommonsDetail(coopId);
  return NextResponse.json({ commons });
}

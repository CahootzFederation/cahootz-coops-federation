import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@repo/db';
import { isPlatformAdminEmail, isPlatformAdminWallet } from '@repo/trpc/lib/admin-config';
import {
  listFundingSettlementAccounts,
  setDefaultFundingSettlementAccount,
  setStoreFundingSettlementAccount,
} from '@repo/trpc/services/funding-settlement-service';

import { getSession } from '@/lib/signature-verification';

async function requirePlatformAdmin() {
  const session = await getSession();
  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return null;
  }
  return session;
}

export async function GET() {
  if (!(await requirePlatformAdmin())) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }
  return NextResponse.json(await listFundingSettlementAccounts());
}

export async function PUT(request: Request) {
  const session = await requirePlatformAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }

  const parsed = z.object({
    stripeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(),
    storeId: z.string().min(1).optional(),
  })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid Stripe connected account ID or select the shared default' }, { status: 400 });
  }

  const actor = await db.user.findFirst({
    where: {
      OR: [
        ...(session.email ? [{ email: { equals: session.email, mode: 'insensitive' as const } }] : []),
        ...(session.address ? [
          { walletAddress: { equals: session.address, mode: 'insensitive' as const } },
          { wallets: { some: { address: { equals: session.address, mode: 'insensitive' as const } } } },
        ] : []),
      ],
    },
    select: { id: true },
  });
  if (!actor) {
    return NextResponse.json({ error: 'Platform administrator account not found' }, { status: 404 });
  }

  try {
    if (parsed.data.storeId) {
      await setStoreFundingSettlementAccount({
        storeId: parsed.data.storeId,
        stripeAccountId: parsed.data.stripeAccountId,
        actorUserId: actor.id,
      });
    } else {
      if (!parsed.data.stripeAccountId) {
        return NextResponse.json({ error: 'The shared default account cannot be empty' }, { status: 400 });
      }
      await setDefaultFundingSettlementAccount({
        stripeAccountId: parsed.data.stripeAccountId,
        actorUserId: actor.id,
      });
    }
    return NextResponse.json(await listFundingSettlementAccounts());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update settlement account' },
      { status: 400 },
    );
  }
}

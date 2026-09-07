import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, createPlatformAdminSession } from '@/lib/signature-verification';
import { isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.'),
});

/**
 * Admin-only login code verification. Checks the LoginCode table directly
 * (same as apps/web/app/api/auth/email/verify) but does NOT require an
 * active coop membership - platform admin access is not coop-scoped.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = verifyCodeSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json({ error: 'Enter the six-digit code from your email.' }, { status: 400 });
    }

    const email = result.data.email.trim().toLowerCase();
    const { code } = result.data;

    if (!isPlatformAdminEmail(email)) {
      return NextResponse.json({ error: 'This email is not authorized for admin access.' }, { status: 403 });
    }

    const loginCode = await db.loginCode.findFirst({
      where: { email, code, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!loginCode) {
      return NextResponse.json({ error: 'That code is invalid or expired.' }, { status: 401 });
    }

    await db.loginCode.update({ where: { id: loginCode.id }, data: { used: true } });

    let user = await db.user.findUnique({ where: { email } });

    if (!user) {
      user = await db.user.create({
        data: { email, roles: ['member'], status: 'ACTIVE' },
      });
    }

    if (user.deletedAt) {
      return NextResponse.json(
        { error: 'This account has been deleted. Contact support if you need help.' },
        { status: 403 }
      );
    }

    const session = await createPlatformAdminSession({ userId: user.id, email });

    return NextResponse.json({
      success: true,
      email: session.email,
      isPlatformAdmin: true,
    });
  } catch (error) {
    console.error('Error verifying admin login code:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to verify login code.' },
      { status: 500 }
    );
  }
}

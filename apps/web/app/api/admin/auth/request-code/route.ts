import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isPlatformAdminEmail } from '@repo/trpc/lib/admin-config';
import { env } from '~/env';

const requestCodeSchema = z.object({
  email: z.string().email(),
});

function getApiTrpcUrl() {
  const apiUrl = env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/trpc';
  return apiUrl.endsWith('/trpc') ? apiUrl : `${apiUrl.replace(/\/$/, '')}/trpc`;
}

/**
 * Admin-only login code request. Reuses the existing auth.requestLoginCode
 * mutation (same LoginCode table + Resend template as member login), but
 * gates it to PLATFORM_ADMIN_EMAILS and always targets the one real commons
 * so a brand-new admin email doesn't get rejected by the generic route's
 * default coopId branching (see apps/web/app/api/auth/email/request-code).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = requestCodeSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const email = result.data.email.trim().toLowerCase();

    if (!isPlatformAdminEmail(email)) {
      return NextResponse.json({ error: 'This email is not authorized for admin access.' }, { status: 403 });
    }

    const apiResponse = await fetch(`${getApiTrpcUrl()}/auth.requestLoginCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, coopId: 'cahootz' }),
    });

    const data = await apiResponse.json();

    if (!apiResponse.ok || !data.result?.data?.success) {
      return NextResponse.json(
        { error: data.error?.message || 'Failed to send login code.' },
        { status: apiResponse.ok ? 400 : apiResponse.status }
      );
    }

    return NextResponse.json({ success: true, message: data.result.data.message });
  } catch (error) {
    console.error('Error requesting admin login code:', error);
    return NextResponse.json({ error: 'Failed to send login code.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

import { isPlatformAdminEmail, isPlatformAdminWallet } from '@repo/trpc/lib/admin-config';

import { getSession } from '@/lib/signature-verification';

/**
 * Checks the signed-in session is on the platform admin allowlist. Returns the
 * admin's identity for audit logs, or a 403 response to send back.
 */
export async function requirePlatformAdmin(): Promise<{ actorId: string } | { response: NextResponse }> {
  const session = await getSession();
  if (!session || !(isPlatformAdminWallet(session.address) || isPlatformAdminEmail(session.email))) {
    return { response: NextResponse.json({ error: 'Platform admin access required' }, { status: 403 }) };
  }
  return { actorId: `platform-admin:${session.email || session.address}` };
}

/** Turns a service error into a plain JSON error with a sensible status. */
export function adminErrorResponse(error: unknown) {
  const code = (error as { code?: string })?.code;
  const status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : code === 'CONFLICT' ? 409 : code === 'BAD_REQUEST' ? 400 : 500;
  const issues = (error as { issues?: Array<{ message: string }> })?.issues;
  const message = issues?.length
    ? issues.map((issue) => issue.message).join(' ')
    : error instanceof Error && status !== 500
      ? error.message
      : "That didn't work. Try again, and check the server logs if it keeps happening.";
  if (status === 500) console.error('[admin offers]', error);
  return NextResponse.json({ error: message }, { status: issues?.length ? 400 : status });
}

import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { unsubscribeByToken } from '@repo/trpc/services/vendor-outreach';

/** One-click unsubscribe (the email's List-Unsubscribe header posts here). */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return NextResponse.json(await unsubscribeByToken(db, token));
  } catch (error) {
    const notFound = (error as { code?: string })?.code === 'NOT_FOUND';
    if (!notFound) console.error('[vendor unsubscribe]', error);
    return NextResponse.json({ error: notFound ? "This link doesn't work anymore." : "That didn't go through. Please try again." }, { status: notFound ? 404 : 500 });
  }
}

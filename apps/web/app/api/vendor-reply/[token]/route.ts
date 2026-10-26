import { NextResponse } from 'next/server';

import { db } from '@repo/db';
import { loadReplyPage, recordVendorResponse } from '@repo/trpc/services/vendor-outreach';

/**
 * The public reply link from an outreach email. The token is the only key: it's
 * long, random-looking and tied to one business in one campaign.
 */
function errorResponse(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === 'NOT_FOUND') return NextResponse.json({ error: (error as Error).message }, { status: 404 });
  if ((error as { issues?: unknown })?.issues) return NextResponse.json({ error: 'Pick an answer and try again.' }, { status: 400 });
  console.error('[vendor reply]', error);
  return NextResponse.json({ error: "That didn't go through. Please try again in a minute." }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return NextResponse.json(await loadReplyPage(db, token));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return NextResponse.json(await recordVendorResponse(db, token, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@repo/db';
import { approveCampaign, moveCampaign } from '@repo/trpc/services/vendor-outreach';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    area: z.string(),
    maxEmails: z.number().int().optional(),
    maxSearches: z.number().int().optional(),
    pitchPoints: z.string().optional().nullable(),
    searchTerms: z.array(z.string()).optional(),
  }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('complete') }),
]);

/** Approve (with the area and limits), reject, pause, resume or end a campaign. */
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { campaignId } = await params;
  try {
    const body = bodySchema.parse(await request.json());
    if (body.action === 'approve') {
      const { action: _action, ...edits } = body;
      await approveCampaign(db, admin.actorId, campaignId, edits);
    } else {
      await moveCampaign(db, admin.actorId, campaignId, body.action, 'reason' in body ? body.reason : undefined);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

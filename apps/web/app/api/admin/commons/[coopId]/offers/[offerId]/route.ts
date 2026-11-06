import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@repo/db';
import {
  assertCoop,
  cancelOffer,
  closeCommitmentsEarly,
  getOfferForAdmin,
  pauseOffer,
  publishOffer,
  recordVendorPayout,
  refundCommitment,
  resumeOffer,
  updateFulfillment,
  updateOffer,
} from '@repo/trpc/services/marketplace-offers';

import { adminErrorResponse, requirePlatformAdmin } from '@/lib/platform-admin-session';

interface Params { params: Promise<{ coopId: string; offerId: string }> }

async function loadInCoop(coopId: string, offerId: string) {
  const offer = await getOfferForAdmin(db, offerId);
  assertCoop(offer, coopId);
  return offer;
}

export async function GET(_request: Request, { params }: Params) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { coopId, offerId } = await params;
  try {
    return NextResponse.json({ offer: await loadInCoop(coopId, offerId) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

/** Edit a draft. */
export async function PUT(request: Request, { params }: Params) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { coopId, offerId } = await params;
  try {
    await loadInCoop(coopId, offerId);
    const offer = await updateOffer(db, admin.actorId, offerId, await request.json());
    return NextResponse.json({ offer });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('closeEarly') }),
  z.object({
    action: z.literal('vendorPayout'),
    amountCents: z.number().int().positive(),
    paidAt: z.coerce.date(),
    method: z.string().trim().min(2).max(60),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('fulfillment'), status: z.enum(['ORDERED', 'READY', 'FULFILLED']) }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('refundCommitment'), commitmentId: z.string().min(1), reason: z.string().trim().min(3).max(500) }),
]);

async function assertOrderInOffer(commitmentId: string, offerId: string) {
  const order = await db.offerCommitment.findUnique({ where: { id: commitmentId }, select: { offerId: true } });
  if (order?.offerId !== offerId) throw Object.assign(new Error("That order isn't part of this offer."), { code: 'NOT_FOUND' });
}

/** Status actions: publish, pause, cancel, mark shipped, record a vendor payment, and so on. */
export async function POST(request: Request, { params }: Params) {
  const admin = await requirePlatformAdmin();
  if ('response' in admin) return admin.response;
  const { coopId, offerId } = await params;
  try {
    await loadInCoop(coopId, offerId);
    const body = actionSchema.parse(await request.json());
    let result: unknown = { ok: true };
    switch (body.action) {
      case 'publish':
        await publishOffer(db, admin.actorId, offerId);
        break;
      case 'pause':
        await pauseOffer(db, admin.actorId, offerId);
        break;
      case 'resume':
        await resumeOffer(db, admin.actorId, offerId);
        break;
      case 'closeEarly':
        result = await closeCommitmentsEarly(db, admin.actorId, offerId);
        break;
      case 'vendorPayout':
        await recordVendorPayout(db, admin.actorId, offerId, body);
        break;
      case 'fulfillment':
        await updateFulfillment(db, admin.actorId, offerId, body.status);
        break;
      case 'cancel':
        result = await cancelOffer(db, admin.actorId, offerId, body.reason);
        break;
      case 'refundCommitment':
        await assertOrderInOffer(body.commitmentId, offerId);
        result = await refundCommitment(db, admin.actorId, body.commitmentId, body.reason);
        break;
    }
    return NextResponse.json({ result, offer: await getOfferForAdmin(db, offerId) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

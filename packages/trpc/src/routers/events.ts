import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { AccountAuthenticatedContext, Context } from '../context.js';
import { COMMONS_COOP_ID, ensureUserHandle } from '../lib/commons.js';
import {
  accountAuthenticatedProcedure,
  publicProcedure,
} from '../procedures/index.js';
import { router } from '../trpc.js';
import {
  displayName,
  generalCircleId,
  mapEventSummary,
  personHandle,
  requireActiveCommonsMembership,
  requireCircleMembership,
  resolveOptionalAccountUser,
} from './commons.js';

const rsvpStatusSchema = z.enum(['GOING', 'MAYBE', 'CANT_GO']);
const recurrenceFreqSchema = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);

function addOccurrence(base: Date, freq: z.infer<typeof recurrenceFreqSchema>, steps: number) {
  const next = new Date(base);
  if (freq === 'DAILY') next.setDate(next.getDate() + steps);
  else if (freq === 'WEEKLY') next.setDate(next.getDate() + steps * 7);
  else next.setMonth(next.getMonth() + steps);
  return next;
}

const eventInclude = {
  hosts: {
    include: {
      user: { select: { id: true, name: true, email: true, handle: true } },
    },
  },
  rsvps: { select: { userId: true, status: true } },
};

function resolveCircleId(coopId: string, circleId?: string) {
  return circleId && circleId !== generalCircleId(coopId)
    ? circleId
    : generalCircleId(coopId);
}

export const eventsRouter = router({
  create: accountAuthenticatedProcedure
    .input(
      z
        .object({
          coopId: z.string().min(1).default(COMMONS_COOP_ID),
          circleId: z.string().min(1).optional(),
          title: z.string().trim().min(1).max(120),
          description: z.string().trim().max(5000).default(''),
          startAt: z.coerce.date(),
          endAt: z.coerce.date(),
          isOnline: z.boolean().default(true),
          location: z.string().trim().max(240).optional(),
          meetingUrl: z.string().trim().url().max(500).optional(),
          allowComments: z.boolean().default(true),
          recurrence: z
            .object({
              freq: recurrenceFreqSchema,
              interval: z.number().int().min(1).max(12).default(1),
              count: z.number().int().min(2).max(24).default(4),
            })
            .optional(),
        })
        .refine((input) => input.endAt > input.startAt, {
          message: 'End time must be after the start time.',
          path: ['endAt'],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      await requireActiveCommonsMembership(ctx.db, accountUser.id, input.coopId);

      const circleId = resolveCircleId(input.coopId, input.circleId);
      if (circleId !== generalCircleId(input.coopId)) {
        await requireCircleMembership(ctx.db, accountUser.id, input.coopId, circleId);
      }
      await ensureUserHandle(ctx.db, accountUser);

      const durationMs = input.endAt.getTime() - input.startAt.getTime();
      const occurrenceCount = input.recurrence?.count ?? 1;
      const seriesId = input.recurrence ? randomUUID() : null;

      const posts = await ctx.db.$transaction(async (tx: any) => {
        const created = [];
        for (let index = 0; index < occurrenceCount; index += 1) {
          const startAt = input.recurrence
            ? addOccurrence(input.startAt, input.recurrence.freq, index * input.recurrence.interval)
            : input.startAt;
          const endAt = new Date(startAt.getTime() + durationMs);

          const post = await tx.commonsPost.create({
            data: {
              coopId: input.coopId,
              circleId,
              authorId: accountUser.id,
              title: input.title,
              content: input.description,
              tag: 'Event',
              classification: 'event',
              classificationConfidence: 0.95,
              classificationSignals: { version: 1, source: 'event_create' },
              event: {
                create: {
                  coopId: input.coopId,
                  circleId,
                  startAt,
                  endAt,
                  isOnline: input.isOnline,
                  location: input.location,
                  meetingUrl: input.meetingUrl,
                  allowComments: input.allowComments,
                  seriesId,
                  recurrenceFreq: input.recurrence?.freq,
                  recurrenceInterval: input.recurrence?.interval ?? 1,
                  recurrenceCount: input.recurrence?.count,
                  createdById: accountUser.id,
                  hosts: { create: { userId: accountUser.id } },
                  rsvps: { create: { userId: accountUser.id, status: 'GOING' } },
                },
              },
            },
            include: { event: { include: eventInclude } },
          });
          created.push(post);
        }
        return created;
      });

      const firstPost = posts[0];
      return {
        postId: firstPost.id,
        event: mapEventSummary(firstPost.event, accountUser.id),
        seriesCount: posts.length,
      };
    }),

  rsvp: accountAuthenticatedProcedure
    .input(
      z.object({
        eventId: z.string().min(1),
        status: rsvpStatusSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const event = await ctx.db.event.findUnique({
        where: { id: input.eventId },
        select: { id: true, coopId: true, circleId: true },
      });
      if (!event) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
      }
      await requireActiveCommonsMembership(ctx.db, accountUser.id, event.coopId);
      if (event.circleId && event.circleId !== generalCircleId(event.coopId)) {
        await requireCircleMembership(ctx.db, accountUser.id, event.coopId, event.circleId);
      }

      await ctx.db.eventRSVP.upsert({
        where: { eventId_userId: { eventId: event.id, userId: accountUser.id } },
        create: { eventId: event.id, userId: accountUser.id, status: input.status },
        update: { status: input.status },
      });

      const updated = await ctx.db.event.findUnique({
        where: { id: event.id },
        include: eventInclude,
      });

      return mapEventSummary(updated, accountUser.id);
    }),

  muteReminder: accountAuthenticatedProcedure
    .input(
      z.object({
        eventId: z.string().min(1),
        muted: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const event = await ctx.db.event.findUnique({
        where: { id: input.eventId },
        select: { id: true },
      });
      if (!event) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
      }

      await ctx.db.eventReminder.upsert({
        where: { eventId_userId: { eventId: event.id, userId: accountUser.id } },
        create: { eventId: event.id, userId: accountUser.id, muted: input.muted },
        update: { muted: input.muted },
      });

      return { success: true };
    }),

  get: publicProcedure
    .input(z.object({ eventId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const event = await ctx.db.event.findUnique({
        where: { id: input.eventId },
        include: {
          ...eventInclude,
          post: {
            include: {
              author: { select: { name: true, email: true, handle: true } },
              comments: {
                orderBy: { createdAt: 'asc' },
                include: {
                  author: { select: { name: true, email: true, handle: true } },
                },
              },
              media: { orderBy: { order: 'asc' } },
              _count: { select: { comments: true, supports: true } },
            },
          },
        },
      });
      if (!event) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
      }

      const viewer = await resolveOptionalAccountUser(context);
      const viewerId = viewer?.id;

      return {
        ...mapEventSummary(event, viewerId),
        post: {
          id: event.post.id,
          title: event.post.title,
          body: event.post.content,
          author: displayName(event.post.author),
          authorHandle: personHandle(event.post.author),
          replies: event.post._count?.comments ?? 0,
          support: event.post._count?.supports ?? 0,
          media: event.post.media,
          comments: event.post.comments.map((comment: any) => ({
            id: comment.id,
            authorId: comment.authorId,
            author: displayName(comment.author),
            body: comment.content,
          })),
        },
      };
    }),

  listUpcoming: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
        circleId: z.string().min(1).optional(),
        limit: z.number().min(1).max(10).default(2),
      }),
    )
    .query(async ({ input, ctx }) => {
      const circleId = resolveCircleId(input.coopId, input.circleId);
      const where =
        circleId === generalCircleId(input.coopId)
          ? {
              OR: [
                { coopId: input.coopId, circleId: generalCircleId(input.coopId) },
                { coopId: input.coopId, circleId: null },
              ],
            }
          : { coopId: input.coopId, circleId };

      const events = await ctx.db.event.findMany({
        where: { ...where, startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        take: input.limit,
        include: { ...eventInclude, post: { select: { title: true } } },
      });

      return events.map((event: any) => ({
        ...mapEventSummary(event),
        title: event.post.title,
      }));
    }),
});

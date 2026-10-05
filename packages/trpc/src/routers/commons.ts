import { Agent, run } from '@openai/agents';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Prisma } from '@repo/db';

import type { AccountAuthenticatedContext, Context } from '../context.js';
import { COMMUNITY_OBSERVER_POST_TYPES, getAgent } from '../agents/registry.js';
import { auditLogEntry } from '../lib/audit.js';
import { ensureSageBotUser, isSageUser } from '../lib/bot.js';
import {
  COMMONS_COOP_ID,
  ensureCommonsMembership,
  ensureUserHandle,
} from '../lib/commons.js';
import { encodeMentions } from '../lib/mentions.js';
import { toE164 } from '../lib/phone.js';
import { resolveApplyReferral } from '../services/commons-invitations.js';
import {
  getCommonsPolicy,
  STEWARD_ROLES,
} from '../services/commons-membership.js';
import {
  accountAuthenticatedProcedure,
  publicProcedure,
} from '../procedures/index.js';
import { recordObservation } from '../services/ai-memory.js';
import { recordAgentResultCost } from '../services/ai-cost.js';
import { enqueueCommonsActionContent } from '../services/commons-action-dispatch.js';
import {
  DIRECT_KIND,
  listDirectCircleMessages,
  listDirectCircles,
  openDirectCircle,
  sendDirectCircleMessage,
} from '../services/direct-circles.js';
import { createNotificationAndPush } from '../services/push-notification-service.js';
import { notifyCircleActivity } from '../services/circle-notifications.js';
import { notifyNewCommentReaction } from '../services/comment-reactions.js';
import { recordWelcomeIntroActivity } from '../services/welcome-intros.js';
import { FUNDING_BADGE_BY_TIER } from '../services/funding-badge-service.js';
import { getSageAutonomyUsage } from '../services/sage-autonomy.js';
import { touchCircleWindow } from '../services/circle-window.js';
import { wakeTasksForReply } from '../services/sage-tasks.js';
import { recordSkippedCircleMention, traceSageReply } from '../services/sage-reply-trails.js';
import { notifySageComment } from '../services/sage-comment-notifications.js';
import {
  sendApplicationSubmittedNotification,
  sendCommonsSuggestionNotification,
} from '../services/slack-notification-service.js';
import { router } from '../trpc.js';

const postTagSchema = z.enum([
  'Intro',
  'Thought',
  'Ask',
  'Offer',
  'Event',
  'Project',
  'Proposal',
  'Product',
  'Update',
  'Decision',
  'Receipt',
  'Social',
  'Meme',
  'Win',
  'Need',
  'Idea',
  'Vote',
  'Resource',
  'Opportunity',
]);

const postMediaTypeSchema = z.enum(['image', 'video']);

const uploadedPostMediaSchema = z.object({
  pathname: z.string().min(1).max(1024),
  url: z.string().url(),
  mediaType: postMediaTypeSchema,
  mimeType: z.string().min(1).max(120),
  fileName: z.string().min(1).max(240).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationMs: z.number().int().positive().nullable().optional(),
  sizeBytes: z.number().int().positive().nullable().optional(),
});

type ApplicationQuestion = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
};

const getHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function isEmailQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return (
    question.type === 'email' ||
    id === 'email' ||
    id.includes('email') ||
    label.includes('email')
  );
}

function isPhoneQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return (
    question.type === 'phone' ||
    id === 'phone' ||
    id.includes('phone') ||
    label.includes('phone')
  );
}

function nameParts(name: string | null | undefined) {
  const trimmed = name?.trim() || 'Cahootz Member';
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName: firstName || 'Cahootz',
    lastName: rest.join(' ') || 'Member',
  };
}

async function decorateSupporterBadges(db: any, records: any[]) {
  const authorScopes = records.flatMap((post: any) => [
    { userId: post.authorId, coopId: post.coopId },
    ...(post.comments ?? []).map((comment: any) => ({
      userId: comment.authorId,
      coopId: post.coopId,
    })),
  ]);
  const authorIds = [...new Set(authorScopes.map((scope) => scope.userId))];
  const coopIds = [...new Set(authorScopes.map((scope) => scope.coopId))];
  const badges = authorIds.length
    ? await db.fundingBadgeEntitlement.findMany({
        where: {
          userId: { in: authorIds },
          coopId: { in: coopIds },
          status: 'ACTIVE',
        },
        select: { userId: true, coopId: true, tier: true },
      })
    : [];
  const badgeByMember = new Map<string, any>();
  for (const badge of badges) {
    const key = `${badge.userId}:${badge.coopId}`;
    const current = badgeByMember.get(key);
    const rank = FUNDING_BADGE_BY_TIER.get(badge.tier)?.rank ?? 0;
    const currentRank = current
      ? FUNDING_BADGE_BY_TIER.get(current.tier)?.rank ?? 0
      : 0;
    if (!current || rank > currentRank) badgeByMember.set(key, badge);
  }
  const decorate = (userId: string, coopId: string) => {
    const badge = badgeByMember.get(`${userId}:${coopId}`);
    if (!badge) return null;
    const definition = FUNDING_BADGE_BY_TIER.get(badge.tier)!;
    return {
      tier: badge.tier,
      name: definition.name,
      shortName: definition.shortName,
      color: definition.color,
    };
  };
  records.forEach((post: any) => {
    post.supporterBadge = decorate(post.authorId, post.coopId);
    post.comments?.forEach((comment: any) => {
      comment.supporterBadge = decorate(comment.authorId, post.coopId);
    });
  });
}

async function loadFeedPosts(
  db: any,
  coopId: string | string[],
  limit: number,
  cursor?: string,
  circleId?: string,
) {
  const coopIds = Array.isArray(coopId) ? coopId : [coopId];
  const posts = await db.commonsPost.findMany({
    where: circleId
      ? { coopId: coopIds[0], circleId }
      : {
          OR: coopIds.flatMap((id) => [
            { coopId: id, circleId: generalCircleId(id) },
            { coopId: id, circleId: null },
          ]),
        },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      author: { select: { name: true, email: true, handle: true, isBot: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        take: 2,
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
        },
      },
      media: {
        orderBy: { order: 'asc' },
      },
      event: {
        include: {
          hosts: {
            include: {
              user: { select: { id: true, name: true, email: true, handle: true } },
            },
          },
          rsvps: { select: { userId: true, status: true } },
        },
      },
      _count: { select: { comments: true, supports: true } },
    },
  });

  const hasMore = posts.length > limit;
  const page = hasMore ? posts.slice(0, limit) : posts;
  await decorateSupporterBadges(db, page);
  return { page, nextCursor: hasMore ? page[page.length - 1].id : null };
}

export function generalCircleId(coopId: string) {
  return `general:${coopId}`;
}

async function requireCircleAccess(
  db: any,
  userId: string,
  coopId: string,
  circleId: string,
) {
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: circleId, userId } },
    include: { group: { select: { coopId: true, name: true, privacy: true } } },
  });
  if (membership?.group.coopId === coopId) {
    return { ...membership.group, isMember: true };
  }
  const publicCircle = await db.group.findUnique({
    where: { id: circleId },
    select: { coopId: true, name: true, privacy: true },
  });
  if (!publicCircle || publicCircle.coopId !== coopId || publicCircle.privacy !== 'public') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Join this circle to view its conversation.',
    });
  }
  return { ...publicCircle, isMember: false };
}

export async function requireCircleMembership(
  db: any,
  userId: string,
  coopId: string,
  circleId: string,
) {
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: circleId, userId } },
    select: { group: { select: { coopId: true, kind: true } } },
  });
  if (membership?.group.coopId !== coopId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Join this circle to participate.',
    });
  }
  // Direct messages are private chats, never feed posts.
  if (membership.group.kind === DIRECT_KIND) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Send direct messages from Messages.',
    });
  }
}

async function requireCircleLeaderForPost(db: any, userId: string, postId: string) {
  const post = await db.commonsPost.findUnique({
    where: { id: postId },
    select: { id: true, coopId: true, circleId: true },
  });
  if (!post) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Post not found.' });
  }
  if (!post.circleId || post.circleId === generalCircleId(post.coopId)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Pinning is only available inside a circle.',
    });
  }
  const group = await db.group.findUnique({
    where: { id: post.circleId },
    select: { leaderId: true },
  });
  if (!group || group.leaderId !== userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the circle leader can pin posts.',
    });
  }
  return post as { id: string; coopId: string; circleId: string };
}

async function requirePostCircleMembership(
  db: any,
  userId: string,
  post: { coopId: string; circleId?: string | null },
) {
  const circleId = post.circleId;
  if (circleId && circleId !== generalCircleId(post.coopId)) {
    await requireCircleMembership(db, userId, post.coopId, circleId);
  }
}

async function canReadPostCircle(
  db: any,
  userId: string | undefined,
  post: { coopId: string; circleId?: string | null },
) {
  if (!post.circleId || post.circleId === generalCircleId(post.coopId))
    return true;
  if (userId) {
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: post.circleId, userId } },
      select: { group: { select: { coopId: true } } },
    });
    if (membership?.group.coopId === post.coopId) return true;
  }
  const circle = await db.group.findUnique({
    where: { id: post.circleId },
    select: { coopId: true, privacy: true },
  });
  return circle?.coopId === post.coopId && circle.privacy === 'public';
}

export function displayName(user: { name: string | null; email: string }) {
  return user.name || user.email.split('@')[0] || 'Commons member';
}

export function personHandle(user: {
  handle?: string | null;
  name: string | null;
  email: string;
}) {
  if (user.handle) return user.handle;
  // Fallback for authors who somehow don't have a persisted handle yet (should be rare —
  // ensureUserHandle assigns one at login and at post creation).
  return (
    displayName(user)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '') || 'member'
  );
}

function mapPersonalPagePost(record: any) {
  return {
    id: record.id,
    authorId: record.authorId,
    author: displayName(record.author),
    handle: personHandle(record.author),
    body: record.content,
    tag: record.tag || null,
    time: relativeTime(record.createdAt),
    createdAt: record.createdAt.toISOString(),
    replies: record._count?.comments ?? record.comments?.length ?? 0,
    support: record._count?.supports ?? 0,
    media: Array.isArray(record.media) ? record.media : [],
    comments:
      record.comments?.map((comment: any) => ({
        id: comment.id,
        authorId: comment.authorId,
        author: displayName(comment.author),
        authorHandle: personHandle(comment.author),
        authorIsAi: !!comment.author?.isBot,
        body: comment.content,
        createdAt: comment.createdAt.toISOString(),
      })) ?? [],
  };
}

/**
 * The commons a person's page lists, with the roles and funding badges they
 * hold in each. A public commons is always listed; a private commons is listed
 * only when the viewer is an active member of it too, so a page never reveals
 * a private commons (or what someone holds there) to an outsider.
 */
async function loadVisibleProfileCommons(
  db: any,
  profileUserId: string,
  viewerId: string | null,
) {
  const memberships = await db.userCoopMembership.findMany({
    where: { userId: profileUserId, status: 'ACTIVE' },
    select: { coopId: true, roles: true, joinedAt: true, createdAt: true },
  });
  if (memberships.length === 0) return [];

  const coopIds = memberships.map((membership: any) => membership.coopId);
  const [configs, viewerMemberships, badges] = await Promise.all([
    db.coopConfig.findMany({
      where: { coopId: { in: coopIds }, isActive: true },
      orderBy: { version: 'desc' },
      select: {
        coopId: true,
        name: true,
        slug: true,
        iconEmoji: true,
        iconColor: true,
        isPrivate: true,
        isDemo: true,
        displayOrder: true,
      },
    }),
    viewerId && viewerId !== profileUserId
      ? db.userCoopMembership.findMany({
          where: { userId: viewerId, coopId: { in: coopIds }, status: 'ACTIVE' },
          select: { coopId: true },
        })
      : [],
    db.fundingBadgeEntitlement.findMany({
      where: { userId: profileUserId, coopId: { in: coopIds }, status: 'ACTIVE' },
      select: { coopId: true, tier: true },
    }),
  ]);

  const configByCoop = new Map<string, any>();
  for (const config of configs) {
    if (!configByCoop.has(config.coopId)) configByCoop.set(config.coopId, config);
  }
  const viewerCoopIds = new Set<string>(
    viewerId === profileUserId
      ? coopIds
      : viewerMemberships.map((membership: any) => membership.coopId),
  );

  return memberships
    .map((membership: any) => {
      const config = configByCoop.get(membership.coopId);
      // Unconfigured coop ids aren't real commons, except the platform commons.
      if (!config && membership.coopId !== COMMONS_COOP_ID) return null;
      if (config?.isDemo) return null;
      const isPrivate = !!config?.isPrivate;
      if (isPrivate && !viewerCoopIds.has(membership.coopId)) return null;

      const summary = mapCoopSummaryRecord(config, membership.coopId);
      return {
        coopId: membership.coopId,
        name: summary.name,
        shortName: summary.shortName,
        iconEmoji: config?.iconEmoji ?? null,
        iconColor: config?.iconColor ?? null,
        isPrivate,
        roles: (membership.roles as string[]).filter((role) => role !== 'sage'),
        badges: badges
          .filter((badge: any) => badge.coopId === membership.coopId)
          .map((badge: any) => FUNDING_BADGE_BY_TIER.get(badge.tier))
          .filter(Boolean)
          .sort((a: any, b: any) => b.rank - a.rank)
          .map((definition: any) => ({
            tier: definition.tier,
            name: definition.name,
            shortName: definition.shortName,
            color: definition.color,
          })),
        displayOrder: config?.displayOrder ?? 0,
      };
    })
    .filter(Boolean)
    .sort(
      (a: any, b: any) =>
        a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    )
    .map(({ displayOrder: _displayOrder, ...commons }: any) => commons);
}

async function findUserByPersonalHandle(db: any, handle: string) {
  return db.user.findFirst({
    where: { handle, deletedAt: null },
    select: {
      id: true,
      email: true,
      handle: true,
      name: true,
      selfDescription: true,
      avatarUrl: true,
      avatarEmoji: true,
      avatarColor: true,
      createdAt: true,
    },
  });
}

function relativeTime(date: Date) {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - date.getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function titleFromContent(content: string) {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  const sentence = cleaned.split(/[.!?]/)[0] || cleaned;
  return sentence.slice(0, 84) || 'Community post';
}

function classifyPost(input: {
  title?: string;
  content: string;
  tag: z.infer<typeof postTagSchema>;
  mediaCount: number;
}) {
  const text = `${input.title || ''} ${input.content}`.toLowerCase();
  const hits: string[] = [];
  let classification = 'social';

  const match = (label: string, terms: string[]) => {
    const found = terms.some((term) => text.includes(term));
    if (found) hits.push(label);
    return found;
  };

  if (input.tag === 'Intro') {
    hits.push('intro');
  } else if (
    input.tag === 'Proposal' ||
    input.tag === 'Vote' ||
    match('proposal', ['proposal', 'vote', 'decide', 'approve', 'policy'])
  ) {
    classification = 'proposal_seed';
  } else if (
    input.tag === 'Event' ||
    match('event', [
      'event',
      'meetup',
      'meeting',
      'pull up',
      'rsvp',
      'tomorrow',
      'tonight',
    ])
  ) {
    classification = 'event';
  } else if (
    input.tag === 'Ask' ||
    input.tag === 'Need' ||
    match('need', [
      'need',
      'looking for',
      'help with',
      'does anyone have',
      'who can',
    ])
  ) {
    classification = 'need';
  } else if (
    input.tag === 'Resource' ||
    input.tag === 'Receipt' ||
    match('resource', [
      'resource',
      'template',
      'guide',
      'link',
      'toolkit',
      'receipt',
    ])
  ) {
    classification = 'resource';
  } else if (
    input.tag === 'Offer' ||
    input.tag === 'Product' ||
    input.tag === 'Opportunity' ||
    match('market', [
      'job',
      'gig',
      'hiring',
      'selling',
      'available',
      'vendor',
      'client',
    ])
  ) {
    classification = 'market';
  } else if (input.tag === 'Project') {
    classification = 'project';
  } else if (input.tag === 'Decision') {
    classification = 'decision';
  } else if (input.tag === 'Update') {
    classification = 'update';
  } else if (
    match('support', [
      'support',
      'congratulations',
      'proud',
      'show love',
      'celebrate',
    ])
  ) {
    classification = 'support';
  } else if (input.tag === 'Win') {
    classification = 'win';
  } else if (input.tag === 'Meme') {
    classification = 'social';
    hits.push('meme');
  }

  return {
    classification,
    classificationConfidence: Math.min(
      0.95,
      0.55 + hits.length * 0.12 + (input.mediaCount > 0 ? 0.05 : 0),
    ),
    classificationSignals: toJsonValue({
      version: 1,
      source: 'keyword_rule',
      matchedSignals: hits,
      tag: input.tag,
      mediaCount: input.mediaCount,
    }),
  };
}

// Runs the same shared Community Observer agent used by the circle digest
// (groups.ts getAiDigest) against this post, and writes the result to AI
// Working Memory (Layer 4) alongside the keyword classifier's real-time
// classifyPost() result above. This is a deliberate dual-write, not a
// cutover: classifyPost() stays the source of truth for CommonsPost.classification
// (fast, synchronous, no external dependency), while this LLM pass populates
// AIObservation for comparison/consumption by other agents. Mirrors the
// existing "AI failure never blocks the write" convention used for proposal
// comment evaluation (routers/proposal-comment.ts) - a failure here is
// logged and swallowed, never thrown.
async function recordPostClassificationObservation(params: {
  coopId: string;
  postId: string;
  title?: string;
  content: string;
  tag: string;
}) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const agent = getAgent('community-observer');
    if (!agent) return;

    const output = await agent.run({
      coopId: params.coopId,
      task: 'Classify this single community post into exactly one of the allowed types.',
      content: [
        params.title ? `Title: ${params.title}` : '',
        `Content: ${params.content}`,
        `User-selected tag: ${params.tag}`,
      ]
        .filter(Boolean)
        .join('\n'),
      allowedTypes: [...COMMUNITY_OBSERVER_POST_TYPES],
    });

    await recordObservation({
      type: 'post_classification',
      scopeType: 'commons',
      scopeId: params.coopId,
      confidence: output.confidence,
      summary: output.summary,
      details: { classification: output.type },
      sources: [{ type: 'commons_post', id: params.postId }],
      visibility: 'COMMONS_MEMBERS',
      generatedByAgentKey: 'community-observer',
    });
  } catch (err) {
    console.error('Failed to record post_classification AIObservation:', err);
  }
}

export function mapEventSummary(record: any, viewerId?: string) {
  const rsvps: { userId: string; status: string }[] = record.rsvps ?? [];
  const countByStatus = (status: string) =>
    rsvps.filter((rsvp) => rsvp.status === status).length;
  const viewerRsvp = viewerId
    ? rsvps.find((rsvp) => rsvp.userId === viewerId)
    : undefined;

  return {
    id: record.id,
    postId: record.postId,
    coopId: record.coopId,
    circleId: record.circleId,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    isOnline: record.isOnline,
    location: record.location ?? null,
    meetingUrl: record.meetingUrl ?? null,
    allowComments: record.allowComments,
    seriesId: record.seriesId ?? null,
    recurrenceFreq: (record.recurrenceFreq as 'DAILY' | 'WEEKLY' | 'MONTHLY' | null) ?? null,
    recurrenceInterval: record.recurrenceInterval ?? 1,
    recurrenceCount: record.recurrenceCount ?? null,
    hosts:
      record.hosts?.map((host: any) => ({
        id: host.user.id,
        name: displayName(host.user),
        handle: personHandle(host.user),
      })) ?? [],
    goingCount: countByStatus('GOING'),
    maybeCount: countByStatus('MAYBE'),
    cantGoCount: countByStatus('CANT_GO'),
    viewerRsvpStatus: (viewerRsvp?.status as 'GOING' | 'MAYBE' | 'CANT_GO' | undefined) ?? null,
  };
}

function mapPostWithGroup(record: any, groupName: string, viewerId?: string) {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    coopId: record.coopId,
    circleId: record.circleId || generalCircleId(record.coopId),
    authorId: record.authorId,
    author: displayName(record.author),
    authorHandle: personHandle(record.author),
    authorIsAi: !!record.author?.isBot,
    supporterBadge: record.supporterBadge ?? null,
    group: groupName,
    time: relativeTime(record.createdAt),
    title: record.title,
    body: record.content,
    tag: record.tag,
    classification: record.classification ?? 'social',
    replies: record._count?.comments ?? record.comments?.length ?? 0,
    support: record._count?.supports ?? record.supports?.length ?? 0,
    pledges: undefined as string | undefined,
    isPinned: record.isPinned ?? false,
    event: record.event ? mapEventSummary(record.event, viewerId) : undefined,
    media:
      record.media?.map((item: any) => ({
        id: item.id,
        pathname: item.pathname,
        url: item.url,
        mediaType: item.mediaType,
        mimeType: item.mimeType,
        fileName: item.fileName,
        width: item.width,
        height: item.height,
        durationMs: item.durationMs,
        sizeBytes: item.sizeBytes,
      })) ?? [],
    comments:
      record.comments?.map((comment: any) => ({
        id: comment.id,
        authorId: comment.authorId,
        author: displayName(comment.author),
        authorHandle: personHandle(comment.author),
        authorIsAi: !!comment.author?.isBot,
        reactionCount: comment._count?.reactions ?? 0,
        viewerReacted: (comment.reactions?.length ?? 0) > 0,
        supporterBadge: comment.supporterBadge ?? null,
        body: comment.content,
        media:
          comment.media?.map((item: any) => ({
            id: item.id,
            pathname: item.pathname,
            url: item.url,
            mediaType: item.mediaType,
            mimeType: item.mimeType,
            fileName: item.fileName,
            width: item.width,
            height: item.height,
            durationMs: item.durationMs,
            sizeBytes: item.sizeBytes,
          })) ?? [],
      })) ?? [],
  };
}

function mapCoopSummaryRecord(coopConfig: any, coopId: string) {
  const name =
    coopConfig?.name?.trim() ||
    (coopId === COMMONS_COOP_ID ? 'Cahootz Commons' : coopId);
  const description =
    coopConfig?.description?.trim() ||
    coopConfig?.tagline?.trim() ||
    coopConfig?.displayMission?.trim() ||
    'A social commons for conversation, resources, and coordinated action.';

  return {
    id: coopId,
    name,
    shortName: coopConfig?.slug?.trim() || name,
    description,
  };
}

async function loadCoopSummary(db: any, coopId: string) {
  const coopConfig = await db.coopConfig.findFirst({
    where: { coopId, isActive: true },
    orderBy: { version: 'desc' },
    select: {
      coopId: true,
      name: true,
      slug: true,
      description: true,
      tagline: true,
      displayMission: true,
    },
  });

  return mapCoopSummaryRecord(coopConfig, coopId);
}

export async function resolveOptionalAccountUser(context: Context) {
  const token = getHeaderValue(context.req.headers['x-session-token']);
  if (!token) return null;

  const session = await context.db.session.findUnique({
    where: { token },
  });

  if (!session || session.isRevoked || session.expiresAt <= new Date()) {
    return null;
  }

  const user = await context.db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      deletedAt: true,
    },
  });

  return user && !user.deletedAt ? user : null;
}

async function hasActiveCommonsMembership(
  db: any,
  userId: string,
  coopId: string,
) {
  const membership = await db.userCoopMembership.findUnique({
    where: {
      userId_coopId: {
        userId,
        coopId,
      },
    },
    select: { status: true },
  });

  return membership?.status === 'ACTIVE';
}

export async function requireActiveCommonsMembership(
  db: any,
  userId: string,
  coopId: string,
) {
  if (coopId === COMMONS_COOP_ID) {
    await ensureCommonsMembership(db, userId);
    return;
  }

  const isMember = await hasActiveCommonsMembership(db, userId, coopId);
  if (!isMember) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Join this commons before posting here.',
    });
  }
}

/** Groups AICostEvent.feature keys into member-readable spending categories. */
export function aiSpendCategory(feature: string) {
  if (feature.startsWith('proposal-')) return 'Proposal reviews';
  if (feature.startsWith('newsletter-')) return 'Newsletter';
  if (feature.startsWith('knowledge-')) return 'Knowledge base';
  if (feature === 'commons-assistant' || feature === 'commons-recommender') {
    return 'Assistant';
  }
  if (
    feature.startsWith('sage-') ||
    feature === 'commons-action-agent' ||
    feature === 'community-observer'
  ) {
    return 'Sage';
  }
  return 'Other';
}

function fallbackAiResponse(prompt: string) {
  const lower = prompt.toLowerCase();

  if (lower.includes('vote')) {
    return [
      'Start with the decision: what exactly should members choose?',
      'Then define options, deadline, eligible voters, budget impact, and who reports back.',
    ].join('\n');
  }

  if (
    lower.includes('cost') ||
    lower.includes('fund') ||
    lower.includes('money') ||
    lower.includes('$')
  ) {
    return [
      'Break this into money, time, space, tools, and people.',
      'A good next step is a small pledge list before turning it into a proposal.',
    ].join('\n');
  }

  if (
    lower.includes('proposal') ||
    lower.includes('plan') ||
    lower.includes('help')
  ) {
    return [
      'This can become a Commons thread first.',
      'Ask people to name the need, who is affected, what help exists, and the smallest useful pilot.',
    ].join('\n');
  }

  return [
    'I can help you turn this into action.',
    'Try framing it as: need, people affected, helpers, resources, decision needed, and first step.',
  ].join('\n');
}

async function runCommonsAi(prompt: string, coopId?: string) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackAiResponse(prompt);
  }

  try {
    const agent = new Agent({
      name: 'Cahootz Commons Assistant',
      model: process.env.COMMONS_AI_MODEL || 'gpt-5.2',
      instructions: [
        'You are the general AI assistant inside Cahootz Commons, a community social network for coordinating help, proposals, votes, and shared resources.',
        'Answer in plain language and move conversation toward practical community action.',
        'When useful, organize answers into need, helpers, resources, decision, and next step.',
        'Do not pretend an anonymous visitor is a logged-in member.',
      ].join('\n'),
    });
    const runResult = await run(agent, prompt);
    await recordAgentResultCost({ coopId, feature: 'commons-assistant', model: process.env.COMMONS_AI_MODEL || 'gpt-5.2', result: runResult }).catch(console.error);
    const result = runResult as unknown as {
      finalOutput?: string;
      output?: string;
    };

    return result.finalOutput || result.output || fallbackAiResponse(prompt);
  } catch (error) {
    console.error('Commons AI failed:', error);
    return fallbackAiResponse(prompt);
  }
}

export const commonsRouter = router({
  listFeed: publicProcedure
    .input(
      z
        .object({
          coopId: z.string().min(1).default(COMMONS_COOP_ID),
          circleId: z.string().min(1).optional(),
          limit: z.number().min(1).max(50).default(20),
          cursor: z.string().optional(),
        })
        .default({ coopId: COMMONS_COOP_ID, limit: 20 }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      if (input.coopId === 'all') {
        if (input.circleId)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Choose a commons for this circle.',
          });
        const accountUser = await resolveOptionalAccountUser(context);
        const coopIds = new Set<string>([COMMONS_COOP_ID]);

        if (accountUser) {
          const memberships = await context.db.userCoopMembership.findMany({
            where: {
              userId: accountUser.id,
              status: 'ACTIVE',
            },
            select: { coopId: true },
          });
          memberships.forEach((membership: any) =>
            coopIds.add(membership.coopId),
          );
        }

        const activeCoopIds = [...coopIds];
        const { page, nextCursor } = await loadFeedPosts(
          ctx.db,
          activeCoopIds,
          input.limit,
          input.cursor,
        );

        const coopConfigs = await context.db.coopConfig.findMany({
          where: {
            coopId: { in: activeCoopIds },
            isActive: true,
          },
          select: {
            coopId: true,
            name: true,
            slug: true,
            description: true,
            tagline: true,
            displayMission: true,
          },
        });
        const coopNameById = new Map(
          coopConfigs.map((coopConfig: any) => [
            coopConfig.coopId,
            mapCoopSummaryRecord(coopConfig, coopConfig.coopId).name,
          ]),
        );

        return {
          coop: {
            id: 'all',
            name: 'Home',
            shortName: 'Home',
            description: 'Posts from every commons you are approved to access.',
          },
          posts: page.map((post: any) =>
            mapPostWithGroup(
              post,
              coopNameById.get(post.coopId) || post.coopId,
              accountUser?.id,
            ),
          ),
          pinnedPost: null,
          upcomingEvents: [],
          nextCursor,
        };
      }

      const coop = await loadCoopSummary(ctx.db, input.coopId);
      const accountUser = await resolveOptionalAccountUser(context);
      const requestedCircleId =
        input.circleId && input.circleId !== generalCircleId(input.coopId)
          ? input.circleId
          : undefined;
      const circle =
        requestedCircleId && accountUser
          ? await requireCircleAccess(
              context.db,
              accountUser.id,
              input.coopId,
              requestedCircleId,
            )
          : null;
      if (requestedCircleId && !circle) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Join this circle to view its conversation.',
        });
      }
      const canRead =
        input.coopId === COMMONS_COOP_ID ||
        (!!accountUser &&
          (await hasActiveCommonsMembership(
            context.db,
            accountUser.id,
            input.coopId,
          )));

      if (!canRead) {
        return { coop, posts: [], nextCursor: null };
      }

      const { page, nextCursor } = await loadFeedPosts(
        ctx.db,
        input.coopId,
        input.limit,
        input.cursor,
        requestedCircleId,
      );

      const feedCircleWhere = requestedCircleId
        ? { coopId: input.coopId, circleId: requestedCircleId }
        : {
            OR: [
              { coopId: input.coopId, circleId: generalCircleId(input.coopId) },
              { coopId: input.coopId, circleId: null },
            ],
          };

      const eventInclude = {
        hosts: {
          include: {
            user: { select: { id: true, name: true, email: true, handle: true } },
          },
        },
        rsvps: { select: { userId: true, status: true } },
      };

      const [pinnedPostRecord, upcomingEventRecords] = await Promise.all([
        ctx.db.commonsPost.findFirst({
          where: { ...feedCircleWhere, isPinned: true },
          include: {
            author: { select: { name: true, email: true, handle: true, isBot: true } },
            comments: {
              orderBy: { createdAt: 'asc' },
              take: 2,
              include: { author: { select: { name: true, email: true, handle: true, isBot: true } } },
            },
            media: { orderBy: { order: 'asc' } },
            event: { include: eventInclude },
            _count: { select: { comments: true, supports: true } },
          },
        }),
        ctx.db.event.findMany({
          where: { ...feedCircleWhere, startAt: { gte: new Date() } },
          orderBy: { startAt: 'asc' },
          take: 2,
          include: {
            ...eventInclude,
            post: { select: { id: true, title: true, content: true } },
          },
        }),
      ]);

      const pinnedPost = pinnedPostRecord
        ? mapPostWithGroup(pinnedPostRecord, circle?.name || coop.name, accountUser?.id)
        : null;
      const posts = page
        .filter((post: any) => post.id !== pinnedPostRecord?.id)
        .map((post: any) =>
          mapPostWithGroup(post, circle?.name || coop.name, accountUser?.id),
        );
      const upcomingEvents = upcomingEventRecords.map((event: any) => ({
        ...mapEventSummary(event, accountUser?.id),
        title: event.post.title,
      }));

      return {
        coop,
        circleName: circle?.name || null,
        circleIsMember: circle?.isMember ?? null,
        posts,
        pinnedPost,
        upcomingEvents,
        nextCursor,
      };
    }),

  // Every photo and video posted in one circle, newest first, for the
  // circle's gallery. Readable by exactly the people who can read the feed.
  listCircleMedia: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
        circleId: z.string().min(1),
        limit: z.number().min(1).max(60).default(30),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      if (input.circleId === generalCircleId(input.coopId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Galleries are only available inside a circle.',
        });
      }
      const accountUser = await resolveOptionalAccountUser(context);
      if (!accountUser) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Join this circle to view its conversation.',
        });
      }
      const circle = await requireCircleAccess(
        context.db,
        accountUser.id,
        input.coopId,
        input.circleId,
      );
      const canRead =
        input.coopId === COMMONS_COOP_ID ||
        (await hasActiveCommonsMembership(context.db, accountUser.id, input.coopId));
      if (!canRead) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Join this commons to view its circles.',
        });
      }

      const records = await context.db.commonsPostMedia.findMany({
        where: { post: { coopId: input.coopId, circleId: input.circleId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          post: {
            select: {
              id: true,
              title: true,
              createdAt: true,
              author: { select: { name: true, email: true, handle: true } },
            },
          },
        },
      });

      const hasMore = records.length > input.limit;
      const page = hasMore ? records.slice(0, input.limit) : records;
      return {
        circleName: circle.name as string,
        items: page.map((item: any) => ({
          id: item.id,
          pathname: item.pathname,
          url: item.url,
          mediaType: item.mediaType as 'image' | 'video',
          mimeType: item.mimeType,
          fileName: item.fileName,
          width: item.width,
          height: item.height,
          durationMs: item.durationMs,
          sizeBytes: item.sizeBytes,
          createdAt: item.createdAt.toISOString(),
          postId: item.post.id,
          postTitle: item.post.title,
          author: displayName(item.post.author),
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      };
    }),

  search: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
        query: z.string().trim().min(1).max(80),
        limit: z.number().min(1).max(30).default(10),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const coop = await loadCoopSummary(ctx.db, input.coopId);
      const accountUser = await resolveOptionalAccountUser(context);
      const canReadPosts =
        input.coopId === COMMONS_COOP_ID ||
        (!!accountUser &&
          (await hasActiveCommonsMembership(
            context.db,
            accountUser.id,
            input.coopId,
          )));

      const [people, posts] = await Promise.all([
        context.db.user.findMany({
          where: {
            deletedAt: null,
            OR: [
              { name: { contains: input.query, mode: 'insensitive' } },
              { handle: { contains: input.query, mode: 'insensitive' } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          select: { id: true, name: true, email: true, handle: true },
        }),
        canReadPosts
          ? context.db.commonsPost.findMany({
              where: {
                coopId: input.coopId,
                AND: [
                  {
                    OR: [
                      { circleId: generalCircleId(input.coopId) },
                      { circleId: null },
                    ],
                  },
                  {
                    OR: [
                      { title: { contains: input.query, mode: 'insensitive' } },
                      {
                        content: { contains: input.query, mode: 'insensitive' },
                      },
                    ],
                  },
                ],
              },
              orderBy: { createdAt: 'desc' },
              take: input.limit,
              include: {
                author: { select: { name: true, email: true, handle: true, isBot: true } },
                comments: {
                  orderBy: { createdAt: 'asc' },
                  take: 2,
                  include: {
                    author: {
                      select: { name: true, email: true, handle: true, isBot: true },
                    },
                  },
                },
                media: { orderBy: { order: 'asc' } },
                _count: { select: { comments: true, supports: true } },
              },
            })
          : [],
      ]);

      return {
        people: people.map((user: any) => ({
          id: user.id,
          name: displayName(user),
          handle: personHandle(user),
        })),
        posts: posts.map((post: any) => mapPostWithGroup(post, coop.name)),
      };
    }),

  listDirectory: publicProcedure.query(async ({ ctx }) => {
    const context = ctx as Context;
    const accountUser = await resolveOptionalAccountUser(context);
    const coops = await context.db.coopConfig.findMany({
      where: {
        isActive: true,
        isDemo: false,
        name: { not: null },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: {
        coopId: true,
        name: true,
        slug: true,
        tagline: true,
        description: true,
        displayMission: true,
        eligibility: true,
        iconEmoji: true,
        iconColor: true,
        isPrivate: true,
        joinPolicy: true,
      },
    });
    const coopIds = coops.map((coop: any) => coop.coopId);
    const [memberships, applications, circleMemberships] = accountUser
      ? await Promise.all([
          context.db.userCoopMembership.findMany({
            where: {
              userId: accountUser.id,
              coopId: { in: coopIds },
            },
            select: {
              coopId: true,
              status: true,
              roles: true,
            },
          }),
          context.db.application.findMany({
            where: {
              userId: accountUser.id,
              coopId: { in: coopIds },
            },
            select: {
              id: true,
              coopId: true,
              status: true,
              requestType: true,
              createdAt: true,
              reviewedAt: true,
            },
          }),
          // Just "circles I'm in" per commons, not a total across every
          // member - circles are private/invite-only, so a raw total would
          // surface the existence of spaces this user isn't part of.
          context.db.groupMember.findMany({
            where: {
              userId: accountUser.id,
              group: { coopId: { in: coopIds }, kind: { not: DIRECT_KIND } },
            },
            select: { group: { select: { coopId: true } } },
          }),
        ])
      : [[], [], []];

    const membershipByCoop = new Map(
      memberships.map((membership: any) => [membership.coopId, membership]),
    );
    const applicationByCoop = new Map(
      applications.map((application: any) => [application.coopId, application]),
    );
    const circleCountByCoop = new Map<string, number>();
    for (const { group } of circleMemberships as {
      group: { coopId: string };
    }[]) {
      circleCountByCoop.set(
        group.coopId,
        (circleCountByCoop.get(group.coopId) || 0) + 1,
      );
    }

    // Private and invite-only commons are never discoverable: they're listed
    // only for people already in them or with a request pending.
    const visibleCoops = coops.filter((coop: any) => {
      const isHidden =
        coop.coopId !== COMMONS_COOP_ID &&
        (coop.isPrivate || coop.joinPolicy === 'INVITE_ONLY');
      if (!isHidden) return true;
      const membershipStatus = (membershipByCoop.get(coop.coopId) as any)?.status;
      const applicationStatus = (applicationByCoop.get(coop.coopId) as any)?.status;
      return (
        membershipStatus === 'ACTIVE' ||
        membershipStatus === 'PENDING' ||
        applicationStatus === 'SUBMITTED' ||
        applicationStatus === 'UNDER_REVIEW'
      );
    });

    const sortedCoops = [...visibleCoops].sort((a: any, b: any) => {
      if (a.coopId === COMMONS_COOP_ID) return -1;
      if (b.coopId === COMMONS_COOP_ID) return 1;
      return 0;
    });

    return {
      coops: sortedCoops.map((coop: any) => {
        const membership = membershipByCoop.get(coop.coopId);
        const application = applicationByCoop.get(coop.coopId);
        const membershipStatus = membership?.status as string | undefined;
        const applicationStatus = application?.status as string | undefined;
        const joinPolicy = (
          coop.coopId === COMMONS_COOP_ID
            ? 'AUTOMATIC'
            : coop.joinPolicy || 'APPLICATION_REQUIRED'
        ) as 'AUTOMATIC' | 'APPLICATION_REQUIRED' | 'INVITE_ONLY';
        const accessStatus =
          membershipStatus === 'ACTIVE'
            ? 'ACTIVE'
            : applicationStatus === 'SUBMITTED' ||
                applicationStatus === 'UNDER_REVIEW' ||
                (membershipStatus === 'PENDING' && applicationStatus !== 'WITHDRAWN')
              ? 'PENDING'
              : membershipStatus === 'REJECTED' ||
                  applicationStatus === 'REJECTED'
                ? 'REJECTED'
                : 'LOCKED';

        return {
          id: coop.coopId,
          name: coop.name,
          shortName: coop.slug || coop.name,
          tagline: coop.tagline,
          description:
            coop.description ||
            coop.displayMission ||
            'A commons for shared conversation, resources, and coordinated action.',
          mission: coop.displayMission,
          eligibility: coop.eligibility,
          iconEmoji: coop.iconEmoji || null,
          iconColor: coop.iconColor || null,
          accessStatus,
          joinPolicy,
          isPrivate: !!coop.isPrivate || joinPolicy === 'INVITE_ONLY',
          isMember: accessStatus === 'ACTIVE',
          isSteward:
            membership?.status === 'ACTIVE' &&
            ((membership?.roles as string[] | undefined) || []).some((role) =>
              STEWARD_ROLES.includes(role),
            ),
          isLocked: accessStatus !== 'ACTIVE',
          // Invite-only commons are joined through an invitation, never applied to.
          canApply: accessStatus === 'LOCKED' && joinPolicy === 'APPLICATION_REQUIRED',
          applicationId: application?.id || null,
          applicationStatus: applicationStatus || null,
          requestType: (application as any)?.requestType || null,
          circleCount: circleCountByCoop.get(coop.coopId) || 0,
        };
      }),
    };
  }),

  /**
   * Real, live-computed stats for the commons info page's "This month" row.
   * Requires active membership - these counts are member-only detail.
   */
  getActivityStats: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      await requireActiveCommonsMembership(
        context.db,
        context.accountUser.id,
        input.coopId,
      );

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [activeMembers, discussionsThisMonth, openVotes] =
        await Promise.all([
          context.db.userCoopMembership.count({
            where: { coopId: input.coopId, status: 'ACTIVE' },
          }),
          context.db.groupComment.count({
            where: {
              createdAt: { gte: monthStart },
              group: { coopId: input.coopId, kind: { not: DIRECT_KIND } },
            },
          }),
          context.db.proposal.count({
            where: { coopId: input.coopId, status: 'VOTABLE' },
          }),
        ]);

      return { activeMembers, discussionsThisMonth, openVotes };
    }),

  /**
   * Estimated AI spend for the commons info page, so members can see what
   * the tools working on their behalf cost. Totals come from AICostEvent;
   * calls on models without a known price are counted but not priced.
   */
  getAISpending: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      await requireActiveCommonsMembership(
        context.db,
        context.accountUser.id,
        input.coopId,
      );

      const now = new Date();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const lastMonthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );

      const [thisMonthByFeature, lastMonth, sageAutonomy] = await Promise.all([
        context.db.aICostEvent.groupBy({
          by: ['feature'],
          where: { coopId: input.coopId, createdAt: { gte: monthStart } },
          _sum: { costUsd: true },
          _count: { _all: true, costUsd: true },
        }),
        context.db.aICostEvent.aggregate({
          where: {
            coopId: input.coopId,
            createdAt: { gte: lastMonthStart, lt: monthStart },
          },
          _sum: { costUsd: true },
        }),
        getSageAutonomyUsage(input.coopId, context.db, now),
      ]);

      const byCategory = new Map<
        string,
        { category: string; estimatedUsd: number; calls: number }
      >();
      let thisMonthUsd = 0;
      let callsThisMonth = 0;
      let unpricedCallsThisMonth = 0;
      for (const row of thisMonthByFeature) {
        const estimatedUsd = Number(row._sum.costUsd ?? 0);
        const category = aiSpendCategory(row.feature);
        const entry = byCategory.get(category) ?? {
          category,
          estimatedUsd: 0,
          calls: 0,
        };
        entry.estimatedUsd += estimatedUsd;
        entry.calls += row._count._all;
        byCategory.set(category, entry);
        thisMonthUsd += estimatedUsd;
        callsThisMonth += row._count._all;
        unpricedCallsThisMonth += row._count._all - row._count.costUsd;
      }

      return {
        thisMonthUsd,
        lastMonthUsd: Number(lastMonth._sum.costUsd ?? 0),
        callsThisMonth,
        unpricedCallsThisMonth,
        byCategory: [...byCategory.values()].sort(
          (a, b) => b.estimatedUsd - a.estimatedUsd || b.calls - a.calls,
        ),
        sageAutonomy,
      };
    }),

  /** A preview slice of active members for the info page's People row. */
  listMembers: accountAuthenticatedProcedure
    .input(z.object({ coopId: z.string().min(1), limit: z.number().min(1).max(50).default(8) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      await requireActiveCommonsMembership(
        context.db,
        context.accountUser.id,
        input.coopId,
      );

      const [memberships, totalCount] = await Promise.all([
        context.db.userCoopMembership.findMany({
          where: { coopId: input.coopId, status: 'ACTIVE' },
          orderBy: { joinedAt: 'desc' },
          take: input.limit,
          select: { user: { select: { id: true, name: true, email: true, handle: true } } },
        }),
        context.db.userCoopMembership.count({
          where: { coopId: input.coopId, status: 'ACTIVE' },
        }),
      ]);

      return {
        totalCount,
        members: memberships.map(({ user }: any) => ({
          id: user.id,
          name: displayName(user),
          handle: personHandle(user),
        })),
      };
    }),

  applyToCommons: accountAuthenticatedProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        displayName: z.string().trim().max(160).optional(),
        phone: z.string().trim().max(40).optional(),
        dynamicAnswers: z.record(z.unknown()).default({}),
        // The invitation that referred them. It's recorded as a referral
        // only: the application still needs a steward's review.
        invitationId: z.string().min(1).max(64).optional(),
        invitationToken: z.string().trim().min(20).max(128).optional(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
        applicationId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const user = context.accountUser;

      const coopConfig = await context.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        select: {
          name: true,
          applicationQuestions: true,
        },
      });

      const policy = await getCommonsPolicy(context.db, input.coopId);
      if (!coopConfig || !policy) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Commons not found.',
        });
      }

      if (policy.joinPolicy === 'INVITE_ONLY') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'This commons is invite-only. Ask a member for an invitation.',
        });
      }

      // Applying must never demote an existing member back to PENDING.
      if (await hasActiveCommonsMembership(context.db, user.id, input.coopId)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: "You're already a member of this commons.",
        });
      }

      const existingApplication = await context.db.application.findUnique({
        where: {
          userId_coopId: {
            userId: user.id,
            coopId: input.coopId,
          },
        },
        select: { id: true, status: true },
      });

      // A withdrawn application can be sent again; anything else is final
      // until a steward acts on it.
      if (existingApplication && existingApplication.status !== 'WITHDRAWN') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'You have already applied to this commons.',
        });
      }

      const referral = await resolveApplyReferral(context.db, {
        coopId: input.coopId,
        user,
        invitationId: input.invitationId,
        token: input.invitationToken,
      }).catch(() => null);

      const questions = (
        (coopConfig.applicationQuestions as ApplicationQuestion[] | null) || []
      ).filter((question) => !isEmailQuestion(question));
      const missingQuestions = questions
        .filter((question) => question.required)
        .filter((question) => {
          const answer = input.dynamicAnswers[question.id];
          return !answer || (Array.isArray(answer) && answer.length === 0);
        });

      if (missingQuestions.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Please answer: ${missingQuestions.map((question) => question.label).join(', ')}`,
        });
      }

      const phoneAnswer = questions.find(isPhoneQuestion)?.id;
      const phoneFromAnswer = phoneAnswer
        ? String(input.dynamicAnswers[phoneAnswer] || '')
        : '';
      const normalizedPhone = toE164(
        input.phone || phoneFromAnswer || user.phone,
      );

      if (!normalizedPhone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A phone number is required to apply.',
        });
      }

      const applicantName = input.displayName || user.name;
      const { firstName, lastName } = nameParts(applicantName);

      const application = await context.db.$transaction(async (tx) => {
        if (!user.phone) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              phone: normalizedPhone,
              name: user.name || `${firstName} ${lastName}`,
            },
          });
        }

        const applicationFields = {
          status: 'SUBMITTED' as const,
          requestType: 'APPLICATION',
          invitationId: referral?.invitationId ?? null,
          referredByUserId: referral?.referredByUserId ?? null,
          data: toJsonValue({
            firstName,
            lastName,
            email: user.email,
            phone: normalizedPhone,
            dynamicAnswers: input.dynamicAnswers,
          }),
        };
        const createdApplication = existingApplication
          ? await tx.application.update({
              where: { id: existingApplication.id },
              data: {
                ...applicationFields,
                reviewedBy: null,
                reviewedByUserId: null,
                reviewedAt: null,
                reviewNotes: null,
                withdrawnAt: null,
              },
            })
          : await tx.application.create({
              data: {
                ...applicationFields,
                userId: user.id,
                coopId: input.coopId,
              },
            });

        if (referral) {
          // The referral has done its job; it never admits anyone.
          await tx.commonsInvitation.updateMany({
            where: { id: referral.invitationId, status: 'PENDING' },
            data: {
              status: 'ACCEPTED',
              acceptedByUserId: user.id,
              acceptedAt: new Date(),
            },
          });
        }
        await tx.auditLog.create({
          data: auditLogEntry({
            actorId: user.id,
            action: 'COMMONS_APPLICATION_SUBMITTED',
            resource: 'Application',
            resourceId: createdApplication.id,
            metadata: {
              coopId: input.coopId,
              invitationId: referral?.invitationId ?? null,
              referredByUserId: referral?.referredByUserId ?? null,
            },
          }),
        });

        await ensureCommonsMembership(tx, user.id);

        await tx.userCoopMembership.upsert({
          where: {
            userId_coopId: {
              userId: user.id,
              coopId: input.coopId,
            },
          },
          create: {
            userId: user.id,
            coopId: input.coopId,
            status: input.coopId === COMMONS_COOP_ID ? 'ACTIVE' : 'PENDING',
            roles: ['member'],
            joinedAt: input.coopId === COMMONS_COOP_ID ? new Date() : undefined,
          },
          update: {
            status: input.coopId === COMMONS_COOP_ID ? 'ACTIVE' : 'PENDING',
          },
        });

        return createdApplication;
      });

      void sendApplicationSubmittedNotification({
        coopId: input.coopId,
        coopName: coopConfig.name ?? undefined,
        applicantEmail: user.email,
        applicantName: `${firstName} ${lastName}`,
        applicationId: application.id,
      }).catch((err) => {
        console.error('Failed to send Slack notification:', err);
      });

      return {
        success: true,
        message: 'Application submitted successfully.',
        applicationId: application.id,
      };
    }),

  suggestCommons: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
        name: z.string().trim().min(2).max(120),
        reason: z.string().trim().max(2000).optional(),
        email: z.string().trim().email(),
        suggestedByName: z.string().trim().max(120).optional(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        suggestionId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const accountUser = await resolveOptionalAccountUser(context);
      const suggestedByEmail = accountUser?.email || input.email.toLowerCase();
      const suggestedByName =
        accountUser?.name || input.suggestedByName || null;

      const suggestion = await context.db.commonsSuggestion.create({
        data: {
          coopId: input.coopId,
          name: input.name,
          reason: input.reason || null,
          suggestedByEmail,
          suggestedByName,
          userId: accountUser?.id || null,
        },
      });

      await sendCommonsSuggestionNotification({
        suggestionId: suggestion.id,
        coopId: suggestion.coopId,
        commonsName: suggestion.name,
        reason: suggestion.reason,
        suggestedByEmail: suggestion.suggestedByEmail,
        suggestedByName: suggestion.suggestedByName,
      });

      return { success: true, suggestionId: suggestion.id };
    }),

  listComments: publicProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const post = await context.db.commonsPost.findUnique({
        where: { id: input.postId },
        select: { coopId: true, circleId: true },
      });
      if (!post)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Post not found.' });
      const accountUser = await resolveOptionalAccountUser(context);
      if (
        !(await canReadPostCircle(context.db, accountUser?.id, post)) ||
        (post.coopId !== COMMONS_COOP_ID &&
          (!accountUser ||
            !(await hasActiveCommonsMembership(
              context.db,
              accountUser.id,
              post.coopId,
            ))))
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot view this conversation.',
        });
      }
      const comments = await ctx.db.commonsComment.findMany({
        where: { postId: input.postId },
        orderBy: { createdAt: 'asc' },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
        },
      });

      return {
        comments: comments.map((comment) => ({
          id: comment.id,
          authorId: comment.authorId,
          author: displayName(comment.author),
          authorHandle: personHandle(comment.author),
          authorIsAi: !!comment.author?.isBot,
          body: comment.content,
        })),
      };
    }),

  getPost: publicProcedure
    .input(
      z.object({
        postId: z.string().min(1),
        coopId: z.string().min(1).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const accountUser = await resolveOptionalAccountUser(context);
      const post = await context.db.commonsPost.findUnique({
        where: { id: input.postId },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
          media: {
            orderBy: { order: 'asc' },
          },
          // The newest 100, so a long thread (like a welcome lounge's
          // intro thread) still shows recent replies; reversed below.
          comments: {
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: {
              author: { select: { name: true, email: true, handle: true, isBot: true } },
              media: { orderBy: { order: 'asc' } },
              _count: { select: { reactions: true } },
              // Only the viewer's own reaction, to show whether they reacted.
              reactions: {
                where: { userId: accountUser?.id ?? '' },
                select: { id: true },
                take: 1,
              },
            },
          },
          _count: { select: { comments: true, supports: true } },
        },
      });

      if (!post || (input.coopId && post.coopId !== input.coopId)) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const canRead =
        (post.coopId === COMMONS_COOP_ID ||
          (!!accountUser &&
            (await hasActiveCommonsMembership(
              context.db,
              accountUser.id,
              post.coopId,
            )))) &&
        (await canReadPostCircle(context.db, accountUser?.id, post));

      if (!canRead) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Join this commons to view this post.',
        });
      }

      post.comments.reverse();
      const coop = await loadCoopSummary(context.db, post.coopId);
      await decorateSupporterBadges(context.db, [post]);
      const isCirclePost = !!post.circleId && post.circleId !== generalCircleId(post.coopId);
      const circleMembership = isCirclePost && accountUser
        ? await context.db.groupMember.findUnique({
            where: { groupId_userId: { groupId: post.circleId!, userId: accountUser.id } },
            select: { group: { select: { coopId: true } } },
          })
        : null;

      return {
        coop,
        post: mapPostWithGroup(post, coop.name),
        circleIsMember: isCirclePost ? circleMembership?.group.coopId === post.coopId : null,
      };
    }),

  ask: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        postId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let context = '';
      let contextCoopId: string | undefined;

      if (input.postId) {
        const post = await ctx.db.commonsPost.findUnique({
          where: { id: input.postId },
          include: {
            comments: {
              orderBy: { createdAt: 'asc' },
              take: 10,
              include: {
                author: { select: { name: true, email: true, handle: true, isBot: true } },
              },
            },
          },
        });

        const accountUser = await resolveOptionalAccountUser(ctx as Context);
        if (
          post &&
          (await canReadPostCircle(ctx.db, accountUser?.id, post)) &&
          (post.coopId === COMMONS_COOP_ID ||
            (accountUser &&
              (await hasActiveCommonsMembership(
                ctx.db,
                accountUser.id,
                post.coopId,
              ))))
        ) {
          contextCoopId = post.coopId;
          context = [
            `Thread title: ${post.title}`,
            `Thread body: ${post.content}`,
            'Recent comments:',
            ...post.comments.map(
              (comment) => `${displayName(comment.author)}: ${comment.content}`,
            ),
          ].join('\n');
        }
      }

      const answer = await runCommonsAi(
        [input.prompt, context ? `\nContext:\n${context}` : ''].join(''),
        contextCoopId,
      );

      return { answer };
    }),

  getPersonalPage: publicProcedure
    .input(
      z.object({
        handle: z.string().trim().min(1).max(80),
        limit: z.number().min(1).max(50).default(30),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const handle = input.handle.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const user = await findUserByPersonalHandle(ctx.db, handle);

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Personal page not found.',
        });
      }

      const [rawPosts, followerCount, followingCount, viewerUser] =
        await Promise.all([
          context.db.personalPagePost.findMany({
            where: { authorId: user.id },
            orderBy: { createdAt: 'desc' },
            take: input.limit + 1,
            ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
            include: {
              author: { select: { name: true, email: true, handle: true, isBot: true } },
              comments: {
                orderBy: { createdAt: 'asc' },
                take: 50,
                include: {
                  author: { select: { name: true, email: true, handle: true, isBot: true } },
                },
              },
              _count: { select: { comments: true, supports: true } },
            },
          }),
          context.db.follow.count({ where: { followingId: user.id } }),
          context.db.follow.count({ where: { followerId: user.id } }),
          resolveOptionalAccountUser(context),
        ]);

      const hasMore = rawPosts.length > input.limit;
      const posts = hasMore ? rawPosts.slice(0, input.limit) : rawPosts;
      const nextCursor = hasMore ? posts[posts.length - 1].id : null;

      const commons = await loadVisibleProfileCommons(
        context.db,
        user.id,
        viewerUser?.id ?? null,
      );

      const viewerIsFollowing =
        viewerUser && viewerUser.id !== user.id
          ? (await context.db.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: viewerUser.id,
                  followingId: user.id,
                },
              },
              select: { id: true },
            })) !== null
          : false;

      return {
        profile: {
          id: user.id,
          name: displayName(user),
          handle: personHandle(user),
          bio: user.selfDescription,
          avatarUrl: user.avatarUrl,
          avatarEmoji: user.avatarEmoji,
          avatarColor: user.avatarColor,
          createdAt: user.createdAt.toISOString(),
          followerCount,
          followingCount,
          isOwnPage: viewerUser?.id === user.id,
          viewerIsFollowing,
          commons,
        },
        posts: posts.map(mapPersonalPagePost),
        nextCursor,
      };
    }),

  createPersonalPagePost: accountAuthenticatedProcedure
    .input(
      z
        .object({
          content: z.string().trim().max(5000).default(''),
          tag: postTagSchema.nullable().optional(),
          media: z.array(uploadedPostMediaSchema).max(4).default([]),
        })
        .refine((input) => input.content.length > 0 || input.media.length > 0, {
          message: 'Write something or attach media before posting.',
          path: ['content'],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      await ensureUserHandle(ctx.db, accountUser);
      const post = await ctx.db.personalPagePost.create({
        data: {
          authorId: accountUser.id,
          content: input.content,
          tag: input.tag || null,
          media: toJsonValue(input.media),
        },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
          comments: {
            orderBy: { createdAt: 'asc' },
            include: {
              author: { select: { name: true, email: true, handle: true, isBot: true } },
            },
          },
          _count: { select: { comments: true, supports: true } },
        },
      });

      return { post: mapPersonalPagePost(post) };
    }),

  deletePersonalPagePost: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const post = await ctx.db.personalPagePost.findUnique({
        where: { id: input.postId },
        select: { authorId: true },
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }
      if (post.authorId !== accountUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own posts.',
        });
      }

      await ctx.db.personalPagePost.delete({ where: { id: input.postId } });

      return { success: true };
    }),

  updatePersonalPageProfile: accountAuthenticatedProcedure
    .input(
      z.object({
        bio: z.string().trim().max(5000),
        avatarUrl: z
          .string()
          .url()
          .max(2048)
          .refine((url) => url.startsWith('https://'), 'Photo must be an https URL.')
          .nullable(),
        avatarEmoji: z.string().trim().max(16).nullable(),
        avatarColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a hex value like #FF6B00.')
          .nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const updated = await ctx.db.user.update({
        where: { id: accountUser.id },
        data: {
          selfDescription: input.bio || null,
          avatarUrl: input.avatarUrl,
          // A photo replaces the emoji so the two never disagree.
          avatarEmoji: input.avatarUrl ? null : input.avatarEmoji || null,
          avatarColor: input.avatarUrl ? null : input.avatarColor,
        },
        select: {
          selfDescription: true,
          avatarUrl: true,
          avatarEmoji: true,
          avatarColor: true,
        },
      });

      return {
        bio: updated.selfDescription,
        avatarUrl: updated.avatarUrl,
        avatarEmoji: updated.avatarEmoji,
        avatarColor: updated.avatarColor,
      };
    }),

  createPersonalPagePostComment: accountAuthenticatedProcedure
    .input(
      z.object({
        postId: z.string().min(1),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      await ensureUserHandle(ctx.db, accountUser);

      const post = await ctx.db.personalPagePost.findUnique({
        where: { id: input.postId },
        select: { authorId: true },
      });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const comment = await ctx.db.personalPagePostComment.create({
        data: {
          postId: input.postId,
          authorId: accountUser.id,
          content: input.content,
        },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
        },
      });

      if (post.authorId && post.authorId !== accountUser.id) {
        void createNotificationAndPush(ctx.db, {
          userId: post.authorId,
          coopId: COMMONS_COOP_ID,
          type: 'PERSONAL_PAGE_COMMENT',
          title: 'New comment',
          body: `${displayName(comment.author)} commented on your page.`,
          data: { postId: input.postId },
        });
      }

      return {
        comment: {
          id: comment.id,
          authorId: comment.authorId,
          author: displayName(comment.author),
          authorHandle: personHandle(comment.author),
          authorIsAi: !!comment.author?.isBot,
          body: comment.content,
          createdAt: comment.createdAt.toISOString(),
        },
      };
    }),

  editPersonalPagePostComment: accountAuthenticatedProcedure
    .input(
      z.object({
        commentId: z.string().min(1),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const comment = await ctx.db.personalPagePostComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true },
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found.',
        });
      }
      if (comment.authorId !== accountUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only edit your own comments.',
        });
      }

      const updated = await ctx.db.personalPagePostComment.update({
        where: { id: input.commentId },
        data: { content: input.content },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
        },
      });

      return {
        comment: {
          id: updated.id,
          authorId: updated.authorId,
          author: displayName(updated.author),
          body: updated.content,
          createdAt: updated.createdAt.toISOString(),
        },
      };
    }),

  deletePersonalPagePostComment: accountAuthenticatedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const comment = await ctx.db.personalPagePostComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true },
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found.',
        });
      }
      if (comment.authorId !== accountUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own comments.',
        });
      }

      await ctx.db.personalPagePostComment.delete({
        where: { id: input.commentId },
      });

      return { success: true };
    }),

  togglePersonalPagePostSupport: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const post = await ctx.db.personalPagePost.findUnique({
        where: { id: input.postId },
        select: { authorId: true },
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const existing = await ctx.db.personalPagePostSupport.findUnique({
        where: {
          postId_userId: {
            postId: input.postId,
            userId: accountUser.id,
          },
        },
      });

      if (existing) {
        await ctx.db.personalPagePostSupport.delete({
          where: { id: existing.id },
        });
        return { supported: false };
      }

      await ctx.db.personalPagePostSupport.create({
        data: { postId: input.postId, userId: accountUser.id },
      });

      if (post.authorId && post.authorId !== accountUser.id) {
        void createNotificationAndPush(ctx.db, {
          userId: post.authorId,
          coopId: COMMONS_COOP_ID,
          type: 'PERSONAL_PAGE_SUPPORT',
          title: 'Someone liked your post',
          body: 'A member liked what you shared on your page.',
          data: { postId: input.postId },
        });
      }

      return { supported: true };
    }),

  createPost: accountAuthenticatedProcedure
    .input(
      z
        .object({
          coopId: z.string().min(1).default(COMMONS_COOP_ID),
          circleId: z.string().min(1).optional(),
          title: z.string().trim().min(1).max(120).optional(),
          content: z.string().trim().max(5000).default(''),
          tag: postTagSchema.default('Social'),
          media: z.array(uploadedPostMediaSchema).max(4).default([]),
        })
        .refine((input) => input.content.length > 0 || input.media.length > 0, {
          message: 'Write something or attach media before posting.',
          path: ['content'],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      await requireActiveCommonsMembership(
        ctx.db,
        accountUser.id,
        input.coopId,
      );
      const circleId =
        input.circleId && input.circleId !== generalCircleId(input.coopId)
          ? input.circleId
          : generalCircleId(input.coopId);
      if (circleId !== generalCircleId(input.coopId)) {
        await requireCircleMembership(
          ctx.db,
          accountUser.id,
          input.coopId,
          circleId,
        );
      }
      await ensureUserHandle(ctx.db, accountUser);
      await ensureSageBotUser(ctx.db, input.coopId);
      const { content: encodedContent, mentionedUsers } = await encodeMentions(
        ctx.db,
        input.content,
        { coopId: input.coopId },
      );
      const classification = classifyPost({
        title: input.title,
        content: encodedContent,
        tag: input.tag,
        mediaCount: input.media.length,
      });

      const post = await ctx.db.commonsPost.create({
        data: {
          coopId: input.coopId,
          circleId,
          authorId: accountUser.id,
          title: input.title || titleFromContent(encodedContent),
          content: encodedContent,
          tag: input.tag,
          classification: classification.classification,
          classificationConfidence: classification.classificationConfidence,
          classificationSignals: classification.classificationSignals,
          media: input.media.length
            ? {
                create: input.media.map((media, index) => ({
                  storageProvider: 'vercel-blob',
                  pathname: media.pathname,
                  url: media.url,
                  mediaType: media.mediaType,
                  mimeType: media.mimeType,
                  fileName: media.fileName,
                  width: media.width,
                  height: media.height,
                  durationMs: media.durationMs,
                  sizeBytes: media.sizeBytes,
                  order: index,
                })),
              }
            : undefined,
        },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
          media: {
            orderBy: { order: 'asc' },
          },
          comments: {
            orderBy: { createdAt: 'asc' },
            take: 2,
            include: {
              author: { select: { name: true, email: true, handle: true, isBot: true } },
            },
          },
          _count: { select: { comments: true, supports: true } },
        },
      });
      if (circleId === generalCircleId(input.coopId)) {
        await enqueueCommonsActionContent('commons_post', post.id).catch((error) =>
          console.error('Could not enqueue Commons action scan for post', { postId: post.id, error }),
        );
      } else {
        // Circle activity feeds Sage's circle window (direct messages can't reach this path).
        touchCircleWindow(circleId, input.coopId).catch((error) =>
          console.error('Could not update Sage circle window', { circleId, error }),
        );
      }
      const coop = await loadCoopSummary(ctx.db, input.coopId);

      if (circleId === generalCircleId(input.coopId)) {
        await recordPostClassificationObservation({
          coopId: input.coopId,
          postId: post.id,
          title: input.title,
          content: encodedContent,
          tag: input.tag,
        });
      }

      const sageMention = mentionedUsers.find(isSageUser);
      if (sageMention && circleId === generalCircleId(input.coopId)) {
        try {
          const sage = await ensureSageBotUser(ctx.db, input.coopId);
          const agent = getAgent('sage-commons-reply');
          if (agent) {
            await traceSageReply(
              { kind: 'post', coopId: input.coopId, postId: post.id },
              { message: encodedContent, threadCount: 0 },
              (message) => agent.run({ coopId: input.coopId, message }),
              async (reply) => {
                const sageComment = await ctx.db.commonsComment.create({
                  data: { postId: post.id, authorId: sage.id, content: reply },
                });
                await notifySageComment({ postId: post.id, commentId: sageComment.id });
              },
            );
          }
        } catch (err) {
          console.error('Sage auto-reply on createPost failed:', err);
        }
      } else if (sageMention) {
        await recordSkippedCircleMention(
          { coopId: input.coopId, circleId, postId: post.id, sourceId: post.id, kind: 'post' },
          encodedContent,
        );
      }

      if (circleId !== generalCircleId(input.coopId)) {
        const mentionedUserIds: string[] = [];
        for (const mentioned of mentionedUsers) {
          if (mentioned.isBot || mentioned.id === accountUser.id) continue;
          if (await canReadPostCircle(ctx.db, mentioned.id, post))
            mentionedUserIds.push(mentioned.id);
        }
        await notifyCircleActivity(ctx.db, {
          coopId: input.coopId,
          circleId,
          postId: post.id,
          actorId: accountUser.id,
          actorName: displayName(accountUser),
          kind: 'post',
          mentionedUserIds,
        })
          .then(({ recipients }) =>
            console.info('[push] createPost circle notifications', {
              postId: post.id,
              recipients,
            }),
          )
          .catch(() =>
            console.error('[push] createPost circle notifications failed', {
              postId: post.id,
            }),
          );
      } else {
        console.info('[push] createPost mention notifications', {
          postId: post.id,
          recipients: mentionedUsers.filter(
            (mentioned) => !mentioned.isBot && mentioned.id !== accountUser.id,
          ).length,
        });
        for (const mentioned of mentionedUsers) {
          if (mentioned.isBot || mentioned.id === accountUser.id) continue;
          void createNotificationAndPush(ctx.db, {
            userId: mentioned.id,
            coopId: input.coopId,
            type: 'MENTION',
            title: 'You were mentioned',
            body: `${displayName(accountUser)} mentioned you in a post.`,
            data: { postId: post.id, coopId: input.coopId },
          }).catch(() => {
            console.error('[push] createPost notification preparation failed', {
              postId: post.id,
            });
          });
        }
      }

      return { post: mapPostWithGroup(post, coop.name) };
    }),

  deletePost: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const post = await ctx.db.commonsPost.findUnique({
        where: { id: input.postId },
        select: { authorId: true },
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }
      if (post.authorId !== accountUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own posts.',
        });
      }

      await ctx.db.commonsPost.delete({ where: { id: input.postId } });

      return { success: true };
    }),

  pinPost: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const post = await requireCircleLeaderForPost(ctx.db, accountUser.id, input.postId);

      await ctx.db.$transaction([
        ctx.db.commonsPost.updateMany({
          where: { circleId: post.circleId, isPinned: true },
          data: { isPinned: false, pinnedAt: null, pinnedById: null },
        }),
        ctx.db.commonsPost.update({
          where: { id: post.id },
          data: { isPinned: true, pinnedAt: new Date(), pinnedById: accountUser.id },
        }),
      ]);

      return { success: true };
    }),

  unpinPost: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const post = await requireCircleLeaderForPost(ctx.db, accountUser.id, input.postId);

      await ctx.db.commonsPost.update({
        where: { id: post.id },
        data: { isPinned: false, pinnedAt: null, pinnedById: null },
      });

      return { success: true };
    }),

  createComment: accountAuthenticatedProcedure
    .input(
      z
        .object({
          postId: z.string().min(1),
          content: z.string().trim().max(2000).default(''),
          media: z.array(uploadedPostMediaSchema).max(4).default([]),
          // The comment this one answers, when the author tapped "Reply".
          // Comments stay flat; this only feeds reply detection (e.g. a
          // welcome lounge intro's first-reply alert).
          replyToCommentId: z.string().min(1).optional(),
        })
        .refine((input) => input.content.length > 0 || input.media.length > 0, {
          message: 'Write something or attach an image before commenting.',
          path: ['content'],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const postId = input.postId;

      const post = await ctx.db.commonsPost.findUnique({
        where: { id: postId },
      });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }
      await requireActiveCommonsMembership(ctx.db, accountUser.id, post.coopId);
      await requirePostCircleMembership(ctx.db, accountUser.id, post);
      if (input.replyToCommentId) {
        const target = await ctx.db.commonsComment.findUnique({
          where: { id: input.replyToCommentId },
          select: { postId: true },
        });
        if (target?.postId !== post.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You can only reply to a comment on this post.',
          });
        }
      }
      await ensureSageBotUser(ctx.db, post.coopId);
      const { content: encodedContent, mentionedUsers } = await encodeMentions(
        ctx.db,
        input.content,
        { coopId: post.coopId },
      );

      const comment = await ctx.db.commonsComment.create({
        data: {
          postId,
          authorId: accountUser.id,
          content: encodedContent,
          media: input.media.length
            ? {
                create: input.media.map((media, index) => ({
                  storageProvider: 'vercel-blob',
                  pathname: media.pathname,
                  url: media.url,
                  mediaType: media.mediaType,
                  mimeType: media.mimeType,
                  fileName: media.fileName,
                  width: media.width,
                  height: media.height,
                  durationMs: media.durationMs,
                  sizeBytes: media.sizeBytes,
                  order: index,
                })),
              }
            : undefined,
        },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
          media: { orderBy: { order: 'asc' } },
        },
      });
      if (!post.circleId || post.circleId === generalCircleId(post.coopId)) {
        await enqueueCommonsActionContent('commons_comment', comment.id).catch((error) =>
          console.error('Could not enqueue Commons action scan for comment', { commentId: comment.id, error }),
        );
      }

      // A reply may be what Sage was waiting for: check the member's open follow-ups on this post now.
      void wakeTasksForReply(post.id, accountUser.id).catch((error) =>
        console.error('Could not wake Sage follow-ups', { postId: post.id, error }),
      );
      const isCirclePost =
        !!post.circleId && post.circleId !== generalCircleId(post.coopId);
      if (isCirclePost) {
        touchCircleWindow(post.circleId!, post.coopId).catch((error) =>
          console.error('Could not update Sage circle window', { circleId: post.circleId, error }),
        );
      }
      // Welcome lounge intros: record a newcomer's intro, or alert a
      // newcomer the first time someone answers theirs. Best-effort - the
      // comment is already saved.
      let introReplyNotified = new Set<string>();
      if (isCirclePost) {
        try {
          const introActivity = await recordWelcomeIntroActivity(ctx.db, {
            post,
            comment: { id: comment.id, content: comment.content, createdAt: comment.createdAt },
            author: accountUser,
            mentionedUserIds: mentionedUsers
              .filter((mentioned) => !mentioned.isBot)
              .map((mentioned) => mentioned.id),
            replyToCommentId: input.replyToCommentId,
          });
          introReplyNotified = new Set(introActivity.notifiedNewcomerIds);
        } catch (error) {
          console.error('Welcome intro tracking failed', { commentId: comment.id, error });
        }
      }
      if (isCirclePost) {
        const mentionedUserIds: string[] = [];
        for (const mentioned of mentionedUsers) {
          if (mentioned.isBot || mentioned.id === accountUser.id) continue;
          if (await canReadPostCircle(ctx.db, mentioned.id, post))
            mentionedUserIds.push(mentioned.id);
        }
        const postAuthorId =
          post.authorId &&
          post.authorId !== accountUser.id &&
          (await canReadPostCircle(ctx.db, post.authorId, post))
            ? post.authorId
            : null;
        await notifyCircleActivity(ctx.db, {
          coopId: post.coopId,
          circleId: post.circleId!,
          postId: post.id,
          actorId: accountUser.id,
          actorName: displayName(comment.author),
          kind: 'comment',
          mentionedUserIds,
          postAuthorId,
          // Already told "X replied to your intro" for this same comment.
          alreadyNotifiedUserIds: [...introReplyNotified],
        }).catch(() =>
          console.error('[push] createComment circle notifications failed', {
            postId: post.id,
          }),
        );
      } else if (post.authorId && post.authorId !== accountUser.id) {
        void createNotificationAndPush(ctx.db, {
          userId: post.authorId,
          coopId: post.coopId,
          type: 'COMMONS_COMMENT',
          title: 'New comment',
          body: `${displayName(comment.author)} replied to your post.`,
          data: {
            postId: post.id,
            coopId: post.coopId,
          },
        });
      }

      const sageMention = mentionedUsers.find(isSageUser);
      if (
        sageMention &&
        (!post.circleId || post.circleId === generalCircleId(post.coopId))
      ) {
        try {
          const sage = await ensureSageBotUser(ctx.db, post.coopId);
          const agent = getAgent('sage-commons-reply');
          if (agent) {
            const priorComments = await ctx.db.commonsComment.findMany({
              where: { postId: post.id, id: { not: comment.id } },
              orderBy: { createdAt: 'asc' },
              take: 10,
              include: {
                author: { select: { name: true, email: true, handle: true, isBot: true } },
              },
            });
            const threadContext = [
              `Original post: ${post.content}`,
              ...priorComments.map(
                (c) => `${displayName(c.author)}: ${c.content}`,
              ),
            ].join('\n');

            await traceSageReply(
              { kind: 'comment', coopId: post.coopId, postId: post.id, commentId: comment.id },
              { message: encodedContent, threadContext, threadCount: priorComments.length + 1 },
              (message, thread) => agent.run({ coopId: post.coopId, message, threadContext: thread }),
              async (reply) => {
                const sageComment = await ctx.db.commonsComment.create({
                  data: { postId: post.id, authorId: sage.id, content: reply },
                });
                await notifySageComment({ postId: post.id, commentId: sageComment.id });
              },
            );
          }
        } catch (err) {
          console.error('Sage auto-reply on createComment failed:', err);
        }
      } else if (sageMention && post.circleId) {
        await recordSkippedCircleMention(
          { coopId: post.coopId, circleId: post.circleId, postId: post.id, sourceId: comment.id, kind: 'comment' },
          encodedContent,
        );
      }

      for (const mentioned of isCirclePost ? [] : mentionedUsers) {
        if (mentioned.isBot || mentioned.id === accountUser.id) continue;
        void createNotificationAndPush(ctx.db, {
          userId: mentioned.id,
          coopId: post.coopId,
          type: 'MENTION',
          title: 'You were mentioned',
          body: `${displayName(accountUser)} mentioned you in a comment.`,
          data: { postId: post.id, coopId: post.coopId },
        });
      }

      return {
        comment: {
          id: comment.id,
          authorId: comment.authorId,
          author: displayName(comment.author),
          authorHandle: personHandle(comment.author),
          authorIsAi: !!comment.author?.isBot,
          reactionCount: 0,
          viewerReacted: false,
          body: comment.content,
          media:
            comment.media?.map((item: any) => ({
              id: item.id,
              pathname: item.pathname,
              url: item.url,
              mediaType: item.mediaType,
              mimeType: item.mimeType,
              fileName: item.fileName,
              width: item.width,
              height: item.height,
              durationMs: item.durationMs,
              sizeBytes: item.sizeBytes,
            })) ?? [],
        },
      };
    }),

  editComment: accountAuthenticatedProcedure
    .input(
      z.object({
        commentId: z.string().min(1),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const comment = await ctx.db.commonsComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true, post: { select: { coopId: true } } },
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found.',
        });
      }
      if (comment.authorId !== accountUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only edit your own comments.',
        });
      }

      await ensureSageBotUser(ctx.db, comment.post.coopId);
      const { content: encodedContent } = await encodeMentions(
        ctx.db,
        input.content,
        { coopId: comment.post.coopId },
      );
      const updated = await ctx.db.commonsComment.update({
        where: { id: input.commentId },
        data: { content: encodedContent },
        include: {
          author: { select: { name: true, email: true, handle: true, isBot: true } },
          media: { orderBy: { order: 'asc' } },
        },
      });

      return {
        comment: {
          id: updated.id,
          authorId: updated.authorId,
          author: displayName(updated.author),
          body: updated.content,
          media:
            updated.media?.map((item: any) => ({
              id: item.id,
              pathname: item.pathname,
              url: item.url,
              mediaType: item.mediaType,
              mimeType: item.mimeType,
              fileName: item.fileName,
              width: item.width,
              height: item.height,
              durationMs: item.durationMs,
              sizeBytes: item.sizeBytes,
            })) ?? [],
        },
      };
    }),

  deleteComment: accountAuthenticatedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const comment = await ctx.db.commonsComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true },
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found.',
        });
      }
      if (comment.authorId !== accountUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own comments.',
        });
      }

      await ctx.db.commonsComment.delete({ where: { id: input.commentId } });

      return { success: true };
    }),

  // A member's "like" on a comment - the comment-level counterpart of
  // toggleSupport. A first reaction on a welcome lounge intro counts as a
  // response to it (see services/welcome-intros.ts).
  toggleCommentReaction: accountAuthenticatedProcedure
    .input(z.object({ commentId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const comment = await ctx.db.commonsComment.findUnique({
        where: { id: input.commentId },
        select: { id: true, authorId: true, author: { select: { isBot: true } }, post: true },
      });
      if (!comment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found.' });
      }
      await requireActiveCommonsMembership(ctx.db, accountUser.id, comment.post.coopId);
      await requirePostCircleMembership(ctx.db, accountUser.id, comment.post);

      const existing = await ctx.db.commonsCommentReaction.findUnique({
        where: { commentId_userId: { commentId: comment.id, userId: accountUser.id } },
      });
      let reacted: boolean;
      if (existing) {
        await ctx.db.commonsCommentReaction.delete({ where: { id: existing.id } });
        reacted = false;
      } else {
        let created = true;
        try {
          await ctx.db.commonsCommentReaction.create({
            data: { commentId: comment.id, userId: accountUser.id },
          });
        } catch (error) {
          // A double tap raced us - the reaction exists either way, and the
          // winning request already sent the alert.
          if ((error as { code?: string } | undefined)?.code !== 'P2002') throw error;
          created = false;
        }
        reacted = true;
        if (created) {
          // Intro's first response -> "reacted to your intro"; otherwise the
          // comment author's "liked your comment" (never both).
          await notifyNewCommentReaction(ctx.db, {
            comment,
            reactor: accountUser,
          }).catch((error) =>
            console.error('Comment reaction notification failed', { commentId: comment.id, error }),
          );
        }
      }

      const reactionCount = await ctx.db.commonsCommentReaction.count({
        where: { commentId: comment.id },
      });
      return { reacted, reactionCount };
    }),

  toggleSupport: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const post = await ctx.db.commonsPost.findUnique({
        where: { id: input.postId },
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }
      await requireActiveCommonsMembership(ctx.db, accountUser.id, post.coopId);
      await requirePostCircleMembership(ctx.db, accountUser.id, post);

      const existing = await ctx.db.commonsPostSupport.findUnique({
        where: {
          postId_userId: {
            postId: input.postId,
            userId: accountUser.id,
          },
        },
      });

      if (existing) {
        await ctx.db.commonsPostSupport.delete({ where: { id: existing.id } });
        return { supported: false };
      }

      await ctx.db.commonsPostSupport.create({
        data: { postId: input.postId, userId: accountUser.id },
      });

      if (post.authorId && post.authorId !== accountUser.id) {
        void createNotificationAndPush(ctx.db, {
          userId: post.authorId,
          coopId: post.coopId,
          type: 'COMMONS_SUPPORT',
          title: 'Someone liked your post',
          body: 'A commons member liked what you shared.',
          data: {
            postId: post.id,
            coopId: post.coopId,
          },
        });
      }
      return { supported: true };
    }),

  // Legacy endpoint kept for older app builds; DMs now live in private
  // two-person circles (see groups.openDirect / groups.sendDirect).
  sendDirectMessage: accountAuthenticatedProcedure
    .input(
      z.object({
        receiverId: z.string().min(1),
        content: z.string().trim().min(1).max(4000),
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const { group } = await openDirectCircle(ctx.db, {
        coopId: input.coopId,
        userId: accountUser.id,
        otherUserId: input.receiverId,
      });
      const message = await sendDirectCircleMessage(ctx.db, {
        group,
        sender: accountUser,
        content: input.content,
      });

      return {
        message: {
          id: message.id,
          body: message.body,
          createdAt: message.createdAt,
        },
      };
    }),

  listDirectMembers: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const { accountUser } = ctx as AccountAuthenticatedContext;
    await ensureCommonsMembership(ctx.db, accountUser.id);

    const memberships = await ctx.db.userCoopMembership.findMany({
      where: {
        coopId: COMMONS_COOP_ID,
        status: 'ACTIVE',
        userId: { not: accountUser.id },
        user: { deletedAt: null },
      },
      orderBy: { lastActiveAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, name: true, email: true, handle: true } },
      },
    });

    return {
      members: memberships.map((membership) => ({
        id: membership.user.id,
        name: displayName(membership.user),
        handle: personHandle(membership.user),
        role: 'Cahootz Commons',
      })),
    };
  }),

  // Legacy endpoint kept for older app builds, in its original shape.
  listDirectThreads: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const { accountUser } = ctx as AccountAuthenticatedContext;
    const circles = await listDirectCircles(ctx.db, accountUser.id);
    const threads = await Promise.all(
      circles.map(async (circle) => {
        const { messages } = await listDirectCircleMessages(ctx.db, {
          groupId: circle.groupId,
          userId: accountUser.id,
          limit: 50,
        });
        return {
          id: circle.person.id,
          name: circle.person.name,
          role: 'Cahootz Commons',
          time: circle.lastMessageAt ? relativeTime(new Date(circle.lastMessageAt)) : '',
          unread: circle.unreadCount,
          preview: circle.preview ?? '',
          messages: messages.map((message) => ({
            id: message.id,
            fromMe: message.fromMe,
            body: message.body,
            time: new Date(message.createdAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            }),
          })),
        };
      }),
    );

    return { threads };
  }),

  toggleFollowUser: accountAuthenticatedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;

      if (input.userId === accountUser.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "You can't follow yourself.",
        });
      }

      const target = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: { id: true, deletedAt: true },
      });
      if (!target || target.deletedAt) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Member not found.',
        });
      }

      const existing = await ctx.db.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: accountUser.id,
            followingId: input.userId,
          },
        },
      });

      if (existing) {
        await ctx.db.follow.delete({ where: { id: existing.id } });
        return { following: false };
      }

      await ctx.db.follow.create({
        data: { followerId: accountUser.id, followingId: input.userId },
      });

      void createNotificationAndPush(ctx.db, {
        userId: input.userId,
        coopId: COMMONS_COOP_ID,
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        body: `${displayName(accountUser)} started following you.`,
        data: { followerId: accountUser.id },
      });

      return { following: true };
    }),

  listFollowing: accountAuthenticatedProcedure
    .input(
      z
        .object({ limit: z.number().min(1).max(100).default(50) })
        .default({ limit: 50 }),
    )
    .query(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const follows = await ctx.db.follow.findMany({
        where: { followerId: accountUser.id },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        include: {
          following: {
            select: { id: true, name: true, email: true, handle: true },
          },
        },
      });

      return {
        members: follows.map((follow) => ({
          id: follow.following.id,
          name: displayName(follow.following),
          handle: personHandle(follow.following),
        })),
      };
    }),

  listFollowers: accountAuthenticatedProcedure
    .input(
      z
        .object({ limit: z.number().min(1).max(100).default(50) })
        .default({ limit: 50 }),
    )
    .query(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const follows = await ctx.db.follow.findMany({
        where: { followingId: accountUser.id },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        include: {
          follower: {
            select: { id: true, name: true, email: true, handle: true },
          },
        },
      });

      return {
        members: follows.map((follow) => ({
          id: follow.follower.id,
          name: displayName(follow.follower),
          handle: personHandle(follow.follower),
        })),
      };
    }),
});

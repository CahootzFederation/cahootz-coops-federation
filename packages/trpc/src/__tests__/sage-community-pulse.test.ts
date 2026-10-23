import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeCommunityPulse, publishCommunityPulse, PULSE_PUBLISHER, type PulseActivity } from '../services/sage-community-pulse.js';

const now = new Date('2026-10-23T15:00:00Z');
const activity = (n = 3): PulseActivity[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, authorId: `u${i}`, tag: 'Need', createdAt: new Date('2026-10-20T00:00:00Z'), comments: [] }));
const tx = {
  $queryRaw: vi.fn(), coopConfig: { findFirst: vi.fn() }, commonsPost: { findMany: vi.fn() },
  aIObservation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
const client = { $transaction: vi.fn(async (fn: (db: typeof tx) => unknown) => fn(tx)) };
beforeEach(() => {
  vi.clearAllMocks();
  tx.coopConfig.findFirst.mockResolvedValue({ isDemo: false });
  tx.aIObservation.findFirst.mockResolvedValue(null);
  tx.commonsPost.findMany.mockResolvedValue(activity());
  tx.aIObservation.create.mockResolvedValue({ id: 'new' });
});

describe('Sage Community Pulse publication', () => {
  it('says what is unknown instead of inferring preferences from a small group', () => {
    const output = describeCommunityPulse(activity(2), now);
    expect(output.kind).toBe('limited_activity');
    expect(output.summary).toContain('isn’t enough');
    expect(output.basis).not.toContain('2 eligible');
    expect(output.uncertainty).toContain('can’t infer');
  });
  it('requires requests from three different people and ignores self replies', () => {
    const posts = activity();
    posts[0]!.comments = [{ id: 'self', authorId: 'u0' }];
    expect(describeCommunityPulse(posts, now).kind).toBe('unanswered_requests');
    posts[1]!.authorId = 'u0';
    expect(describeCommunityPulse(posts, now).kind).toBe('limited_activity');
  });
  it('does not classify a capped reply sample as unanswered', () => {
    const posts = activity();
    posts[0]!.comments = Array.from({ length: 200 }, (_, i) => ({ id: String(i), authorId: 'u0' }));
    expect(describeCommunityPulse(posts, now).kind).toBe('shared_activity');
  });
  it('describes replies without claiming collaboration or completed help', () => {
    const posts = activity().map(p => ({ ...p, comments: [{ id: `c${p.id}`, authorId: 'other' }] }));
    const output = describeCommunityPulse(posts, now);
    expect(output.kind).toBe('conversations');
    expect(output.uncertainty).toContain('whether help happened offline');
  });
  it('publishes scoped immutable observations and preserves feedback on superseded rows', async () => {
    expect(await publishCommunityPulse('harbor', now, client as never)).toEqual({ published: true, observationId: 'new' });
    expect(tx.$queryRaw).toHaveBeenCalled();
    const { data } = tx.aIObservation.create.mock.calls[0]![0];
    expect(data).toMatchObject({ type: 'community_pulse', scopeType: 'commons', scopeId: 'harbor', visibility: 'COMMONS_MEMBERS', status: 'ACTIVE', generatedByAgentKey: PULSE_PUBLISHER });
    expect(data.sources.create).toHaveLength(3);
    expect(data.expiresAt.getTime() - now.getTime()).toBe(7 * 86400000);
    expect(tx.aIObservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SUPERSEDED' } }));
    expect(tx.aIObservation.update).not.toHaveBeenCalled();
  });
  it('restricts evidence to this Commons General feed and excludes bots, deleted users, and test text', async () => {
    await publishCommunityPulse('harbor', now, client as never);
    const query = tx.commonsPost.findMany.mock.calls[0]![0];
    expect(query.where).toMatchObject({ coopId: 'harbor', OR: [{ circleId: null }, { circleId: 'general:harbor' }], author: { isBot: false, deletedAt: null } });
    expect(JSON.stringify(query.where.NOT)).toContain('E2E');
    expect(JSON.stringify(query.where.author.NOT)).toContain('@test.cahootz.local');
    expect(query.take).toBe(200);
    expect(query.select.title).toBeUndefined();
    expect(query.select.content).toBeUndefined();
  });
  it('skips inactive/demo Commons and skips a second daily run before reading activity', async () => {
    tx.coopConfig.findFirst.mockResolvedValueOnce(null);
    expect(await publishCommunityPulse('harbor', now, client as never)).toEqual({ skipped: 'inactive_or_demo' });
    tx.coopConfig.findFirst.mockResolvedValueOnce({ isDemo: true });
    expect(await publishCommunityPulse('harbor', now, client as never)).toEqual({ skipped: 'inactive_or_demo' });
    tx.aIObservation.findFirst.mockResolvedValue({ id: 'old', createdAt: now, reviewAt: null });
    expect(await publishCommunityPulse('harbor', now, client as never)).toMatchObject({ skipped: 'not_due' });
    expect(tx.commonsPost.findMany).not.toHaveBeenCalled();
  });
  it('leaves wording and feedback intact when the read is unchanged', async () => {
    await publishCommunityPulse('harbor', now, client as never);
    const details = tx.aIObservation.create.mock.calls[0]![0].data.details;
    tx.aIObservation.create.mockClear();
    tx.aIObservation.findFirst.mockResolvedValue({ id: 'old', details, createdAt: new Date('2026-10-21T00:00:00Z'), reviewAt: null, expiresAt: new Date('2026-10-28T00:00:00Z') });
    expect(await publishCommunityPulse('harbor', now, client as never)).toEqual({ skipped: 'unchanged', observationId: 'old' });
    expect(tx.aIObservation.create).not.toHaveBeenCalled();
    expect(tx.aIObservation.update).toHaveBeenCalledWith({ where: { id: 'old' }, data: { reviewAt: expect.any(Date) } });
  });
});

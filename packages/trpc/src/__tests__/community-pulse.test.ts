import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listCommunityPulse, saveHumanAIFeedback, PulseFeedbackInput } from '../services/community-pulse.js';

const db = {
  userCoopMembership: { findFirst: vi.fn() },
  aIObservation: { findMany: vi.fn(), findFirst: vi.fn() },
  humanAIFeedback: { upsert: vi.fn() },
};
const input = { coopId: 'harbor', observationId: 'pulse-1', response: 'PARTLY' as const };
beforeEach(() => {
  vi.clearAllMocks();
  db.userCoopMembership.findFirst.mockResolvedValue({ id: 'membership' });
  db.aIObservation.findFirst.mockResolvedValue({ id: 'pulse-1' });
  db.aIObservation.findMany.mockResolvedValue([]);
  db.humanAIFeedback.upsert.mockResolvedValue({ response: 'PARTLY', comment: null, updatedAt: new Date() });
});

describe('Community Pulse feedback boundaries', () => {
  it('refuses reads and writes without active membership', async () => {
    db.userCoopMembership.findFirst.mockResolvedValue(null);
    await expect(listCommunityPulse(db as never, 'harbor', 'a')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(saveHumanAIFeedback(db as never, 'a', input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.aIObservation.findMany).not.toHaveBeenCalled();
    expect(db.humanAIFeedback.upsert).not.toHaveBeenCalled();
  });
  it('reads only explicitly published active unexpired Commons Pulse and the caller’s feedback', async () => {
    await listCommunityPulse(db as never, 'harbor', 'a');
    expect(db.aIObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: 'community_pulse', scopeType: 'commons', scopeId: 'harbor', visibility: 'COMMONS_MEMBERS', status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }),
      take: 5, select: expect.objectContaining({ humanFeedback: { where: { userId: 'a' }, select: { response: true, comment: true, updatedAt: true } } }),
    }));
  });
  it('does not return raw observation metadata or other feedback fields', async () => {
    db.aIObservation.findMany.mockResolvedValue([{ id: 'p', summary: 'Shared pattern', createdAt: new Date(), details: { title: 'Title', secret: 'internal', sourceIds: ['private'] }, humanFeedback: [] }]);
    const result = await listCommunityPulse(db as never, 'harbor', 'a');
    expect(result.observations[0]).toMatchObject({ title: 'Title', feedback: null });
    expect(JSON.stringify(result)).not.toMatch(/internal|private|sourceIds|details|humanFeedback/);
  });
  it('rejects hidden, expired, superseded, wrong-Commons and nonexistent targets through the same eligibility check', async () => {
    db.aIObservation.findFirst.mockResolvedValue(null);
    await expect(saveHumanAIFeedback(db as never, 'a', input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.aIObservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'pulse-1', type: 'community_pulse', scopeId: 'harbor', scopeType: 'commons', visibility: 'COMMONS_MEMBERS', status: 'ACTIVE' }) }));
    expect(db.humanAIFeedback.upsert).not.toHaveBeenCalled();
  });
  it('upserts by authenticated member and observation without trusting a submitted user ID', async () => {
    const parsed = PulseFeedbackInput.parse({ ...input, userId: 'victim' });
    await saveHumanAIFeedback(db as never, 'a', parsed);
    expect(db.humanAIFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { observationId_userId: { observationId: 'pulse-1', userId: 'a' } },
      create: expect.objectContaining({ coopId: 'harbor', userId: 'a' }), update: { response: 'PARTLY' },
    }));
  });
  it('trims explanations and allows explicit removal without erasing on choice-only updates', async () => {
    await saveHumanAIFeedback(db as never, 'a', { ...input, comment: '  Timing matters  ' });
    expect(db.humanAIFeedback.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { response: 'PARTLY', comment: 'Timing matters' } }));
    await saveHumanAIFeedback(db as never, 'a', { ...input, comment: ' ' });
    expect(db.humanAIFeedback.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { response: 'PARTLY', comment: null } }));
  });
  it('rejects invalid responses and oversized comments before writing', async () => {
    expect(() => PulseFeedbackInput.parse({ ...input, response: 'APPROVE' })).toThrow();
    await expect(saveHumanAIFeedback(db as never, 'a', { ...input, comment: 'x'.repeat(501) })).rejects.toThrow();
    expect(db.humanAIFeedback.upsert).not.toHaveBeenCalled();
  });
});

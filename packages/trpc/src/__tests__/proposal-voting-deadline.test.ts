import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/admin-verification.js', () => ({
  checkAdminStatusWithRole: vi.fn().mockResolvedValue({ isAdmin: true, role: 'admin' }),
}));

vi.mock('@repo/db', () => ({
  db: {},
  ProposalStatus: { SUBMITTED: 'SUBMITTED', VOTABLE: 'VOTABLE', APPROVED: 'APPROVED', WITHDRAWN: 'WITHDRAWN' },
}));

import { effectiveVotingEndsAt, proposalRouter, votingEndsAtFor } from '../routers/proposal.js';

const WALLET = '0x1234567890123456789012345678901234567890';
const DAY = 86_400_000;
const NOW = new Date('2026-10-05T12:00:00.000Z');

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop_1',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-02T12:00:00.000Z'),
    status: 'VOTABLE',
    coopId: 'family-abc',
    title: 'Shared tool library',
    summary: 'Buy tools members can borrow.',
    category: 'OTHER',
    categoryKey: null,
    proposerWallet: WALLET,
    proposerRole: 'MEMBER',
    proposerDisplayName: 'Ada',
    regionCode: 'US',
    regionName: 'United States',
    budgetCurrency: 'USD',
    budgetAmount: 1200,
    evaluation: null,
    quorumPercent: 20,
    approvalThresholdPercent: 60,
    votingWindowDays: 5,
    votingEndsAt: null,
    engineVersion: 'proposal-engine@2.0.0',
    auditChecks: [],
    decisionReasons: [],
    councilRequired: true,
    ...overrides,
  };
}

function caller(db: unknown) {
  return proposalRouter.createCaller({
    db,
    req: { headers: { 'x-wallet-address': WALLET } },
    res: {},
    coopId: 'cahootz',
  } as any);
}

describe('votingEndsAtFor', () => {
  it('counts the commons voting window from when the proposal became votable', () => {
    expect(votingEndsAtFor('VOTABLE' as any, 3, NOW)).toEqual(new Date(NOW.getTime() + 3 * DAY));
  });

  it('is empty for any other status', () => {
    expect(votingEndsAtFor('SUBMITTED' as any, 3, NOW)).toBeNull();
    expect(votingEndsAtFor('APPROVED' as any, 3, NOW)).toBeNull();
  });
});

describe('effectiveVotingEndsAt', () => {
  it('uses the stored end date when there is one', () => {
    const stored = new Date('2026-10-14T21:00:00.000Z');
    expect(effectiveVotingEndsAt({ status: 'VOTABLE', votingEndsAt: stored, votingWindowDays: 5 })).toBe(stored);
  });

  it('falls back to the voting window from the last change for older open proposals', () => {
    const updatedAt = new Date('2026-10-02T12:00:00.000Z');
    expect(
      effectiveVotingEndsAt({ status: 'VOTABLE', votingEndsAt: null, votingWindowDays: 5, updatedAt, createdAt: NOW }),
    ).toEqual(new Date(updatedAt.getTime() + 5 * DAY));
  });

  it('has no date for drafts, proposals in review, or closed proposals without one', () => {
    expect(effectiveVotingEndsAt({ status: 'SUBMITTED', votingEndsAt: null, createdAt: NOW })).toBeNull();
    expect(effectiveVotingEndsAt({ status: 'APPROVED', votingEndsAt: null, createdAt: NOW })).toBeNull();
  });
});

describe('proposal output', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes the commons and when voting closes', async () => {
    const endsAt = new Date('2026-10-14T21:00:00.000Z');
    const db = { proposal: { findUnique: vi.fn().mockResolvedValue(record({ votingEndsAt: endsAt })) } };
    const output = await caller(db).getById({ id: 'prop_1' });
    expect(output?.coopId).toBe('family-abc');
    expect(output?.votingEndsAt).toBe(endsAt.toISOString());
    expect(output?.updatedAt).toBe('2026-10-02T12:00:00.000Z');
  });

  it('fills in the closing date for an older open proposal from its voting window', async () => {
    const db = { proposal: { findUnique: vi.fn().mockResolvedValue(record()) } };
    const output = await caller(db).getById({ id: 'prop_1' });
    expect(output?.votingEndsAt).toBe('2026-10-07T12:00:00.000Z');
  });

  it('has no closing date for a proposal still in review', async () => {
    const db = { proposal: { findUnique: vi.fn().mockResolvedValue(record({ status: 'SUBMITTED' })) } };
    const output = await caller(db).getById({ id: 'prop_1' });
    expect(output?.votingEndsAt).toBeNull();
  });
});

describe('proposal.updateStatus', () => {
  it('stores when voting closes as the proposal opens for voting', async () => {
    const before = Date.now();
    const update = vi.fn().mockImplementation(async ({ data }) => record({ ...data }));
    const db = {
      proposal: {
        findUnique: vi.fn().mockResolvedValue(record({ status: 'SUBMITTED', votingWindowDays: 5 })),
        update,
      },
    };
    await caller(db).updateStatus({ id: 'prop_1', status: 'votable' });
    const endsAt: Date = update.mock.calls[0][0].data.votingEndsAt;
    expect(endsAt.getTime()).toBeGreaterThanOrEqual(before + 5 * DAY);
    expect(endsAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * DAY);
  });
});

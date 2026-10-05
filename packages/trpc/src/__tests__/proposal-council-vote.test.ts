import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/admin-verification.js', () => ({
  checkAdminStatusWithRole: vi.fn().mockResolvedValue({ isAdmin: true, role: 'admin' }),
}));

import { proposalRouter } from '../routers/proposal.js';

const WALLET = '0x1234567890123456789012345678901234567890';

function makeDb(status: string) {
  return {
    proposal: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'prop_1',
        coopId: 'cahootz',
        councilRequired: true,
        status,
      }),
      update: vi.fn(),
    },
    proposalVote: {
      upsert: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function caller(db: ReturnType<typeof makeDb>) {
  return proposalRouter.createCaller({
    db,
    req: { headers: { 'x-wallet-address': WALLET } },
    res: {},
    coopId: 'cahootz',
  } as any);
}

describe('proposal.councilVote', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['APPROVED', 'REJECTED', 'FUNDED', 'FAILED', 'WITHDRAWN'])(
    'refuses a vote once the proposal is %s, without recording it',
    async (status) => {
      const db = makeDb(status);
      await expect(caller(db).councilVote({ proposalId: 'prop_1', vote: 'FOR' })).rejects.toThrow(
        'Voting on this proposal has closed.',
      );
      expect(db.proposalVote.upsert).not.toHaveBeenCalled();
      expect(db.proposal.update).not.toHaveBeenCalled();
    },
  );

  it('records a vote while the proposal is open', async () => {
    const db = makeDb('VOTABLE');
    const result = await caller(db).councilVote({ proposalId: 'prop_1', vote: 'AGAINST' });
    expect(db.proposalVote.upsert).toHaveBeenCalledTimes(1);
    expect(result.vote).toBe('AGAINST');
  });
});

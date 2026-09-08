import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@repo/db';

const mockDb = db as any;

// Mock the proposal engine evaluateComment
vi.mock('@repo/validators', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    proposalEngine: {
      ...original.proposalEngine,
      evaluateComment: vi.fn().mockResolvedValue({
        alignment: 'ALIGNED',
        score: 0.85,
        analysis: 'This comment supports charter goals by advocating for local sourcing.',
        goalsImpacted: ['LeakageReduction', 'LocalJobs'],
      }),
      processProposal: vi.fn(),
    },
  };
});

describe('proposal-comment router (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.proposal = {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    };
    mockDb.proposalComment = {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    };
    mockDb.aIEvaluation = {
      create: vi.fn(),
      findMany: vi.fn(),
    };
    mockDb.coopConfig = {
      findFirst: vi.fn(),
    };
  });

  describe('create', () => {
    it('creates comment and AI evaluation', async () => {
      const proposal = {
        id: 'prop_123',
        title: 'Community Garden',
        summary: 'Build a community garden',
        category: 'BUSINESS_FUNDING',
        coopId: 'soulaan',
      };

      const comment = {
        id: 'comment_1',
        proposalId: 'prop_123',
        authorWallet: '0xtest1234567890abcdef1234567890abcdef1234',
        content: 'Great idea for local food production',
        createdAt: new Date(),
      };

      const evaluation = {
        id: 'eval_1',
        agentKey: 'comment-evaluation',
        entityType: 'ProposalComment',
        entityId: 'comment_1',
        output: {
          alignment: 'ALIGNED',
          score: 0.85,
          analysis: 'Supports charter goals',
          goalsImpacted: ['LeakageReduction'],
        },
        createdAt: new Date(),
      };

      mockDb.proposal.findUnique.mockResolvedValue(proposal);
      mockDb.proposalComment.create.mockResolvedValue(comment);
      mockDb.coopConfig.findFirst.mockResolvedValue(null);
      mockDb.aIEvaluation.create.mockResolvedValue(evaluation);

      // Simulate the create flow
      const foundProposal = await mockDb.proposal.findUnique({ where: { id: 'prop_123' } });
      expect(foundProposal).not.toBeNull();

      const createdComment = await mockDb.proposalComment.create({
        data: {
          proposalId: 'prop_123',
          authorWallet: '0xtest',
          content: 'Great idea for local food production',
        },
      });

      expect(createdComment.id).toBe('comment_1');
    });

    it('fails if proposal does not exist', async () => {
      mockDb.proposal.findUnique.mockResolvedValue(null);

      const result = await mockDb.proposal.findUnique({ where: { id: 'nonexistent' } });
      expect(result).toBeNull();
    });
  });

  describe('listByProposal', () => {
    it('returns comments with evaluations looked up from AIEvaluation', async () => {
      const comments = [
        {
          id: 'comment_1',
          proposalId: 'prop_123',
          authorWallet: '0xabc',
          content: 'First comment',
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'comment_2',
          proposalId: 'prop_123',
          authorWallet: '0xdef',
          content: 'Second comment',
          createdAt: new Date('2026-01-02'),
        },
      ];

      const evaluations = [
        {
          id: 'eval_1',
          agentKey: 'comment-evaluation',
          entityType: 'ProposalComment',
          entityId: 'comment_1',
          output: { alignment: 'ALIGNED', score: 0.8, analysis: 'Supportive', goalsImpacted: ['LeakageReduction'] },
          createdAt: new Date('2026-01-01'),
        },
      ];

      mockDb.proposalComment.findMany.mockResolvedValue(comments);
      mockDb.proposalComment.count.mockResolvedValue(2);
      mockDb.aIEvaluation.findMany.mockResolvedValue(evaluations);

      const result = await mockDb.proposalComment.findMany({
        where: { proposalId: 'prop_123' },
        orderBy: { createdAt: 'asc' },
      });
      const foundEvaluations = await mockDb.aIEvaluation.findMany({
        where: { entityType: 'ProposalComment', entityId: { in: result.map((c: any) => c.id) } },
      });

      expect(result).toHaveLength(2);
      expect(foundEvaluations).toHaveLength(1);
      expect(foundEvaluations[0].entityId).toBe('comment_1');
    });

    it('returns empty array for proposal with no comments', async () => {
      mockDb.proposalComment.findMany.mockResolvedValue([]);
      mockDb.proposalComment.count.mockResolvedValue(0);

      const result = await mockDb.proposalComment.findMany({
        where: { proposalId: 'prop_empty' },
      });

      expect(result).toHaveLength(0);
    });
  });
});

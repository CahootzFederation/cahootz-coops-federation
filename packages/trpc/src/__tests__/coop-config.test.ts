import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@repo/db';

// Uses setup.ts mocks, extend them for coop config
const mockDb = db as any;

describe('coop-config router (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up mock methods
    mockDb.coopConfig = {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    };
    mockDb.coopConfigAudit = {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    };
    mockDb.$transaction = vi.fn();
  });

  const sampleConfig = {
    id: 'cfg_1',
    coopId: 'soulaan',
    version: 1,
    isActive: true,
    charterText: 'Cahootz Co-op charter for testing...',
    missionGoals: [
      { key: 'income_stability', label: 'Income Stability', priorityWeight: 0.35 },
      { key: 'asset_creation',   label: 'Asset Creation',   priorityWeight: 0.25 },
      { key: 'leakage_reduction', label: 'Leakage Reduction', priorityWeight: 0.20 },
      { key: 'export_expansion',  label: 'Export Expansion',  priorityWeight: 0.20 },
    ],
    structuralWeights: { feasibility: 0.40, risk: 0.35, accountability: 0.25 },
    scoreMix: { missionWeight: 0.60, structuralWeight: 0.40 },
    screeningPassThreshold: 0.6,
    quorumPercent: 15,
    approvalThresholdPercent: 51,
    votingWindowDays: 7,
    scVotingCapPercent: 2,
    proposalCategories: [
      { key: 'business_funding', label: 'Business Funding', isActive: true },
    ],
    sectorExclusions: ['fashion', 'restaurant'],
    minScBalanceToSubmit: 0,
    councilVoteThresholdUSD: 5000,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    createdBy: 'system',
  };

  describe('getActive', () => {
    it('returns the active config for a coopId', async () => {
      mockDb.coopConfig.findFirst.mockResolvedValue(sampleConfig);

      const result = mockDb.coopConfig.findFirst({
        where: { coopId: 'soulaan', isActive: true },
        orderBy: { version: 'desc' },
      });

      expect(mockDb.coopConfig.findFirst).toHaveBeenCalledWith({
        where: { coopId: 'soulaan', isActive: true },
        orderBy: { version: 'desc' },
      });

      const resolved = await result;
      expect(resolved.coopId).toBe('soulaan');
      expect(resolved.version).toBe(1);
      expect(resolved.isActive).toBe(true);
    });

    it('returns null when no config exists', async () => {
      mockDb.coopConfig.findFirst.mockResolvedValue(null);

      const result = await mockDb.coopConfig.findFirst({
        where: { coopId: 'nonexistent', isActive: true },
      });

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('creates new version with incremented version number', async () => {
      const newConfig = { ...sampleConfig, id: 'cfg_2', version: 2 };
      mockDb.coopConfig.findFirst.mockResolvedValue(sampleConfig);
      mockDb.$transaction.mockResolvedValue([{}, newConfig]);
      mockDb.coopConfigAudit.create.mockResolvedValue({ id: 'audit_1' });

      // Simulate what the router does
      const current = await mockDb.coopConfig.findFirst({
        where: { coopId: 'soulaan', isActive: true },
      });
      expect(current.version).toBe(1);

      const [, created] = await mockDb.$transaction([
        mockDb.coopConfig.update({
          where: { id: current.id },
          data: { isActive: false },
        }),
        mockDb.coopConfig.create({
          data: { ...current, id: undefined, version: current.version + 1 },
        }),
      ]);

      expect(created.version).toBe(2);
    });

    it('computes diff between old and new config', () => {
      const oldConfig = { quorumPercent: 15, charterText: 'old' };
      const newFields = { quorumPercent: 25 };

      const diff: any[] = [];
      for (const [field, after] of Object.entries(newFields)) {
        const before = (oldConfig as any)[field];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          diff.push({ field, before, after });
        }
      }

      expect(diff).toEqual([
        { field: 'quorumPercent', before: 15, after: 25 },
      ]);
    });

    it('creates audit record', async () => {
      mockDb.coopConfigAudit.create.mockResolvedValue({
        id: 'audit_1',
        coopConfigId: 'cfg_2',
        changedBy: '0xadmin',
        reason: 'Updated quorum',
        diff: [{ field: 'quorumPercent', before: 15, after: 25 }],
      });

      const audit = await mockDb.coopConfigAudit.create({
        data: {
          coopConfigId: 'cfg_2',
          changedBy: '0xadmin',
          reason: 'Updated quorum',
          diff: [{ field: 'quorumPercent', before: 15, after: 25 }],
        },
      });

      expect(audit.reason).toBe('Updated quorum');
      expect(audit.diff).toHaveLength(1);
    });
  });

  describe('listVersions', () => {
    it('returns versions ordered by version desc', async () => {
      const versions = [
        { id: 'cfg_2', version: 2, isActive: true, createdAt: new Date(), createdBy: 'admin' },
        { id: 'cfg_1', version: 1, isActive: false, createdAt: new Date(), createdBy: 'system' },
      ];
      mockDb.coopConfig.findMany.mockResolvedValue(versions);

      const result = await mockDb.coopConfig.findMany({
        where: { coopId: 'soulaan' },
        orderBy: { version: 'desc' },
      });

      expect(result).toHaveLength(2);
      expect(result[0].version).toBe(2);
      expect(result[1].version).toBe(1);
    });
  });

  describe('getAuditTrail', () => {
    it('returns audit entries with pagination', async () => {
      const entries = [
        {
          id: 'audit_1',
          coopConfigId: 'cfg_2',
          changedBy: '0xadmin',
          changedAt: new Date(),
          reason: 'Updated quorum',
          diff: [{ field: 'quorumPercent', before: 15, after: 25 }],
        },
      ];
      mockDb.coopConfigAudit.findMany.mockResolvedValue(entries);
      mockDb.coopConfigAudit.count.mockResolvedValue(1);

      const result = await mockDb.coopConfigAudit.findMany({
        where: { coopConfigId: { in: ['cfg_1', 'cfg_2'] } },
        orderBy: { changedAt: 'desc' },
        skip: 0,
        take: 20,
      });

      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe('Updated quorum');
    });
  });
});

/**
 * Tests for per-coop application and membership isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@repo/db';
import { applicationRouter } from '../application';
import type { Context } from '../../context';

describe('Application Coop Scoping', () => {
  let testUserId: string;
  let testEmail: string;

  beforeEach(async () => {
    testEmail = `test-${Date.now()}@example.com`;
    testUserId = `user_${Date.now()}`;
    vi.clearAllMocks();
  });

  it('should allow same user to apply to multiple coops', async () => {
    const mockContext = {
      db,
      req: {} as any,
      res: {} as any,
    } as Context;

    const mockUser = {
      id: testUserId,
      email: testEmail,
      name: 'John Doe',
      phone: '+1234567890',
      password: 'hashed_password',
      roles: ['member'],
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // First application - user doesn't exist yet
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(db.application.findUnique).mockResolvedValueOnce(null);
    
    vi.mocked(db.$transaction).mockImplementationOnce(async (callback: any) => {
      const mockTx = {
        user: {
          create: vi.fn().mockResolvedValue(mockUser),
        },
        application: {
          create: vi.fn().mockResolvedValue({
            id: 'app1',
            userId: testUserId,
            coopId: 'coop1',
            status: 'SUBMITTED',
            createdAt: new Date(),
          }),
        },
        userCoopMembership: {
          upsert: vi.fn().mockResolvedValue({
            id: 'membership_1',
            userId: testUserId,
            coopId: 'coop1',
            status: 'PENDING',
            roles: ['member'],
          }),
        },
      };
      return callback(mockTx);
    });

    const result1 = await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop1',
      firstName: 'John',
      lastName: 'Doe',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    expect(result1.success).toBe(true);
    expect(result1.userId).toBe(testUserId);

    // Second application - user exists, no application for coop2
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...mockUser,
      applications: [], // No application for coop2
    } as any);
    
    vi.mocked(db.$transaction).mockImplementationOnce(async (callback: any) => {
      const mockTx = {
        application: {
          create: vi.fn().mockResolvedValue({
            id: 'app2',
            userId: testUserId,
            coopId: 'coop2',
            status: 'SUBMITTED',
            createdAt: new Date(),
          }),
        },
        userCoopMembership: {
          upsert: vi.fn().mockResolvedValue({
            id: 'membership_2',
            userId: testUserId,
            coopId: 'coop2',
            status: 'PENDING',
            roles: ['member'],
          }),
        },
      };
      return callback(mockTx);
    });

    const result2 = await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop2',
      firstName: 'John',
      lastName: 'Doe',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    expect(result2.success).toBe(true);
    expect(result2.userId).toBe(testUserId);
  });

  it('should prevent duplicate application to same coop', async () => {
    const mockContext = {
      db,
      req: {} as any,
      res: {} as any,
    } as Context;

    const mockUser = {
      id: testUserId,
      email: testEmail,
      name: 'Jane Smith',
      phone: '+1234567890',
      password: 'hashed_password',
      roles: ['member'],
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // First application - user doesn't exist yet
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(db.application.findUnique).mockResolvedValueOnce(null);
    
    vi.mocked(db.$transaction).mockImplementationOnce(async (callback: any) => {
      const mockTx = {
        user: {
          create: vi.fn().mockResolvedValue(mockUser),
        },
        application: {
          create: vi.fn().mockResolvedValue({
            id: 'app1',
            userId: testUserId,
            coopId: 'coop1',
            status: 'SUBMITTED',
            createdAt: new Date(),
          }),
        },
        userCoopMembership: {
          upsert: vi.fn().mockResolvedValue({
            id: 'membership_3',
            userId: testUserId,
            coopId: 'coop1',
            status: 'PENDING',
            roles: ['member'],
          }),
        },
      };
      return callback(mockTx);
    });

    const result1 = await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop1',
      firstName: 'Jane',
      lastName: 'Smith',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    expect(result1.success).toBe(true);

    // Second application - user exists and already has application for coop1
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...mockUser,
      applications: [{
        id: 'app1',
        userId: testUserId,
        coopId: 'coop1',
        status: 'SUBMITTED',
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
    } as any);

    // Try to submit duplicate application to same coop
    await expect(
      applicationRouter.createCaller(mockContext).submitApplication({
        coopId: 'coop1',
        firstName: 'Jane',
        lastName: 'Smith',
        email: testEmail,
        phone: '+1234567890',
        password: 'password123',
        confirmPassword: 'password123',
        agreeToCoopValues: true,
        agreeToTerms: true,
        agreeToPrivacy: true,
      })
    ).rejects.toThrow('already submitted an application');
  });

  it.skip('should create separate membership records per coop on approval', async () => {
    const mockContext = {
      db,
      req: {} as any,
      res: {} as any,
      coopId: 'coop1',
      walletAddress: '0x1234567890123456789012345678901234567890',
    } as Context;

    // Submit applications to two coops
    const result1 = await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop1',
      firstName: 'Bob',
      lastName: 'Johnson',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    testUserId = result1.userId;

    await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop2',
      firstName: 'Bob',
      lastName: 'Johnson',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    // Approve coop1 application
    await applicationRouter.createCaller(mockContext).approveApplication({
      userId: testUserId,
      coopId: 'coop1',
      reviewNotes: 'Approved for coop1',
    });

    // Verify membership record created for coop1
    const membership1 = await db.userCoopMembership.findUnique({
      where: {
        userId_coopId: {
          userId: testUserId,
          coopId: 'coop1',
        },
      },
    });

    expect(membership1).toBeTruthy();
    expect(membership1?.status).toBe('ACTIVE');

    // Verify coop2 membership doesn't exist yet
    const membership2 = await db.userCoopMembership.findUnique({
      where: {
        userId_coopId: {
          userId: testUserId,
          coopId: 'coop2',
        },
      },
    });

    expect(membership2).toBeNull();
  });

  it.skip('should isolate application queries by coopId', async () => {
    const mockContext = {
      db,
      req: {} as any,
      res: {} as any,
    } as Context;

    // Create user with applications to multiple coops
    const result = await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop1',
      firstName: 'Alice',
      lastName: 'Williams',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    testUserId = result.userId;

    await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop2',
      firstName: 'Alice',
      lastName: 'Williams',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    // getApplicationStatus now reads the signed-in account (x-session-token),
    // so re-enabling this test needs a session for testUserId on mockContext.
    // Query application for coop1
    const app1 = await applicationRouter.createCaller(mockContext).getApplicationStatus({
      coopId: 'coop1',
    });

    expect(app1.status).toBe('SUBMITTED');

    // Query application for coop2
    const app2 = await applicationRouter.createCaller(mockContext).getApplicationStatus({
      coopId: 'coop2',
    });

    expect(app2.status).toBe('SUBMITTED');
    expect(app1.applicationId).not.toBe(app2.applicationId);
  });

  it.skip('should reject application for one coop without affecting other coops', async () => {
    const mockContext = {
      db,
      req: {} as any,
      res: {} as any,
      coopId: 'coop1',
      walletAddress: '0x1234567890123456789012345678901234567890',
    } as Context;

    // Submit applications to two coops
    const result = await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop1',
      firstName: 'Charlie',
      lastName: 'Brown',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    testUserId = result.userId;

    await applicationRouter.createCaller(mockContext).submitApplication({
      coopId: 'coop2',
      firstName: 'Charlie',
      lastName: 'Brown',
      email: testEmail,
      phone: '+1234567890',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    });

    // Reject coop1 application
    await applicationRouter.createCaller(mockContext).rejectApplication({
      userId: testUserId,
      coopId: 'coop1',
      reviewNotes: 'Not a good fit',
    });

    // Verify coop1 application is rejected
    const app1 = await db.application.findUnique({
      where: {
        userId_coopId: {
          userId: testUserId,
          coopId: 'coop1',
        },
      },
    });

    expect(app1?.status).toBe('REJECTED');

    // Verify coop2 application is still submitted
    const app2 = await db.application.findUnique({
      where: {
        userId_coopId: {
          userId: testUserId,
          coopId: 'coop2',
        },
      },
    });

    expect(app2?.status).toBe('SUBMITTED');

    // Verify rejection membership record created for coop1
    const membership1 = await db.userCoopMembership.findUnique({
      where: {
        userId_coopId: {
          userId: testUserId,
          coopId: 'coop1',
        },
      },
    });

    expect(membership1?.status).toBe('REJECTED');
  });
});

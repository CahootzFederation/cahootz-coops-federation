import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appRouter } from '../routers/index.js';
import type { Context } from '../context.js';
import { sendApplicationSubmittedNotification } from '../services/slack-notification-service.js';

vi.mock('../services/slack-notification-service.js', () => ({
  sendApplicationSubmittedNotification: vi.fn().mockResolvedValue(undefined),
}));

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

// Mock Prisma client
const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  application: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  coopConfig: {
    findFirst: vi.fn().mockResolvedValue({ name: 'Test Coop' }),
  },
  $transaction: vi.fn(),
};

describe('Application Router - submitApplication', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    const mockContext: Context = {
      db: mockPrismaClient as any,
      req: {} as any,
      res: {} as any,
      coopId: 'soulaan',
    };
    
    caller = appRouter.createCaller(mockContext);
  });

  it('should successfully submit a valid application', async () => {
    // Arrange - Mock that user doesn't exist
    mockPrismaClient.user.findUnique.mockResolvedValue(null);
    
    // Mock transaction to return created user and application
    mockPrismaClient.$transaction.mockImplementation(async (callback) => {
      return callback({
        user: {
          create: vi.fn().mockResolvedValue({
            id: 'user_123',
            email: 'deon@appi.com',
            name: 'Deon Robinson',
            phone: '4159363880',
            role: 'user',
            status: 'PENDING',
          }),
        },
        application: {
          create: vi.fn().mockResolvedValue({
            id: 'app_456',
            userId: 'user_123',
            status: 'SUBMITTED',
            data: {},
            createdAt: new Date(),
          }),
        },
        userCoopMembership: {
          upsert: vi.fn().mockResolvedValue({
            id: 'membership_123',
            userId: 'user_123',
            coopId: 'soulaan',
            status: 'PENDING',
            roles: ['member'],
          }),
        },
      });
    });

    const validApplicationData = {
      coopId: 'soulaan',
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'deon@appi.com',
      phone: '4159363880',
      password: 'Radzell1',
      confirmPassword: 'Radzell1',
      identity: 'black-american' as const,
      agreeToMission: 'yes' as const,
      spendingCategories: ['Retail/Shopping'],
      monthlyCommitment: '500-1000' as const,
      useUC: 'yes' as const,
      acceptFees: 'yes' as const,
      voteOnInvestments: 'yes' as const,
      coopExperience: 'yes' as const,
      transparentTransactions: 'yes' as const,
      motivation: '',
      desiredService: '',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    };

    // Act
    const result = await caller.application.submitApplication(validApplicationData);

    // Assert
    expect(result).toEqual({
      success: true,
      message: 'Application submitted successfully. You will be notified once your application is reviewed.',
      applicationId: 'app_456',
      userId: 'user_123',
    });
    
    expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'deon@appi.com' },
      include: {
        applications: {
          where: { coopId: 'soulaan' },
        },
      },
    });
    
    expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    await flushPromises();
    expect(mockPrismaClient.coopConfig.findFirst).toHaveBeenCalledWith({
      where: { coopId: 'soulaan', isActive: true },
      select: { name: true },
    });
    expect(sendApplicationSubmittedNotification).toHaveBeenCalledWith({
      coopId: 'soulaan',
      coopName: 'Test Coop',
      applicantEmail: 'deon@appi.com',
      applicantName: 'Deon Robinson',
      applicationId: 'app_456',
    });
  });

  it('should reject application if user already applied to same coop', async () => {
    // Arrange - Mock that user already exists with an application for this coop
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'existing_user',
      email: 'deon@appi.com',
      applications: [{
        id: 'existing_app',
        userId: 'existing_user',
        coopId: 'soulaan',
        status: 'SUBMITTED',
      }],
    });

    const applicationData = {
      coopId: 'soulaan',
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'deon@appi.com',
      phone: '4159363880',
      password: 'Radzell1',
      confirmPassword: 'Radzell1',
      identity: 'black-american' as const,
      agreeToMission: 'yes' as const,
      spendingCategories: ['Retail/Shopping'],
      monthlyCommitment: '500-1000' as const,
      useUC: 'yes' as const,
      acceptFees: 'yes' as const,
      voteOnInvestments: 'yes' as const,
      coopExperience: 'yes' as const,
      transparentTransactions: 'yes' as const,
      motivation: '',
      desiredService: '',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    };

    // Act & Assert
    await expect(
      caller.application.submitApplication(applicationData)
    ).rejects.toThrow('already submitted an application');
    
    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
  });

  it('should reject application with mismatched passwords', async () => {
    const applicationData = {
      coopId: 'soulaan',
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'deon@appi.com',
      phone: '4159363880',
      password: 'Radzell1',
      confirmPassword: 'DifferentPassword',
      identity: 'black-american' as const,
      agreeToMission: 'yes' as const,
      spendingCategories: ['Retail/Shopping'],
      monthlyCommitment: '500-1000' as const,
      useUC: 'yes' as const,
      acceptFees: 'yes' as const,
      voteOnInvestments: 'yes' as const,
      coopExperience: 'yes' as const,
      transparentTransactions: 'yes' as const,
      motivation: '',
      desiredService: '',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    };

    // Act & Assert
    await expect(
      caller.application.submitApplication(applicationData)
    ).rejects.toThrow();
  });

  it('should reject application with invalid email', async () => {
    const applicationData = {
      coopId: 'soulaan',
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'invalid-email',
      phone: '4159363880',
      password: 'Radzell1',
      confirmPassword: 'Radzell1',
      identity: 'black-american' as const,
      agreeToMission: 'yes' as const,
      spendingCategories: ['Retail/Shopping'],
      monthlyCommitment: '500-1000' as const,
      useUC: 'yes' as const,
      acceptFees: 'yes' as const,
      voteOnInvestments: 'yes' as const,
      coopExperience: 'yes' as const,
      transparentTransactions: 'yes' as const,
      motivation: '',
      desiredService: '',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    };

    // Act & Assert
    await expect(
      caller.application.submitApplication(applicationData)
    ).rejects.toThrow();
  });

  it('should reject application with short password', async () => {
    const applicationData = {
      coopId: 'soulaan',
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'deon@appi.com',
      phone: '4159363880',
      password: 'short',
      confirmPassword: 'short',
      identity: 'black-american' as const,
      agreeToMission: 'yes' as const,
      spendingCategories: ['Retail/Shopping'],
      monthlyCommitment: '500-1000' as const,
      useUC: 'yes' as const,
      acceptFees: 'yes' as const,
      voteOnInvestments: 'yes' as const,
      coopExperience: 'yes' as const,
      transparentTransactions: 'yes' as const,
      motivation: '',
      desiredService: '',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    };

    // Act & Assert
    await expect(
      caller.application.submitApplication(applicationData)
    ).rejects.toThrow();
  });

  it('should accept optional fields as empty strings', async () => {
    // Arrange
    mockPrismaClient.user.findUnique.mockResolvedValue(null);
    mockPrismaClient.$transaction.mockImplementation(async (callback) => {
      return callback({
        user: {
          create: vi.fn().mockResolvedValue({
            id: 'user_123',
            email: 'deon@appi.com',
          }),
        },
        application: {
          create: vi.fn().mockResolvedValue({
            id: 'app_456',
            userId: 'user_123',
          }),
        },
        userCoopMembership: {
          upsert: vi.fn().mockResolvedValue({
            id: 'membership_123',
            userId: 'user_123',
            coopId: 'soulaan',
            status: 'PENDING',
            roles: ['member'],
          }),
        },
      });
    });

    const applicationData = {
      coopId: 'soulaan',
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'deon@appi.com',
      phone: '4159363880',
      password: 'Radzell1',
      confirmPassword: 'Radzell1',
      identity: 'black-american' as const,
      agreeToMission: 'yes' as const,
      spendingCategories: ['Retail/Shopping'],
      monthlyCommitment: '500-1000' as const,
      useUC: 'yes' as const,
      acceptFees: 'yes' as const,
      voteOnInvestments: 'yes' as const,
      coopExperience: 'yes' as const,
      transparentTransactions: 'yes' as const,
      motivation: '', // Empty optional field
      desiredService: '', // Empty optional field
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
    };

    // Act
    const result = await caller.application.submitApplication(applicationData);

    // Assert
    expect(result.success).toBe(true);
  });

  it('should submit Soulaan dynamic answers when a question id matches the default email field', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const txUserCreate = vi.fn().mockResolvedValue({
      id: 'user_789',
      email: 'applicant@example.com',
      name: 'Deon Robinson',
      phone: '+14159363880',
      role: 'user',
      status: 'PENDING',
    });
    const txApplicationCreate = vi.fn().mockResolvedValue({
      id: 'app_789',
      userId: 'user_789',
      status: 'SUBMITTED',
      data: {},
      createdAt: new Date(),
    });
    const txMembershipUpsert = vi.fn().mockResolvedValue({
      id: 'membership_789',
      userId: 'user_789',
      coopId: 'soulaan',
      status: 'PENDING',
      roles: ['member'],
    });

    mockPrismaClient.$transaction.mockImplementation(async (callback) => {
      return callback({
        user: {
          create: txUserCreate,
        },
        application: {
          create: txApplicationCreate,
        },
        userCoopMembership: {
          upsert: txMembershipUpsert,
        },
      });
    });

    const result = await caller.application.submitApplication({
      coopId: 'soulaan',
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'applicant@example.com',
      phone: '4159363880',
      password: 'password123',
      confirmPassword: 'password123',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
      dynamicAnswers: {
        fullName: 'Why do you want to join Soulaan Co-op?',
        email: ['Member', 'Ally'],
        occupation: 'Entrepreneur',
        whyJoin: 'I can bring organizing and business-building experience.',
        q_1778700311970: 'yes',
        q_1778700347312: 'A community business.',
        q_1778700361575: 'yes',
        q_1778700409302: 'yes',
        q_1778700436362: ['yes'],
        q_1778700460221: '',
      },
    });

    expect(result.success).toBe(true);
    expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'applicant@example.com' },
      include: {
        applications: {
          where: { coopId: 'soulaan' },
        },
      },
    });
    expect(txApplicationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user_789',
        coopId: 'soulaan',
        status: 'SUBMITTED',
        data: expect.objectContaining({
          email: 'applicant@example.com',
          phone: '+14159363880',
          dynamicAnswers: expect.objectContaining({
            email: ['Member', 'Ally'],
            fullName: 'Why do you want to join Soulaan Co-op?',
            q_1778700436362: ['yes'],
          }),
        }),
      },
    });
  });
});

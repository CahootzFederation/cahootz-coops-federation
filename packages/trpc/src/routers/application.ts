import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import type { Prisma } from "@repo/db";

import { Context, AuthenticatedContext } from "../context.js";
import { publicProcedure, privateProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { createWalletForUser } from "../services/wallet-service.js";
import { syncMembershipToContract } from "../services/blockchain.js";
import { toE164 } from "../lib/phone.js";
import { sendApplicationSubmittedNotification } from "../services/slack-notification-service.js";

// Backend wallet is now stored in CoopConfig per-coop

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Validation schema for application submission.
// Dynamic form answers are accepted under dynamicAnswers so question ids can
// overlap with reserved account fields like email without changing their type.
const applicationSchema = z.object({
  // Coop identification
  coopId: z.string().min(1, "Coop ID is required"),
  
  // Personal Information
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone number is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  
  // Media uploads (optional)
  videoCID: z.string().optional(),
  photoCID: z.string().optional(),

  // Co-op configured question answers
  dynamicAnswers: z.record(z.unknown()).optional(),
  
  // Terms Agreement
  agreeToCoopValues: z.boolean().refine(val => val === true, "Must agree to co-op values"),
  agreeToTerms: z.boolean().refine(val => val === true, "Must agree to terms of service"),
  agreeToPrivacy: z.boolean().refine(val => val === true, "Must agree to privacy policy"),
}).passthrough() // Allow additional dynamic fields from application questions
.refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const applicationRouter = router({
  /**
   * Submit a new application to join a co-op
   */
  submitApplication: publicProcedure
    .input(applicationSchema)
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      applicationId: z.string(),
      userId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      
      console.log('\n🔷 submitApplication - START');
      console.log('📧 Email:', input.email);
      console.log('🏢 Coop ID:', input.coopId);
      
      try {
        // Check if user already has an application for this coop
        console.log('🔍 Checking for existing user...');
        const existingUser = await context.db.user.findUnique({
          where: { email: input.email },
          include: {
            applications: {
              where: { coopId: input.coopId },
            },
          },
        });

        if (existingUser?.applications && existingUser.applications.length > 0) {
          console.log('❌ User already has an application for this coop');
          throw new TRPCError({
            code: "CONFLICT",
            message: "You have already submitted an application to this co-op",
          });
        }
        console.log('✅ No existing application found for this coop');

        // Hash the password
        console.log('🔒 Hashing password...');
        const hashedPassword = await bcrypt.hash(input.password, 12);
        console.log('✅ Password hashed');

        // Create user and application in a transaction
        console.log('💾 Starting database transaction...');
        const result = await context.db.$transaction(async (tx) => {
          let user = existingUser;
          
          // Create user if doesn't exist
          if (!user) {
            console.log('👤 Creating user...');
            // Normalize phone to E.164 format
            const normalizedPhone = toE164(input.phone);
            console.log(`📱 Phone: "${input.phone}" -> "${normalizedPhone}"`);

            user = await tx.user.create({
              data: {
                email: input.email,
                name: `${input.firstName} ${input.lastName}`,
                phone: normalizedPhone,
                password: hashedPassword,
                roles: ["member"],
                status: "PENDING",
              },
              include: {
                applications: true,
              },
            });
            console.log('✅ User created:', user.id);
          } else {
            console.log('✅ Using existing user:', user.id);
          }

          if (!user) {
            throw new Error('User is required but was not created or found');
          }

          // Create application with JSON data
          console.log('📝 Creating application...');
          
          // Extract password, confirmPassword, and coopId from input (don't store these in data)
          const { password, confirmPassword, coopId, dynamicAnswers, ...applicationData } = input;
          
          // Store all application data including dynamic question answers
          const application = await tx.application.create({
            data: {
              userId: user.id,
              coopId: input.coopId,
              status: "SUBMITTED",
              data: toJsonValue({
                ...applicationData,
                dynamicAnswers: dynamicAnswers ?? {},
                phone: user.phone, // Use normalized phone from user record
              }),
            },
          });
          console.log('✅ Application created:', application.id);

          // Create PENDING membership record for this coop
          console.log('👥 Creating PENDING membership record...');
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
              status: "PENDING",
              roles: ["member"],
            },
            update: {
              status: "PENDING",
            },
          });
          console.log('✅ PENDING membership record created');

          return { user, application };
        });
        console.log('✅ Transaction completed successfully');

        // Send Slack notification after the application is committed.
        // Keep this fully non-blocking so Slack or coop display lookups never fail a saved application.
        void (async () => {
          try {
            const coopConfig = await context.db.coopConfig.findFirst({
              where: { coopId: input.coopId, isActive: true },
              select: { name: true },
            });

            await sendApplicationSubmittedNotification({
              coopId: input.coopId,
              coopName: coopConfig?.name ?? undefined,
              applicantEmail: input.email,
              applicantName: `${input.firstName} ${input.lastName}`,
              applicationId: result.application.id,
            });
          } catch (err) {
            console.error('Failed to send Slack notification:', err);
          }
        })();

        const response = {
          success: true,
          message: "Application submitted successfully. You will be notified once your application is reviewed.",
          applicationId: result.application.id,
          userId: result.user.id,
        };
        console.log('🎉 submitApplication - SUCCESS');
        console.log('📤 Response:', response);
        return response;
      } catch (error) {
        console.error('\n💥 ERROR in submitApplication:');
        console.error('Error type:', error?.constructor?.name);
        console.error('Error message:', error instanceof Error ? error.message : String(error));
        console.error('Full error:', error);
        
        if (error instanceof Error && 'code' in error) {
          console.error('Error code:', (error as Error & { code: unknown }).code);
        }
        
        if (error instanceof TRPCError) {
          console.error('🚨 Throwing TRPCError:', error.code, error.message);
          throw error;
        }
        
        console.error('🚨 Throwing generic INTERNAL_SERVER_ERROR');
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to submit application. Please try again.",
          cause: error,
        });
      }
    }),

  /**
   * Get application status by user ID and coop ID
   */
  getApplicationStatus: publicProcedure
    .input(z.object({ 
      userId: z.string(),
      coopId: z.string(),
    }))
    .output(z.object({
      status: z.string(),
      applicationId: z.string(),
      submittedAt: z.string(),
      reviewedAt: z.string().optional(),
      reviewNotes: z.string().optional(),
      data: z.any().optional(), // Include application data
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      
      const application = await context.db.application.findUnique({
        where: { 
          userId_coopId: {
            userId: input.userId,
            coopId: input.coopId,
          },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          reviewNotes: true,
          data: true,
        },
      });

      if (!application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      return {
        status: application.status,
        applicationId: application.id,
        submittedAt: application.createdAt.toISOString(),
        reviewedAt: application.reviewedAt?.toISOString(),
        reviewNotes: application.reviewNotes ?? undefined,
        data: application.data,
      };
    }),

  /**
   * Get application data by user ID and coop ID (for admin/review purposes)
   */
  getApplicationData: publicProcedure
    .input(z.object({ 
      userId: z.string(),
      coopId: z.string(),
    }))
    .output(z.object({
      applicationId: z.string(),
      status: z.string(),
      data: z.any(),
      submittedAt: z.string(),
      reviewedAt: z.string().optional(),
      reviewNotes: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      
      const application = await context.db.application.findUnique({
        where: { 
          userId_coopId: {
            userId: input.userId,
            coopId: input.coopId,
          },
        },
      });

      if (!application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      return {
        applicationId: application.id,
        status: application.status,
        data: application.data,
        submittedAt: application.createdAt.toISOString(),
        reviewedAt: application.reviewedAt?.toISOString(),
        reviewNotes: application.reviewNotes ?? undefined,
      };
    }),

  /**
   * Approve an application (admin only)
   * Automatically creates a wallet for the user and membership record
   */
  approveApplication: privateProcedure
    .input(z.object({
      userId: z.string(),
      coopId: z.string(),
      reviewNotes: z.string().optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      walletAddress: z.string(),
      userId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress: reviewerWallet } = ctx as AuthenticatedContext;

      console.log('\n🔷 approveApplication - START');
      console.log('👤 User ID:', input.userId);
      console.log('🏢 Coop ID:', input.coopId);

      try {
        // Check if application exists
        console.log('🔍 Checking for application...');
        const application = await context.db.application.findUnique({
          where: { 
            userId_coopId: {
              userId: input.userId,
              coopId: input.coopId,
            },
          },
          include: { user: true },
        });

        if (!application) {
          console.log('❌ Application not found');
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Application not found for this user and coop",
          });
        }

        if (application.status === "APPROVED") {
          console.log('⚠️ Application already approved');
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Application is already approved",
          });
        }

        console.log('✅ Application found:', application.id);

        // Process approval in a transaction
        console.log('💾 Starting approval transaction...');
        const result = await context.db.$transaction(async (tx) => {
          // 1. Update application status to APPROVED
          console.log('📝 Updating application status to APPROVED...');
          await tx.application.update({
            where: { 
              userId_coopId: {
                userId: input.userId,
                coopId: input.coopId,
              },
            },
            data: {
              status: "APPROVED",
              reviewedAt: new Date(),
              reviewNotes: input.reviewNotes,
              reviewedBy: reviewerWallet,
            },
          });
          console.log('✅ Application approved');

          // 2. Create wallet for user (if they don't have one already)
          let walletAddress = application.user.walletAddress;

          if (!walletAddress) {
            console.log('🔐 Creating wallet for user...');
            walletAddress = await createWalletForUser(input.userId, tx);
            console.log('✅ Wallet created:', walletAddress);
          } else {
            walletAddress = await createWalletForUser(input.userId, tx);
            console.log('ℹ️ User already has wallet:', walletAddress);
          }

          // 3. Create or update membership record
          console.log('👥 Creating membership record...');
          await tx.userCoopMembership.upsert({
            where: {
              userId_coopId: {
                userId: input.userId,
                coopId: input.coopId,
              },
            },
            create: {
              userId: input.userId,
              coopId: input.coopId,
              status: "ACTIVE",
              roles: ["member"],
              approvedBy: reviewerWallet,
              approvedAt: new Date(),
              joinedAt: new Date(),
            },
            update: {
              status: "ACTIVE",
              approvedBy: reviewerWallet,
              approvedAt: new Date(),
              joinedAt: new Date(),
            },
          });
          console.log('✅ Membership record created');

          // 4. Update user status to ACTIVE (global status)
          console.log('👤 Updating user status to ACTIVE...');
          await tx.user.update({
            where: { id: input.userId },
            data: { status: "ACTIVE" },
          });
          console.log('✅ User status updated to ACTIVE');

          return { walletAddress };
        });

        console.log('✅ Transaction completed successfully');

        // 4. Sync membership to blockchain contract
        const backendWalletPrivateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;

        if (backendWalletPrivateKey && result.walletAddress) {
          console.log('⛓️ Syncing membership to SoulaaniCoin contract...');
          try {
            const syncResult = await syncMembershipToContract(
              result.walletAddress,
              'ACTIVE',
              backendWalletPrivateKey,
              input.coopId
            );
            if (syncResult.success) {
              console.log(`✅ Membership synced: ${syncResult.action}`);
              if (syncResult.txHash) {
                console.log(`   Transaction: ${syncResult.txHash}`);
              }
            } else {
              console.warn(`⚠️ Membership sync failed: ${syncResult.error}`);
              // Don't fail the approval, just log the warning
            }
          } catch (syncError) {
            console.warn('⚠️ Failed to sync membership to contract:', syncError);
            // Don't fail the approval, just log the warning
          }
        } else {
          console.warn('⚠️ Backend wallet private key not configured, skipping contract sync');
        }

        const response = {
          success: true,
          message: `Application approved. Wallet ${result.walletAddress} created for user.`,
          walletAddress: result.walletAddress,
          userId: input.userId,
        };

        console.log('🎉 approveApplication - SUCCESS');
        console.log('📤 Response:', response);
        return response;
      } catch (error) {
        console.error('\n💥 ERROR in approveApplication:');
        console.error('Error type:', error?.constructor?.name);
        console.error('Error message:', error instanceof Error ? error.message : String(error));
        console.error('Full error:', error);

        if (error instanceof TRPCError) {
          console.error('🚨 Throwing TRPCError:', error.code, error.message);
          throw error;
        }

        console.error('🚨 Throwing generic INTERNAL_SERVER_ERROR');
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to approve application. Please try again.",
          cause: error,
        });
      }
    }),

  /**
   * Reject an application (admin only)
   */
  rejectApplication: privateProcedure
    .input(z.object({
      userId: z.string(),
      coopId: z.string(),
      reviewNotes: z.string(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      userId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const { walletAddress } = ctx as AuthenticatedContext;

      console.log('\n🔷 rejectApplication - START');
      console.log('👤 User ID:', input.userId);
      console.log('🏢 Coop ID:', input.coopId);

      try {
        // Check if application exists
        const application = await context.db.application.findUnique({
          where: { 
            userId_coopId: {
              userId: input.userId,
              coopId: input.coopId,
            },
          },
        });

        if (!application) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Application not found for this user and coop",
          });
        }

        // Update application and membership in transaction
        await context.db.$transaction(async (tx) => {
          // Update application status to REJECTED
          await tx.application.update({
            where: { 
              userId_coopId: {
                userId: input.userId,
                coopId: input.coopId,
              },
            },
            data: {
              status: "REJECTED",
              reviewedAt: new Date(),
              reviewNotes: input.reviewNotes,
              reviewedBy: walletAddress,
            },
          });

          // Create or update membership record as REJECTED
          await tx.userCoopMembership.upsert({
            where: {
              userId_coopId: {
                userId: input.userId,
                coopId: input.coopId,
              },
            },
            create: {
              userId: input.userId,
              coopId: input.coopId,
              status: "REJECTED",
              rejectedBy: walletAddress,
              rejectedAt: new Date(),
            },
            update: {
              status: "REJECTED",
              rejectedBy: walletAddress,
              rejectedAt: new Date(),
            },
          });
        });

        console.log('✅ Application rejected');

        const response = {
          success: true,
          message: "Application rejected.",
          userId: input.userId,
        };

        console.log('🎉 rejectApplication - SUCCESS');
        return response;
      } catch (error) {
        console.error('\n💥 ERROR in rejectApplication:', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to reject application. Please try again.",
          cause: error,
        });
      }
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";

import { Context } from "../context.js";
import { publicProcedure, privateProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { sendLoginCode, generateLoginCode, isEmailConfigured } from "../lib/email.js";
import {
  COMMONS_COOP_ID,
  createAccountSession,
  ensureCommonsMembership,
  ensureUserHandle,
  getCoopSessionData,
} from "../lib/commons.js";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const DEMO_COOP_ID = "demo";
const DEMO_LOGIN_EMAIL = "demo@cahootz.coop";
const DEMO_LOGIN_CODE = "000000";
const isProduction = process.env.NODE_ENV === "production";
const deletedAccountMessage = "This account has been deleted. Contact support if you need help.";

function isDemoLogin(email: string, code?: string, coopId?: string) {
  if (normalizeEmail(email) !== DEMO_LOGIN_EMAIL) {
    return false;
  }

  if (coopId && DEMO_COOP_ID !== coopId) {
    return false;
  }

  return code === undefined || code === DEMO_LOGIN_CODE;
}

export const authRouter = router({
  /**
   * Login endpoint that checks user status
   */
  login: publicProcedure
    .input(z.object({
      email: z.string().email("Invalid email address"),
      password: z.string().min(1, "Password is required"),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      user: z.object({
        id: z.string(),
        email: z.string(),
        handle: z.string(),
        name: z.string().nullable(),
        roles: z.array(z.string()),
        status: z.string(),
        walletAddress: z.string().nullable(),
        phone: z.string().nullable(),
        createdAt: z.date(),
        selfDescription: z.string().nullable(),
        shortTermGoals: z.string().nullable(),
        longTermGoals: z.string().nullable(),
        skills: z.array(z.string()),
        interests: z.array(z.string()),
        resourcesOffered: z.array(z.string()),
        resourcesNeeded: z.array(z.string()),
        businessSummary: z.string().nullable(),
        locationSummary: z.string().nullable(),
        profileSignals: z.any(),
        profileOnboardingCompletedAt: z.date().nullable(),
        sessionToken: z.string().optional(),
        coop: z.object({
          id: z.string(),
          name: z.string(),
          shortName: z.string(),
          apiUrl: z.string(),
          webUrl: z.string(),
          primaryColor: z.string().optional(),
          accentColor: z.string().optional(),
          logoUrl: z.string().optional(),
        }).optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      
      try {
        // Find user by email
        const user = await context.db.user.findUnique({
          where: { email: input.email },
        });

        if (!user) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }

        console.log('🔍 User logging in:', user);

        if (user.deletedAt) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: deletedAccountMessage,
          });
        }

        // Check if user has a password (should exist for new applications)
        if (!user.password) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(input.password, user.password);
        
        if (!isValidPassword) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }

        if (user.status === "REJECTED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your application was not approved. Please contact support for more information.",
          });
        }

        if (user.status === "SUSPENDED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your account has been suspended. Please contact support.",
          });
        }

        const activeUser =
          user.status === "PENDING"
            ? await context.db.user.update({
                where: { id: user.id },
                data: { status: "ACTIVE" },
              })
            : user;

        await ensureCommonsMembership(context.db, activeUser.id);
        const handle = await ensureUserHandle(context.db, activeUser);
        const sessionToken = await createAccountSession(
          context.db,
          context,
          activeUser.id,
        );
        const coopData = await getCoopSessionData(context.db, COMMONS_COOP_ID);

        // User is active, allow login
        return {
          success: true,
          message: "Login successful",
          user: {
            id: activeUser.id,
            email: activeUser.email,
            handle,
            name: activeUser.name,
            roles: activeUser.roles,
            status: activeUser.status,
            walletAddress: activeUser.walletAddress,
            phone: activeUser.phone,
            createdAt: activeUser.createdAt,
            selfDescription: activeUser.selfDescription,
            shortTermGoals: activeUser.shortTermGoals,
            longTermGoals: activeUser.longTermGoals,
            skills: activeUser.skills,
            interests: activeUser.interests,
            resourcesOffered: activeUser.resourcesOffered,
            resourcesNeeded: activeUser.resourcesNeeded,
            businessSummary: activeUser.businessSummary,
            locationSummary: activeUser.locationSummary,
            profileSignals: activeUser.profileSignals,
            profileOnboardingCompletedAt: activeUser.profileOnboardingCompletedAt,
            sessionToken,
            coop: coopData,
          },
        };
      } catch (error) {
        console.error("Login error:", error);
        
        if (error instanceof TRPCError) {
          throw error;
        }
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Login failed. Please try again.",
        });
      }
    }),

  /**
   * Check if user can login (status check)
   */
  checkLoginStatus: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .output(z.object({
      canLogin: z.boolean(),
      status: z.string(),
      message: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      
      const user = await context.db.user.findUnique({
        where: { email: input.email },
        select: { status: true, deletedAt: true },
      });

      if (!user) {
        return {
          canLogin: false,
          status: "NOT_FOUND",
          message: "User not found",
        };
      }

      if (user.deletedAt) {
        return {
          canLogin: false,
          status: "DELETED",
          message: deletedAccountMessage,
        };
      }

      switch (user.status) {
        case "ACTIVE":
          return {
            canLogin: true,
            status: user.status,
            message: "Account is active",
          };
        case "PENDING":
          return {
            canLogin: true,
            status: user.status,
            message: "Account can use Cahootz Commons",
          };
        case "REJECTED":
          return {
            canLogin: false,
            status: user.status,
            message: "Application was not approved",
          };
        case "SUSPENDED":
          return {
            canLogin: false,
            status: user.status,
            message: "Account is suspended",
          };
        default:
          return {
            canLogin: false,
            status: user.status,
            message: "Unknown status",
          };
      }
    }),

  /**
   * Request login code (passwordless authentication)
   */
  requestLoginCode: publicProcedure
    .input(z.object({
      email: z.string().email("Invalid email address"),
      coopId: z.string().min(1).optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      try {
        const email = normalizeEmail(input.email);
        const isCommonsLogin = !input.coopId || input.coopId === COMMONS_COOP_ID;

        let user = await context.db.user.findUnique({
          where: { email },
          select: {
            id: true,
            status: true,
            deletedAt: true,
            walletAddress: true,
            wallets: {
              where: { isPrimary: true },
              select: { address: true },
              take: 1,
            },
            memberships: {
              ...(input.coopId ? { where: { coopId: input.coopId } } : {}),
              select: { status: true },
              take: 1,
            },
          },
        });

        if (!user && isCommonsLogin) {
          user = await context.db.user.create({
            data: {
              email,
              roles: ["member"],
              status: "ACTIVE",
            },
            select: {
              id: true,
              status: true,
              deletedAt: true,
              walletAddress: true,
              wallets: {
                where: { isPrimary: true },
                select: { address: true },
                take: 1,
              },
              memberships: {
                where: { coopId: COMMONS_COOP_ID },
                select: { status: true },
                take: 1,
              },
            },
          });
        }

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No account found with this email address",
          });
        }

        if (user.deletedAt) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: deletedAccountMessage,
          });
        }

        if (user.status === "REJECTED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your application was not approved. Please contact support for more information.",
          });
        }

        if (user.status === "SUSPENDED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your account has been suspended. Please contact support.",
          });
        }

        if (isCommonsLogin) {
          await context.db.user.updateMany({
            where: { id: user.id, status: "PENDING" },
            data: { status: "ACTIVE" },
          });
          await ensureCommonsMembership(context.db, user.id);
        }

        if (input.coopId && input.coopId !== COMMONS_COOP_ID) {
          const membership = user.memberships[0];
          const hasWallet = !!(user.walletAddress || user.wallets[0]?.address);

          if (!membership || membership.status !== "ACTIVE" || !hasWallet) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "No active portal account was found for that email.",
            });
          }
        }

        const coopConfig = input.coopId
          ? await context.db.coopConfig.findFirst({
              where: { coopId: input.coopId, isActive: true },
              orderBy: { version: "desc" },
              select: { name: true },
            })
          : null;

        if (isDemoLogin(email, undefined, input.coopId)) {
          return {
            success: true,
            message: "Login code sent to your email",
          };
        }

        // Generate 6-digit code
        const code = generateLoginCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store code in database
        await context.db.loginCode.create({
          data: {
            email: input.email.toLowerCase(),
            code,
            expiresAt,
          },
        });

        // In production, attempt the send so failures are reported instead of
        // returning "sent" when Resend is missing or broken.
        if (isEmailConfigured() || isProduction) {
          await sendLoginCode(email, code, coopConfig?.name);
        } else {
          // In development, log the code to console
          console.log(`[DEV] Login code for ${email}: ${code}`);
        }

        return {
          success: true,
          message: "Login code sent to your email",
        };
      } catch (error) {
        console.error("Request login code error:", error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send login code. Please try again.",
        });
      }
    }),

  /**
   * Verify login code and authenticate user
   */
  verifyLoginCode: publicProcedure
    .input(z.object({
      email: z.string().email("Invalid email address"),
      code: z.string().length(6, "Code must be 6 digits"),
      coopId: z.string().min(1).optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      user: z.object({
        id: z.string(),
        email: z.string(),
        handle: z.string(),
        name: z.string().nullable(),
        roles: z.array(z.string()),
        status: z.string(),
        walletAddress: z.string().nullable(),
        phone: z.string().nullable(),
        createdAt: z.date(),
        selfDescription: z.string().nullable(),
        shortTermGoals: z.string().nullable(),
        longTermGoals: z.string().nullable(),
        skills: z.array(z.string()),
        interests: z.array(z.string()),
        resourcesOffered: z.array(z.string()),
        resourcesNeeded: z.array(z.string()),
        businessSummary: z.string().nullable(),
        locationSummary: z.string().nullable(),
        profileSignals: z.any(),
        profileOnboardingCompletedAt: z.date().nullable(),
        sessionToken: z.string(),
        coop: z.object({
          id: z.string(),
          name: z.string(),
          shortName: z.string(),
          apiUrl: z.string(),
          webUrl: z.string(),
          primaryColor: z.string().optional(),
          accentColor: z.string().optional(),
          logoUrl: z.string().optional(),
        }).optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;

      try {
        const email = normalizeEmail(input.email);
        const isDemoCode = isDemoLogin(email, input.code, input.coopId);

        // Find the login code
        const loginCode = isDemoCode
          ? null
          : await context.db.loginCode.findFirst({
              where: {
                email,
                code: input.code,
                used: false,
                expiresAt: {
                  gt: new Date(), // Not expired
                },
              },
            });

        if (!loginCode && !isDemoCode) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid or expired code",
          });
        }

        // Mark code as used
        if (loginCode) {
          await context.db.loginCode.update({
            where: { id: loginCode.id },
            data: { used: true },
          });
        }

        const isCommonsLogin = !input.coopId || input.coopId === COMMONS_COOP_ID;

        // Get user with memberships (select only needed fields to avoid column-not-found errors)
        let user = await context.db.user.findUnique({
          where: { email },
          include: {
            memberships: {
              where: {
                status: "ACTIVE",
                ...(input.coopId
                  ? { coopId: input.coopId }
                  : { coopId: COMMONS_COOP_ID }),
              },
              orderBy: {
                joinedAt: 'desc',
              },
              take: 1,
              select: {
                coopId: true,
              },
            },
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        if (user.deletedAt) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: deletedAccountMessage,
          });
        }

        if (user.status === "SUSPENDED" || user.status === "REJECTED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account is not available",
          });
        }

        if (isCommonsLogin) {
          await context.db.user.updateMany({
            where: { id: user.id, status: "PENDING" },
            data: { status: "ACTIVE" },
          });
          await ensureCommonsMembership(context.db, user.id);

          user = await context.db.user.findUniqueOrThrow({
            where: { id: user.id },
            include: {
              memberships: {
                where: {
                  status: "ACTIVE",
                  coopId: COMMONS_COOP_ID,
                },
                orderBy: {
                  joinedAt: "desc",
                },
                take: 1,
                select: {
                  coopId: true,
                },
              },
            },
          });
        } else if (user.status !== "ACTIVE" || user.memberships.length === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No active portal account was found for that email.",
          });
        }

        const activeCoopId =
          user.memberships[0]?.coopId ||
          (isDemoCode ? DEMO_COOP_ID : COMMONS_COOP_ID);
        const coopData = await getCoopSessionData(context.db, activeCoopId);
        const handle = await ensureUserHandle(context.db, user);
        const sessionToken = await createAccountSession(
          context.db,
          context,
          user.id,
        );

        return {
          success: true,
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            handle,
            name: user.name,
            roles: user.roles,
            status: user.status,
            walletAddress: user.walletAddress,
            phone: user.phone,
            createdAt: user.createdAt,
            selfDescription: user.selfDescription,
            shortTermGoals: user.shortTermGoals,
            longTermGoals: user.longTermGoals,
            skills: user.skills,
            interests: user.interests,
            resourcesOffered: user.resourcesOffered,
            resourcesNeeded: user.resourcesNeeded,
            businessSummary: user.businessSummary,
            locationSummary: user.locationSummary,
            profileSignals: user.profileSignals,
            profileOnboardingCompletedAt: user.profileOnboardingCompletedAt,
            sessionToken,
            coop: coopData,
          },
        };
      } catch (error) {
        console.error("Verify login code error:", error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Login failed. Please try again.",
        });
      }
    }),
});

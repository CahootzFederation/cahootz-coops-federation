import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";

import { Context } from "../context.js";
import { publicProcedure, privateProcedure } from "../procedures/index.js";
import { router } from "../trpc.js";
import { sendLoginCode, generateLoginCode, isEmailConfigured } from "../lib/email.js";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const DEMO_COOP_ID = "demo";
const DEMO_LOGIN_EMAIL = "demo@cahootz.coop";
const DEMO_LOGIN_CODE = "000000";

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
        name: z.string().nullable(),
        roles: z.array(z.string()),
        status: z.string(),
        walletAddress: z.string().nullable(),
        phone: z.string().nullable(),
        createdAt: z.date(),
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

        // Check user status
        if (user.status === "PENDING") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your application is still under review. You will be notified once it's approved.",
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

        // User is active, allow login
        return {
          success: true,
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles: user.roles,
            status: user.status,
            walletAddress: user.walletAddress,
            phone: user.phone,
            createdAt: user.createdAt,
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
        select: { status: true },
      });

      if (!user) {
        return {
          canLogin: false,
          status: "NOT_FOUND",
          message: "User not found",
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
            canLogin: false,
            status: user.status,
            message: "Application is under review",
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
        // Find user by email
        const email = normalizeEmail(input.email);

        const user = await context.db.user.findUnique({
          where: { email },
          select: {
            id: true,
            status: true,
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

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No account found with this email address",
          });
        }

        // Check user status
        if (user.status === "PENDING") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your application is still under review. You will be notified once it's approved.",
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

        if (input.coopId) {
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
            message: "Use the demo code to sign in.",
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

        // Send email with code (only if email is configured)
        if (isEmailConfigured()) {
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
        name: z.string().nullable(),
        roles: z.array(z.string()),
        status: z.string(),
        walletAddress: z.string().nullable(),
        phone: z.string().nullable(),
        createdAt: z.date(),
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

        // Get user with memberships (select only needed fields to avoid column-not-found errors)
        const user = await context.db.user.findUnique({
          where: { email },
          include: {
            memberships: {
              where: {
                status: "ACTIVE",
                ...(isDemoCode ? { coopId: DEMO_COOP_ID } : {}),
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

        // Final status check
        if (user.status !== "ACTIVE") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account is not active",
          });
        }

        // Get coop membership data if available
        let coopData = undefined;
        if (user.memberships.length > 0) {
          const membership = user.memberships[0];
          
          // Get coop config
          const coopConfig = await context.db.coopConfig.findFirst({
            where: {
              coopId: membership.coopId,
              isActive: true,
            },
            orderBy: {
              version: 'desc',
            },
          });

          if (coopConfig) {
            coopData = {
              id: membership.coopId,
              name: coopConfig.name || membership.coopId,
              shortName: coopConfig.slug || membership.coopId,
              apiUrl: process.env.API_BASE_URL || 'https://soulaan-api-production.up.railway.app',
              webUrl: process.env.WEB_BASE_URL || 'https://www.soulaan.com',
              primaryColor: coopConfig.bgColor || undefined,
              accentColor: coopConfig.accentColor || undefined,
              logoUrl: undefined, // Not stored in CoopConfig yet
            };
          }
        }

        return {
          success: true,
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles: user.roles,
            status: user.status,
            walletAddress: user.walletAddress,
            phone: user.phone,
            createdAt: user.createdAt,
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

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Prisma } from "@repo/db";

import type { Context } from "../../context.js";
import { auditLogEntry } from "../../lib/audit.js";
import { requireActiveMember } from "../commons-membership.js";
import { DEAL_CATEGORIES, dealCategoryByKey } from "./categories.js";

type Db = Context["db"];

/** Recommendations per member per day, the same spirit as the invitation cap. */
export const MAX_REFERRALS_PER_DAY = 5;
const DAY_MS = 86_400_000;

const optional = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => (value ? value : undefined));

export const recommendBusinessSchema = z
  .object({
    coopId: z.string().min(1).max(100),
    businessName: z.string().trim().min(2, "Add the business's name.").max(120),
    category: z.string().max(40).optional(),
    description: optional(500),
    website: optional(300),
    email: optional(200),
    phone: optional(40),
    city: optional(100),
    state: optional(50),
    howKnown: optional(500),
    mayNameReferrer: z.boolean().default(false),
    confirmedPublicContact: z.literal(true, {
      errorMap: () => ({ message: "Confirm this is the business's public contact, or that they're OK being contacted." }),
    }),
  })
  .superRefine((input, ctx) => {
    if (!input.website && !input.email && !input.phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Add a website, email or phone so we can reach them." });
    }
    if (input.email && !z.string().email().safeParse(input.email).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "That email doesn't look right." });
    }
    if (input.category && input.category !== "other" && !dealCategoryByKey(input.category)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "Pick a category from the list." });
    }
  });
export type RecommendBusinessInput = z.input<typeof recommendBusinessSchema>;

export function normalizeEmail(email: string | undefined) {
  return email ? email.trim().toLowerCase() : null;
}

/** The lowercased host of a website, or of an email address that isn't a free mail provider. */
export function businessDomain(website?: string, email?: string): string | null {
  if (website) {
    try {
      const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
      return url.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      // Fall through to the email.
    }
  }
  const host = email?.split("@")[1]?.toLowerCase();
  const freeMail = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "live.com", "me.com"];
  return host && !freeMail.includes(host) ? host : null;
}

/**
 * A member recommends a local business that might give the Commons a deal.
 * One prospect per business: a second recommendation of the same business
 * (same email or website) adds a referral instead of a duplicate.
 */
export async function recommendBusiness(db: Db, userId: string, raw: RecommendBusinessInput, now = new Date()) {
  const input = recommendBusinessSchema.parse(raw);
  await requireActiveMember(db, userId, input.coopId);

  const recent = await db.vendorReferral.count({
    where: { referredByUserId: userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  if (recent >= MAX_REFERRALS_PER_DAY) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `You've recommended ${MAX_REFERRALS_PER_DAY} businesses today. Thank you! Try again tomorrow.`,
    });
  }

  const emailNormalized = normalizeEmail(input.email);
  const domain = businessDomain(input.website, input.email);
  const category = input.category && input.category !== "other" ? input.category : null;

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing =
      (emailNormalized ? await tx.vendorProspect.findUnique({ where: { emailNormalized } }) : null) ??
      (domain ? await tx.vendorProspect.findFirst({ where: { domain } }) : null);

    const prospect =
      existing ??
      (await tx.vendorProspect.create({
        data: {
          businessName: input.businessName,
          category,
          description: input.description,
          website: input.website,
          domain,
          email: input.email,
          emailNormalized,
          phone: input.phone,
          city: input.city,
          state: input.state,
          sourceType: "MEMBER_REFERRAL",
        },
      }));

    const alreadyReferred = await tx.vendorReferral.findUnique({
      where: { prospectId_referredByUserId: { prospectId: prospect.id, referredByUserId: userId } },
    });
    if (alreadyReferred) return { prospectId: prospect.id, duplicate: true as const, alreadyKnown: !!existing };

    await tx.vendorReferral.create({
      data: {
        prospectId: prospect.id,
        referredByUserId: userId,
        coopId: input.coopId,
        howKnown: input.howKnown,
        mayNameReferrer: input.mayNameReferrer,
        confirmedPublicContact: input.confirmedPublicContact,
      },
    });
    await tx.auditLog.create({
      data: auditLogEntry({
        actorId: userId,
        action: "VENDOR_REFERRAL_CREATED",
        resource: "VendorProspect",
        resourceId: prospect.id,
        metadata: { coopId: input.coopId, category, alreadyKnown: !!existing },
      }),
    });
    return { prospectId: prospect.id, duplicate: false as const, alreadyKnown: !!existing };
  });
}

/** A member's own recommendations, newest first. Never other members'. */
export async function listMyReferrals(db: Db, userId: string, coopId: string) {
  const referrals = await db.vendorReferral.findMany({
    where: { referredByUserId: userId, coopId },
    include: { prospect: { select: { businessName: true, category: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return referrals.map((referral) => ({
    id: referral.id,
    businessName: referral.prospect.businessName,
    categoryLabel: dealCategoryByKey(referral.prospect.category)?.label ?? null,
    // Members see a plain stage, not the internal pipeline.
    stage: ["INTERESTED", "IN_TALKS"].includes(referral.prospect.status)
      ? "Talking with them"
      : referral.prospect.status === "CONVERTED"
        ? "Deal is live"
        : "Thanks! We'll take a look",
    createdAt: referral.createdAt,
  }));
}

export function dealCategoryOptions() {
  return [...DEAL_CATEGORIES.map((category) => ({ key: category.key, label: category.label })), { key: "other", label: "Something else" }];
}

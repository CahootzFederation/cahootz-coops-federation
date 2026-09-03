import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@repo/db";

import type { AccountAuthenticatedContext, Context } from "../context.js";
import {
  accountAuthenticatedProcedure,
  publicProcedure,
} from "../procedures/index.js";
import { COMMONS_COOP_ID, ensureCommonsMembership } from "../lib/commons.js";
import { toE164 } from "../lib/phone.js";
import {
  sendApplicationSubmittedNotification,
  sendCommonsSuggestionNotification,
} from "../services/slack-notification-service.js";
import { createNotificationAndPush } from "../services/push-notification-service.js";
import { router } from "../trpc.js";

const postTagSchema = z.enum([
  "Social",
  "Meme",
  "Win",
  "Need",
  "Idea",
  "Vote",
  "Resource",
  "Opportunity",
]);

const postMediaTypeSchema = z.enum(["image", "video"]);

const uploadedPostMediaSchema = z.object({
  pathname: z.string().min(1).max(1024),
  url: z.string().url(),
  mediaType: postMediaTypeSchema,
  mimeType: z.string().min(1).max(120),
  fileName: z.string().min(1).max(240).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationMs: z.number().int().positive().nullable().optional(),
  sizeBytes: z.number().int().positive().nullable().optional(),
});

type ApplicationQuestion = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
};

const getHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function isEmailQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return question.type === "email" || id === "email" || id.includes("email") || label.includes("email");
}

function isPhoneQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return question.type === "phone" || id === "phone" || id.includes("phone") || label.includes("phone");
}

function nameParts(name: string | null | undefined) {
  const trimmed = name?.trim() || "Cahootz Member";
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName: firstName || "Cahootz",
    lastName: rest.join(" ") || "Member",
  };
}

async function loadFeedPosts(db: any, coopId: string | string[], limit: number) {
  const coopIds = Array.isArray(coopId) ? coopId : [coopId];
  return db.commonsPost.findMany({
    where: coopIds.length === 1 ? { coopId: coopIds[0] } : { coopId: { in: coopIds } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      author: { select: { name: true, email: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 2,
        include: { author: { select: { name: true, email: true } } },
      },
      media: {
        orderBy: { order: "asc" },
      },
      _count: { select: { comments: true, supports: true } },
    },
  });
}

function displayName(user: { name: string | null; email: string }) {
  return user.name || user.email.split("@")[0] || "Commons member";
}

function relativeTime(date: Date) {
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function titleFromContent(content: string) {
  const cleaned = content.trim().replace(/\s+/g, " ");
  const sentence = cleaned.split(/[.!?]/)[0] || cleaned;
  return sentence.slice(0, 84) || "Community post";
}

function classifyPost(input: {
  title?: string;
  content: string;
  tag: z.infer<typeof postTagSchema>;
  mediaCount: number;
}) {
  const text = `${input.title || ""} ${input.content}`.toLowerCase();
  const hits: string[] = [];
  let classification = "social";

  const match = (label: string, terms: string[]) => {
    const found = terms.some((term) => text.includes(term));
    if (found) hits.push(label);
    return found;
  };

  if (input.tag === "Vote" || match("proposal", ["proposal", "vote", "decide", "approve", "policy"])) {
    classification = "proposal_seed";
  } else if (match("event", ["event", "meetup", "meeting", "pull up", "rsvp", "tomorrow", "tonight"])) {
    classification = "event";
  } else if (input.tag === "Need" || match("need", ["need", "looking for", "help with", "does anyone have", "who can"])) {
    classification = "need";
  } else if (input.tag === "Resource" || match("resource", ["resource", "template", "guide", "link", "toolkit"])) {
    classification = "resource";
  } else if (input.tag === "Opportunity" || match("market", ["job", "gig", "hiring", "selling", "available", "vendor", "client"])) {
    classification = "market";
  } else if (match("support", ["support", "congratulations", "proud", "show love", "celebrate"])) {
    classification = "support";
  } else if (input.tag === "Win") {
    classification = "win";
  } else if (input.tag === "Meme") {
    classification = "social";
    hits.push("meme");
  }

  return {
    classification,
    classificationConfidence: Math.min(0.95, 0.55 + hits.length * 0.12 + (input.mediaCount > 0 ? 0.05 : 0)),
    classificationSignals: toJsonValue({
      version: 1,
      source: "keyword_rule",
      matchedSignals: hits,
      tag: input.tag,
      mediaCount: input.mediaCount,
    }),
  };
}

function mapPostWithGroup(record: any, groupName: string) {
  return {
    id: record.id,
    coopId: record.coopId,
    author: displayName(record.author),
    group: groupName,
    time: relativeTime(record.createdAt),
    title: record.title,
    body: record.content,
    tag: record.tag,
    classification: record.classification ?? "social",
    replies: record._count?.comments ?? record.comments?.length ?? 0,
    support: record._count?.supports ?? record.supports?.length ?? 0,
    pledges: undefined as string | undefined,
    media:
      record.media?.map((item: any) => ({
        id: item.id,
        pathname: item.pathname,
        url: item.url,
        mediaType: item.mediaType,
        mimeType: item.mimeType,
        fileName: item.fileName,
        width: item.width,
        height: item.height,
        durationMs: item.durationMs,
        sizeBytes: item.sizeBytes,
      })) ?? [],
    comments:
      record.comments?.map((comment: any) => ({
        id: comment.id,
        author: displayName(comment.author),
        body: comment.content,
        media:
          comment.media?.map((item: any) => ({
            id: item.id,
            pathname: item.pathname,
            url: item.url,
            mediaType: item.mediaType,
            mimeType: item.mimeType,
            fileName: item.fileName,
            width: item.width,
            height: item.height,
            durationMs: item.durationMs,
            sizeBytes: item.sizeBytes,
          })) ?? [],
      })) ?? [],
  };
}

function mapCoopSummaryRecord(coopConfig: any, coopId: string) {
  const name = coopConfig?.name?.trim() || (coopId === COMMONS_COOP_ID ? "Cahootz Commons" : coopId);
  const description =
    coopConfig?.description?.trim() ||
    coopConfig?.tagline?.trim() ||
    coopConfig?.displayMission?.trim() ||
    "A social commons for conversation, resources, and coordinated action.";

  return {
    id: coopId,
    name,
    shortName: coopConfig?.slug?.trim() || name,
    description,
  };
}

async function loadCoopSummary(db: any, coopId: string) {
  const coopConfig = await db.coopConfig.findFirst({
    where: { coopId, isActive: true },
    orderBy: { version: "desc" },
    select: {
      coopId: true,
      name: true,
      slug: true,
      description: true,
      tagline: true,
      displayMission: true,
    },
  });

  return mapCoopSummaryRecord(coopConfig, coopId);
}

async function resolveOptionalAccountUser(context: Context) {
  const token = getHeaderValue(context.req.headers["x-session-token"]);
  if (!token) return null;

  const session = await context.db.session.findUnique({
    where: { token },
  });

  if (!session || session.isRevoked || session.expiresAt <= new Date()) {
    return null;
  }

  const user = await context.db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      deletedAt: true,
    },
  });

  return user && !user.deletedAt ? user : null;
}

async function hasActiveCommonsMembership(db: any, userId: string, coopId: string) {
  const membership = await db.userCoopMembership.findUnique({
    where: {
      userId_coopId: {
        userId,
        coopId,
      },
    },
    select: { status: true },
  });

  return membership?.status === "ACTIVE";
}

async function requireActiveCommonsMembership(db: any, userId: string, coopId: string) {
  if (coopId === COMMONS_COOP_ID) {
    await ensureCommonsMembership(db, userId);
    return;
  }

  const isMember = await hasActiveCommonsMembership(db, userId, coopId);
  if (!isMember) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Join this commons before posting here.",
    });
  }
}

function fallbackAiResponse(prompt: string) {
  const lower = prompt.toLowerCase();

  if (lower.includes("vote")) {
    return [
      "Start with the decision: what exactly should members choose?",
      "Then define options, deadline, eligible voters, budget impact, and who reports back.",
    ].join("\n");
  }

  if (
    lower.includes("cost") ||
    lower.includes("fund") ||
    lower.includes("money") ||
    lower.includes("$")
  ) {
    return [
      "Break this into money, time, space, tools, and people.",
      "A good next step is a small pledge list before turning it into a proposal.",
    ].join("\n");
  }

  if (
    lower.includes("proposal") ||
    lower.includes("plan") ||
    lower.includes("help")
  ) {
    return [
      "This can become a Commons thread first.",
      "Ask people to name the need, who is affected, what help exists, and the smallest useful pilot.",
    ].join("\n");
  }

  return [
    "I can help you turn this into action.",
    "Try framing it as: need, people affected, helpers, resources, decision needed, and first step.",
  ].join("\n");
}

async function runCommonsAi(prompt: string) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackAiResponse(prompt);
  }

  try {
    const agent = new Agent({
      name: "Cahootz Commons Assistant",
      model: process.env.COMMONS_AI_MODEL || "gpt-5.2",
      instructions: [
        "You are the general AI assistant inside Cahootz Commons, a community social network for coordinating help, proposals, votes, and shared resources.",
        "Answer in plain language and move conversation toward practical community action.",
        "When useful, organize answers into need, helpers, resources, decision, and next step.",
        "Do not pretend an anonymous visitor is a logged-in member.",
      ].join("\n"),
    });
    const result = (await run(agent, prompt)) as unknown as {
      finalOutput?: string;
      output?: string;
    };

    return result.finalOutput || result.output || fallbackAiResponse(prompt);
  } catch (error) {
    console.error("Commons AI failed:", error);
    return fallbackAiResponse(prompt);
  }
}

export const commonsRouter = router({
  listFeed: publicProcedure
    .input(
      z
        .object({
          coopId: z.string().min(1).default(COMMONS_COOP_ID),
          limit: z.number().min(1).max(50).default(20),
        })
        .default({ coopId: COMMONS_COOP_ID, limit: 20 }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      if (input.coopId === "all") {
        const accountUser = await resolveOptionalAccountUser(context);
        const coopIds = new Set<string>([COMMONS_COOP_ID]);

        if (accountUser) {
          const memberships = await context.db.userCoopMembership.findMany({
            where: {
              userId: accountUser.id,
              status: "ACTIVE",
            },
            select: { coopId: true },
          });
          memberships.forEach((membership: any) => coopIds.add(membership.coopId));
        }

        const activeCoopIds = [...coopIds];
        const posts = await loadFeedPosts(ctx.db, activeCoopIds, input.limit);

        const coopConfigs = await context.db.coopConfig.findMany({
          where: {
            coopId: { in: activeCoopIds },
            isActive: true,
          },
          select: {
            coopId: true,
            name: true,
            slug: true,
            description: true,
            tagline: true,
            displayMission: true,
          },
        });
        const coopNameById = new Map(
          coopConfigs.map((coopConfig: any) => [
            coopConfig.coopId,
            mapCoopSummaryRecord(coopConfig, coopConfig.coopId).name,
          ]),
        );

        return {
          coop: {
            id: "all",
            name: "Home",
            shortName: "Home",
            description: "Posts from every commons you are approved to access.",
          },
          posts: posts.map((post: any) =>
            mapPostWithGroup(post, coopNameById.get(post.coopId) || post.coopId),
          ),
        };
      }

      const coop = await loadCoopSummary(ctx.db, input.coopId);
      const accountUser = await resolveOptionalAccountUser(context);
      const canRead =
        input.coopId === COMMONS_COOP_ID ||
        (!!accountUser && (await hasActiveCommonsMembership(context.db, accountUser.id, input.coopId)));

      if (!canRead) {
        return { coop, posts: [] };
      }

      const posts = await loadFeedPosts(ctx.db, input.coopId, input.limit);

      return {
        coop,
        posts: posts.map((post: any) => mapPostWithGroup(post, coop.name)),
      };
    }),

  listDirectory: publicProcedure
    .query(async ({ ctx }) => {
      const context = ctx as Context;
      const accountUser = await resolveOptionalAccountUser(context);
      const coops = await context.db.coopConfig.findMany({
        where: {
          isActive: true,
          isDemo: false,
          name: { not: null },
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: {
          coopId: true,
          name: true,
          slug: true,
          tagline: true,
          description: true,
          displayMission: true,
          eligibility: true,
        },
      });
      const coopIds = coops.map((coop: any) => coop.coopId);
      const [memberships, applications] = accountUser
        ? await Promise.all([
            context.db.userCoopMembership.findMany({
              where: {
                userId: accountUser.id,
                coopId: { in: coopIds },
              },
              select: {
                coopId: true,
                status: true,
                roles: true,
              },
            }),
            context.db.application.findMany({
              where: {
                userId: accountUser.id,
                coopId: { in: coopIds },
              },
              select: {
                id: true,
                coopId: true,
                status: true,
                createdAt: true,
                reviewedAt: true,
              },
            }),
          ])
        : [[], []];

      const membershipByCoop = new Map(memberships.map((membership: any) => [membership.coopId, membership]));
      const applicationByCoop = new Map(applications.map((application: any) => [application.coopId, application]));

      return {
        coops: coops.map((coop: any) => {
          const membership = membershipByCoop.get(coop.coopId);
          const application = applicationByCoop.get(coop.coopId);
          const membershipStatus = membership?.status as string | undefined;
          const applicationStatus = application?.status as string | undefined;
          const accessStatus =
            membershipStatus === "ACTIVE"
              ? "ACTIVE"
              : membershipStatus === "PENDING" || applicationStatus === "SUBMITTED"
                ? "PENDING"
                : membershipStatus === "REJECTED" || applicationStatus === "REJECTED"
                  ? "REJECTED"
                  : "LOCKED";

          return {
            id: coop.coopId,
            name: coop.name,
            shortName: coop.slug || coop.name,
            tagline: coop.tagline,
            description:
              coop.description ||
              coop.displayMission ||
              "A commons for shared conversation, resources, and coordinated action.",
            mission: coop.displayMission,
            eligibility: coop.eligibility,
            accessStatus,
            isMember: accessStatus === "ACTIVE",
            isLocked: accessStatus !== "ACTIVE",
            canApply: accessStatus === "LOCKED",
            applicationId: application?.id || null,
            applicationStatus: applicationStatus || null,
          };
        }),
      };
    }),

  applyToCommons: accountAuthenticatedProcedure
    .input(
      z.object({
        coopId: z.string().min(1),
        displayName: z.string().trim().max(160).optional(),
        phone: z.string().trim().max(40).optional(),
        dynamicAnswers: z.record(z.unknown()).default({}),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
        applicationId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as AccountAuthenticatedContext;
      const user = context.accountUser;

      const coopConfig = await context.db.coopConfig.findFirst({
        where: { coopId: input.coopId, isActive: true },
        select: {
          name: true,
          applicationQuestions: true,
        },
      });

      if (!coopConfig) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Commons not found.",
        });
      }

      const existingApplication = await context.db.application.findUnique({
        where: {
          userId_coopId: {
            userId: user.id,
            coopId: input.coopId,
          },
        },
      });

      if (existingApplication) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You have already applied to this commons.",
        });
      }

      const questions = ((coopConfig.applicationQuestions as ApplicationQuestion[] | null) || []).filter(
        (question) => !isEmailQuestion(question),
      );
      const missingQuestions = questions
        .filter((question) => question.required)
        .filter((question) => {
          const answer = input.dynamicAnswers[question.id];
          return !answer || (Array.isArray(answer) && answer.length === 0);
        });

      if (missingQuestions.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Please answer: ${missingQuestions.map((question) => question.label).join(", ")}`,
        });
      }

      const phoneAnswer = questions.find(isPhoneQuestion)?.id;
      const phoneFromAnswer = phoneAnswer ? String(input.dynamicAnswers[phoneAnswer] || "") : "";
      const normalizedPhone = toE164(input.phone || phoneFromAnswer || user.phone);

      if (!normalizedPhone) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A phone number is required to apply.",
        });
      }

      const applicantName = input.displayName || user.name;
      const { firstName, lastName } = nameParts(applicantName);

      const application = await context.db.$transaction(async (tx) => {
        if (!user.phone) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              phone: normalizedPhone,
              name: user.name || `${firstName} ${lastName}`,
            },
          });
        }

        const createdApplication = await tx.application.create({
          data: {
            userId: user.id,
            coopId: input.coopId,
            status: "SUBMITTED",
            data: toJsonValue({
              firstName,
              lastName,
              email: user.email,
              phone: normalizedPhone,
              dynamicAnswers: input.dynamicAnswers,
            }),
          },
        });

        await ensureCommonsMembership(tx, user.id);

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
            status: input.coopId === COMMONS_COOP_ID ? "ACTIVE" : "PENDING",
            roles: ["member"],
            joinedAt: input.coopId === COMMONS_COOP_ID ? new Date() : undefined,
          },
          update: {
            status: input.coopId === COMMONS_COOP_ID ? "ACTIVE" : "PENDING",
          },
        });

        return createdApplication;
      });

      void sendApplicationSubmittedNotification({
        coopId: input.coopId,
        coopName: coopConfig.name ?? undefined,
        applicantEmail: user.email,
        applicantName: `${firstName} ${lastName}`,
        applicationId: application.id,
      }).catch((err) => {
        console.error("Failed to send Slack notification:", err);
      });

      return {
        success: true,
        message: "Application submitted successfully.",
        applicationId: application.id,
      };
    }),

  suggestCommons: publicProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
        name: z.string().trim().min(2).max(120),
        reason: z.string().trim().max(2000).optional(),
        email: z.string().trim().email(),
        suggestedByName: z.string().trim().max(120).optional(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        suggestionId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const context = ctx as Context;
      const accountUser = await resolveOptionalAccountUser(context);
      const suggestedByEmail = accountUser?.email || input.email.toLowerCase();
      const suggestedByName = accountUser?.name || input.suggestedByName || null;

      const suggestion = await context.db.commonsSuggestion.create({
        data: {
          coopId: input.coopId,
          name: input.name,
          reason: input.reason || null,
          suggestedByEmail,
          suggestedByName,
          userId: accountUser?.id || null,
        },
      });

      await sendCommonsSuggestionNotification({
        suggestionId: suggestion.id,
        coopId: suggestion.coopId,
        commonsName: suggestion.name,
        reason: suggestion.reason,
        suggestedByEmail: suggestion.suggestedByEmail,
        suggestedByName: suggestion.suggestedByName,
      });

      return { success: true, suggestionId: suggestion.id };
    }),

  listComments: publicProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const comments = await ctx.db.commonsComment.findMany({
        where: { postId: input.postId },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true, email: true } } },
      });

      return {
        comments: comments.map((comment) => ({
          id: comment.id,
          author: displayName(comment.author),
          body: comment.content,
        })),
      };
    }),

  getPost: publicProcedure
    .input(
      z.object({
        postId: z.string().min(1),
        coopId: z.string().min(1).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const context = ctx as Context;
      const post = await context.db.commonsPost.findUnique({
        where: { id: input.postId },
        include: {
          author: { select: { name: true, email: true } },
          media: {
            orderBy: { order: "asc" },
          },
          comments: {
            orderBy: { createdAt: "asc" },
            take: 100,
            include: {
              author: { select: { name: true, email: true } },
              media: { orderBy: { order: "asc" } },
            },
          },
          _count: { select: { comments: true, supports: true } },
        },
      });

      if (!post || (input.coopId && post.coopId !== input.coopId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Post not found.",
        });
      }

      const accountUser = await resolveOptionalAccountUser(context);
      const canRead =
        post.coopId === COMMONS_COOP_ID ||
        (!!accountUser && (await hasActiveCommonsMembership(context.db, accountUser.id, post.coopId)));

      if (!canRead) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Join this commons to view this post.",
        });
      }

      const coop = await loadCoopSummary(context.db, post.coopId);

      return {
        coop,
        post: mapPostWithGroup(post, coop.name),
      };
    }),

  ask: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        postId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let context = "";

      if (input.postId) {
        const post = await ctx.db.commonsPost.findUnique({
          where: { id: input.postId },
          include: {
            comments: {
              orderBy: { createdAt: "asc" },
              take: 10,
              include: { author: { select: { name: true, email: true } } },
            },
          },
        });

        if (post) {
          context = [
            `Thread title: ${post.title}`,
            `Thread body: ${post.content}`,
            "Recent comments:",
            ...post.comments.map(
              (comment) =>
                `${displayName(comment.author)}: ${comment.content}`,
            ),
          ].join("\n");
        }
      }

      const answer = await runCommonsAi(
        [input.prompt, context ? `\nContext:\n${context}` : ""].join(""),
      );

      return { answer };
    }),

  createPost: accountAuthenticatedProcedure
    .input(
      z.object({
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
        title: z.string().trim().min(1).max(120).optional(),
        content: z.string().trim().max(5000).default(""),
        tag: postTagSchema.default("Social"),
        media: z.array(uploadedPostMediaSchema).max(4).default([]),
      }).refine((input) => input.content.length > 0 || input.media.length > 0, {
        message: "Write something or attach media before posting.",
        path: ["content"],
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      await requireActiveCommonsMembership(ctx.db, accountUser.id, input.coopId);
      const classification = classifyPost({
        title: input.title,
        content: input.content,
        tag: input.tag,
        mediaCount: input.media.length,
      });

      const post = await ctx.db.commonsPost.create({
        data: {
          coopId: input.coopId,
          authorId: accountUser.id,
          title: input.title || titleFromContent(input.content),
          content: input.content,
          tag: input.tag,
          classification: classification.classification,
          classificationConfidence: classification.classificationConfidence,
          classificationSignals: classification.classificationSignals,
          media: input.media.length
            ? {
                create: input.media.map((media, index) => ({
                  storageProvider: "vercel-blob",
                  pathname: media.pathname,
                  url: media.url,
                  mediaType: media.mediaType,
                  mimeType: media.mimeType,
                  fileName: media.fileName,
                  width: media.width,
                  height: media.height,
                  durationMs: media.durationMs,
                  sizeBytes: media.sizeBytes,
                  order: index,
                })),
              }
            : undefined,
        },
        include: {
          author: { select: { name: true, email: true } },
          media: {
            orderBy: { order: "asc" },
          },
          comments: {
            orderBy: { createdAt: "asc" },
            take: 2,
            include: { author: { select: { name: true, email: true } } },
          },
          _count: { select: { comments: true, supports: true } },
        },
      });
      const coop = await loadCoopSummary(ctx.db, input.coopId);

      return { post: mapPostWithGroup(post, coop.name) };
    }),

  createComment: accountAuthenticatedProcedure
    .input(
      z.object({
        postId: z.string().min(1),
        content: z.string().trim().max(2000).default(""),
        media: z.array(uploadedPostMediaSchema).max(4).default([]),
      }).refine((input) => input.content.length > 0 || input.media.length > 0, {
        message: "Write something or attach an image before commenting.",
        path: ["content"],
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const postId = input.postId;

      const post = await ctx.db.commonsPost.findUnique({
        where: { id: postId },
      });
      if (!post) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Post not found.",
        });
      }
      await requireActiveCommonsMembership(ctx.db, accountUser.id, post.coopId);

      const comment = await ctx.db.commonsComment.create({
        data: {
          postId,
          authorId: accountUser.id,
          content: input.content,
          media: input.media.length
            ? {
                create: input.media.map((media, index) => ({
                  storageProvider: "vercel-blob",
                  pathname: media.pathname,
                  url: media.url,
                  mediaType: media.mediaType,
                  mimeType: media.mimeType,
                  fileName: media.fileName,
                  width: media.width,
                  height: media.height,
                  durationMs: media.durationMs,
                  sizeBytes: media.sizeBytes,
                  order: index,
                })),
              }
            : undefined,
        },
        include: {
          author: { select: { name: true, email: true } },
          media: { orderBy: { order: "asc" } },
        },
      });

      if (post.authorId !== accountUser.id) {
        void createNotificationAndPush(ctx.db, {
          userId: post.authorId,
          coopId: post.coopId,
          type: "COMMONS_COMMENT",
          title: "New comment",
          body: `${displayName(comment.author)} replied to your post.`,
          data: {
            postId: post.id,
            coopId: post.coopId,
          },
        });
      }

      return {
        comment: {
          id: comment.id,
          author: displayName(comment.author),
          body: comment.content,
          media:
            comment.media?.map((item: any) => ({
              id: item.id,
              pathname: item.pathname,
              url: item.url,
              mediaType: item.mediaType,
              mimeType: item.mimeType,
              fileName: item.fileName,
              width: item.width,
              height: item.height,
              durationMs: item.durationMs,
              sizeBytes: item.sizeBytes,
            })) ?? [],
        },
      };
    }),

  toggleSupport: accountAuthenticatedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      const post = await ctx.db.commonsPost.findUnique({
        where: { id: input.postId },
      });

      if (!post) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Post not found.",
        });
      }
      await requireActiveCommonsMembership(ctx.db, accountUser.id, post.coopId);

      const existing = await ctx.db.commonsPostSupport.findUnique({
        where: {
          postId_userId: {
            postId: input.postId,
            userId: accountUser.id,
          },
        },
      });

      if (existing) {
        await ctx.db.commonsPostSupport.delete({ where: { id: existing.id } });
        return { supported: false };
      }

      await ctx.db.commonsPostSupport.create({
        data: { postId: input.postId, userId: accountUser.id },
      });

      if (post.authorId !== accountUser.id) {
        void createNotificationAndPush(ctx.db, {
          userId: post.authorId,
          coopId: post.coopId,
          type: "COMMONS_SUPPORT",
          title: "Someone liked your post",
          body: "A commons member liked what you shared.",
          data: {
            postId: post.id,
            coopId: post.coopId,
          },
        });
      }
      return { supported: true };
    }),

  sendDirectMessage: accountAuthenticatedProcedure
    .input(
      z.object({
        receiverId: z.string().min(1),
        content: z.string().trim().min(1).max(4000),
        coopId: z.string().min(1).default(COMMONS_COOP_ID),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { accountUser } = ctx as AccountAuthenticatedContext;
      if (input.receiverId === accountUser.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick another member to message.",
        });
      }

      const receiver = await ctx.db.user.findUnique({
        where: { id: input.receiverId },
        select: { id: true, deletedAt: true },
      });
      if (!receiver || receiver.deletedAt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }

      const message = await ctx.db.directMessage.create({
        data: {
          coopId: input.coopId,
          senderId: accountUser.id,
          receiverId: input.receiverId,
          content: input.content,
        },
      });

      return {
        message: {
          id: message.id,
          body: message.content,
          createdAt: message.createdAt.toISOString(),
        },
      };
    }),

  listDirectMembers: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const { accountUser } = ctx as AccountAuthenticatedContext;
    await ensureCommonsMembership(ctx.db, accountUser.id);

    const memberships = await ctx.db.userCoopMembership.findMany({
      where: {
        coopId: COMMONS_COOP_ID,
        status: "ACTIVE",
        userId: { not: accountUser.id },
        user: { deletedAt: null },
      },
      orderBy: { lastActiveAt: "desc" },
      take: 50,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return {
      members: memberships.map((membership) => ({
        id: membership.user.id,
        name: displayName(membership.user),
        role: "Cahootz Commons",
      })),
    };
  }),

  listDirectThreads: accountAuthenticatedProcedure.query(async ({ ctx }) => {
    const { accountUser } = ctx as AccountAuthenticatedContext;
    const messages = await ctx.db.directMessage.findMany({
      where: {
        OR: [{ senderId: accountUser.id }, { receiverId: accountUser.id }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sender: { select: { id: true, name: true, email: true } },
        receiver: { select: { id: true, name: true, email: true } },
      },
    });

    const threads = new Map<string, any>();
    for (const message of messages) {
      const other =
        message.senderId === accountUser.id ? message.receiver : message.sender;
      if (!threads.has(other.id)) {
        threads.set(other.id, {
          id: other.id,
          name: displayName(other),
          role: "Cahootz Commons",
          time: relativeTime(message.createdAt),
          unread:
            message.receiverId === accountUser.id && !message.readAt ? 1 : 0,
          preview: message.content,
          messages: [],
        });
      }

      threads.get(other.id).messages.unshift({
        id: message.id,
        fromMe: message.senderId === accountUser.id,
        body: message.content,
        time: message.createdAt.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }

    return { threads: Array.from(threads.values()) };
  }),
});

import { tool } from "@openai/agents";
import { z } from "zod";

import { requireMembership } from "../../routers/groups.js";
import type { AgentToolContext } from "./context.js";

// Same safe-field allowlist already used by runCommonsRecommender() in
// agents/registry.ts — keeps "what an agent may see about a member" defined
// in one place rather than drifting per tool.
const USER_PROFILE_SELECT = {
  name: true,
  selfDescription: true,
  shortTermGoals: true,
  longTermGoals: true,
  skills: true,
  interests: true,
  resourcesOffered: true,
  resourcesNeeded: true,
  businessSummary: true,
  locationSummary: true,
} as const;

// errorFunction: null on every tool below — the SDK's default behavior
// swallows a thrown error into a friendly string ("An error occurred while
// running the tool...") instead of rejecting invoke(). That's wrong for a
// permission boundary: a FORBIDDEN check must fail hard, not become a
// paraphrasable string the model could talk around.

export function buildGetUserProfileTool(ctx: AgentToolContext) {
  return tool({
    name: "get_user_profile",
    description: "Fetch a member's public-safe onboarding profile (name, goals, skills, interests, resources) by user ID.",
    parameters: z.object({ userId: z.string() }),
    errorFunction: null,
    execute: async ({ userId }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: userId },
        select: USER_PROFILE_SELECT,
      });
      if (!user) return null;
      return user;
    },
  });
}

export function buildGetGroupHistoryTool(ctx: AgentToolContext) {
  return tool({
    name: "get_group_history",
    description: "Fetch recent comments/activity for a circle (group) the requesting user is a member of.",
    parameters: z.object({ groupId: z.string(), limit: z.number().min(1).max(50).default(20) }),
    errorFunction: null,
    execute: async ({ groupId, limit }) => {
      if (!ctx.requestingUserId) {
        throw new Error("get_group_history requires a requesting user.");
      }
      // Reuses the exact same membership check the groups.ts tRPC procedures
      // call — not a re-implementation — so a permission fix in one place
      // is a fix in both, and a tool call can never see more than the
      // equivalent HTTP endpoint would.
      await requireMembership(ctx.db, groupId, ctx.requestingUserId);

      const comments = await ctx.db.groupComment.findMany({
        where: { groupId },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { author: { select: { name: true } } },
      });

      return comments.map((c) => ({
        author: c.author.name,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
      }));
    },
  });
}

export function buildQueryEventLogTool(ctx: AgentToolContext) {
  return tool({
    name: "query_event_log",
    description:
      "Fetch recent AuditLog entries (an append-only accountability timeline of things that happened, e.g. 'member joined', 'leadership transferred'), scoped to either a specific actor or a specific resource. At least one of actorId/resourceId is required.",
    parameters: z.object({
      actorId: z.string().nullable().default(null),
      resource: z.string().nullable().default(null),
      resourceId: z.string().nullable().default(null),
      limit: z.number().min(1).max(50).default(20),
    }),
    errorFunction: null,
    execute: async ({ actorId, resource, resourceId, limit }) => {
      if (!actorId && !resourceId) {
        throw new Error("query_event_log requires actorId or resourceId to avoid unscoped scans.");
      }

      const events = await ctx.db.auditLog.findMany({
        where: {
          ...(actorId ? { actorId } : {}),
          ...(resource ? { resource } : {}),
          ...(resourceId ? { resourceId } : {}),
        },
        orderBy: { occurredAt: "desc" },
        take: limit,
      });

      return events.map((e) => ({
        action: e.action,
        resource: e.resource,
        resourceId: e.resourceId,
        metadata: e.metadata,
        occurredAt: e.occurredAt.toISOString(),
      }));
    },
  });
}

export function buildDbTools(ctx: AgentToolContext) {
  return [buildGetUserProfileTool(ctx), buildGetGroupHistoryTool(ctx), buildQueryEventLogTool(ctx)];
}

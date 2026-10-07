import { tool } from "@openai/agents";
import { z } from "zod";

import { checkSageOutput, describeOutputProblems } from "../../services/untrusted-input.js";
import type { AgentToolContext } from "./context.js";

/**
 * Sage's specialists, as read-only tools the steward calls (Ledger, Guardian, Bridge, Cadence).
 * Every tool is bound to one Commons (ctx.coopId), returns only member-safe fields, and fails hard
 * (errorFunction: null) instead of letting the model talk around a refusal. Deterministic work - dates,
 * sums, permissions, policy - happens here in code; the model only reads the results.
 *
 * `onResult` lets the caller record each specialist's findings in the decision trail.
 */
export type SpecialistLog = (specialist: "Cadence" | "Guardian" | "Bridge" | "Ledger", summary: string, detail?: string) => void;

const DAY_MS = 86_400_000;
const STOPWORDS = new Set(["a", "an", "the", "for", "to", "of", "and", "with", "help", "need", "someone", "who", "can", "my", "our"]);

function needWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word)))];
}

async function activeMember(ctx: AgentToolContext, userId: string): Promise<boolean> {
  const membership = await ctx.db.userCoopMembership.findUnique({ where: { userId_coopId: { userId, coopId: ctx.coopId } }, select: { status: true } });
  return membership?.status === "ACTIVE";
}

// ── Cadence: deadlines, follow-ups, things left waiting ───────────────────────

export function buildCadenceTools(ctx: AgentToolContext, log?: SpecialistLog) {
  const listOpenTasks = tool({
    name: "list_open_tasks",
    description: "Cadence: what Sage is already following up on in this Commons (so you don't start a duplicate).",
    parameters: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    errorFunction: null,
    execute: async ({ limit }) => {
      const tasks = await ctx.db.sageTask.findMany({
        where: { coopId: ctx.coopId, status: "OPEN" }, orderBy: { nextWakeAt: "asc" }, take: limit,
        select: { id: true, kind: true, title: true, subjectType: true, subjectId: true, ownerUserId: true, nextWakeAt: true, attempts: true },
      });
      log?.("Cadence", `${tasks.length} open follow-ups`);
      return tasks.map((task) => ({ ...task, nextWakeAt: task.nextWakeAt.toISOString() }));
    },
  });

  const listUpcomingDeadlines = tool({
    name: "list_upcoming_deadlines",
    description: "Cadence: upcoming events, proposals whose voting closes soon, proposal drafts left unsubmitted, and member reviews of Sage suggestions left waiting.",
    parameters: z.object({ withinDays: z.number().int().min(1).max(30).default(7) }),
    errorFunction: null,
    execute: async ({ withinDays }) => {
      const now = new Date();
      const horizon = new Date(now.getTime() + withinDays * DAY_MS);
      const [events, proposals, staleDrafts, waitingReviews] = await Promise.all([
        ctx.db.event.findMany({
          where: { coopId: ctx.coopId, startAt: { gte: now, lte: horizon } }, orderBy: { startAt: "asc" }, take: 20,
          select: { id: true, startAt: true, circleId: true, post: { select: { title: true } } },
        }),
        ctx.db.proposal.findMany({
          where: { coopId: ctx.coopId, status: "VOTABLE", votingEndsAt: { gte: now, lte: horizon } }, orderBy: { votingEndsAt: "asc" }, take: 20,
          select: { id: true, title: true, votingEndsAt: true },
        }),
        ctx.db.commonsProposalDraft.findMany({
          where: { coopId: ctx.coopId, submittedAt: null, createdAt: { lte: new Date(now.getTime() - 7 * DAY_MS) } }, take: 20,
          select: { id: true, title: true, authorId: true, createdAt: true },
        }),
        ctx.db.commonsActionReview.findMany({
          where: { status: "PENDING", createdAt: { lte: new Date(now.getTime() - 3 * DAY_MS) }, action: { coopId: ctx.coopId } }, take: 20,
          select: { id: true, reviewType: true, userId: true, createdAt: true, actionId: true },
        }),
      ]);
      log?.("Cadence", `${events.length} events, ${proposals.length} votes closing, ${staleDrafts.length} stale drafts, ${waitingReviews.length} waiting reviews within ${withinDays} days`);
      return {
        events: events.map((event) => ({ id: event.id, title: event.post?.title ?? "Event", startAt: event.startAt.toISOString(), circleId: event.circleId })),
        votesClosing: proposals.map((proposal) => ({ id: proposal.id, title: proposal.title, votingEndsAt: proposal.votingEndsAt?.toISOString() ?? null })),
        staleDrafts: staleDrafts.map((draft) => ({ id: draft.id, title: draft.title, authorId: draft.authorId, ageDays: Math.floor((now.getTime() - draft.createdAt.getTime()) / DAY_MS) })),
        // Code already reminds once and closes these (sage-suggestion-follow-up.ts); the steward needn't follow them up.
        waitingReviews: waitingReviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString(), sageRemindsAndClosesAutomatically: true })),
      };
    },
  });
  return [listOpenTasks, listUpcomingDeadlines];
}

// ── Guardian: charter, rules, who may do what ─────────────────────────────────

export function buildGuardianTools(ctx: AgentToolContext, log?: SpecialistLog) {
  const getCharterAndRules = tool({
    name: "get_charter_and_rules",
    description: "Guardian: this Commons' charter, mission goals and governance rules (quorum, approval threshold, voting window, auto-approve and council limits).",
    parameters: z.object({}),
    errorFunction: null,
    execute: async () => {
      const config = await ctx.db.coopConfig.findFirst({ where: { coopId: ctx.coopId, isActive: true }, orderBy: { version: "desc" } });
      if (!config) return null;
      log?.("Guardian", `Charter version ${config.version} and governance rules`);
      return {
        charter: config.charterText.slice(0, 4000), missionGoals: config.missionGoals, quorumPercent: config.quorumPercent,
        approvalThresholdPercent: config.approvalThresholdPercent, votingWindowDays: config.votingWindowDays,
        aiAutoApproveThresholdUSD: config.aiAutoApproveThresholdUSD, councilVoteThresholdUSD: config.councilVoteThresholdUSD,
      };
    },
  });

  const checkAuthority = tool({
    name: "check_authority",
    description: "Guardian: whether a person is an active member, a circle's leader, or holds admin roles here. Deterministic; use it before routing anything to someone.",
    parameters: z.object({ userId: z.string(), circleId: z.string().nullable().default(null) }),
    errorFunction: null,
    execute: async ({ userId, circleId }) => {
      const [isActiveMember, roles, group] = await Promise.all([
        activeMember(ctx, userId),
        ctx.db.adminRole.findMany({ where: { userId, coopId: ctx.coopId, revokedAt: null }, select: { role: true } }),
        circleId ? ctx.db.group.findUnique({ where: { id: circleId }, select: { coopId: true, leaderId: true } }) : Promise.resolve(null),
      ]);
      const result = {
        isActiveMember, adminRoles: roles.map((row) => row.role),
        isCircleLeader: !!group && group.coopId === ctx.coopId && group.leaderId === userId,
      };
      log?.("Guardian", `Checked authority: ${result.isActiveMember ? "member" : "not a member"}${result.isCircleLeader ? ", circle leader" : ""}${result.adminRoles.length ? `, ${result.adminRoles.join("/")}` : ""}`);
      return result;
    },
  });

  const checkMessagePolicy = tool({
    name: "check_message_policy",
    description: "Guardian: whether text Sage wants to publish passes the safety check (no links, @mentions, claimed actions, or echoed instructions).",
    parameters: z.object({ text: z.string().max(4000) }),
    errorFunction: null,
    execute: async ({ text }) => {
      const result = checkSageOutput(text);
      log?.("Guardian", result.ok ? "Message passes the safety check" : "Message fails the safety check", describeOutputProblems(result.problems));
      return { ok: result.ok, problems: result.problems };
    },
  });
  return [getCharterAndRules, checkAuthority, checkMessagePolicy];
}

// ── Bridge: needs, skills, resources ──────────────────────────────────────────

export function buildBridgeTools(ctx: AgentToolContext, log?: SpecialistLog) {
  const findMembersForNeed = tool({
    name: "find_members_for_need",
    description: "Bridge: active members of this Commons whose listed skills, resources or interests match a need. Returns ids and safe profile fields only. Introductions always ask both people first.",
    parameters: z.object({ need: z.string().min(3).max(300), excludeUserId: z.string().nullable().default(null), limit: z.number().int().min(1).max(10).default(5) }),
    errorFunction: null,
    execute: async ({ need, excludeUserId, limit }) => {
      const wanted = needWords(need);
      if (!wanted.length) return [];
      const members = await ctx.db.userCoopMembership.findMany({
        where: { coopId: ctx.coopId, status: "ACTIVE", user: { isBot: false, deletedAt: null }, ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) },
        select: { userId: true, user: { select: { name: true, skills: true, resourcesOffered: true, interests: true } } }, take: 500,
      });
      const scored = members.map((member) => {
        const offered = [...member.user.skills, ...member.user.resourcesOffered, ...member.user.interests];
        const matched = offered.filter((entry) => needWords(entry).some((word) => wanted.some((want) => word.startsWith(want.slice(0, 5)) || want.startsWith(word.slice(0, 5)))));
        return { userId: member.userId, name: member.user.name, matched, score: matched.length };
      }).filter((member) => member.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
      log?.("Bridge", `${scored.length} members match "${need.slice(0, 60)}"`, scored.map((member) => `${member.name ?? "A member"}: ${member.matched.join(", ")}`).join("\n") || undefined);
      return scored.map(({ score: _score, ...member }) => member);
    },
  });

  const listPublishedResources = tool({
    name: "list_published_resources",
    description: "Bridge: verified resources published in this Commons (skills, equipment, spaces, services, information).",
    parameters: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    errorFunction: null,
    execute: async ({ limit }) => {
      const resources = await ctx.db.commonsResource.findMany({
        where: { coopId: ctx.coopId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: limit,
        select: { id: true, kind: true, title: true, description: true },
      });
      log?.("Bridge", `${resources.length} published resources`);
      return resources;
    },
  });
  return [findMembersForNeed, listPublishedResources];
}

// ── Ledger (limited): proposal budgets only ───────────────────────────────────

export function buildLedgerTools(ctx: AgentToolContext, log?: SpecialistLog) {
  const getProposalExposure = tool({
    name: "get_proposal_exposure",
    description: "Ledger: budgets requested by this Commons' open, approved and funded proposals, against its auto-approve and council limits. Proposal data only; no treasury balances.",
    parameters: z.object({}),
    errorFunction: null,
    execute: async () => {
      const yearAgo = new Date(Date.now() - 365 * DAY_MS);
      const [config, groups, openProposals] = await Promise.all([
        ctx.db.coopConfig.findFirst({ where: { coopId: ctx.coopId, isActive: true }, orderBy: { version: "desc" }, select: { aiAutoApproveThresholdUSD: true, councilVoteThresholdUSD: true } }),
        ctx.db.proposal.groupBy({
          by: ["status"], where: { coopId: ctx.coopId, status: { in: ["SUBMITTED", "VOTABLE", "APPROVED", "FUNDED"] }, createdAt: { gte: yearAgo } },
          _sum: { budgetAmount: true }, _count: { _all: true },
        }),
        ctx.db.proposal.findMany({
          where: { coopId: ctx.coopId, status: { in: ["SUBMITTED", "VOTABLE"] } }, orderBy: { budgetAmount: "desc" }, take: 5,
          select: { id: true, title: true, status: true, budgetAmount: true, budgetCurrency: true },
        }),
      ]);
      const byStatus = Object.fromEntries(groups.map((row) => [row.status, { count: row._count._all, budget: Number(row._sum.budgetAmount ?? 0) }]));
      log?.("Ledger", "Proposal budgets (last 12 months)", Object.entries(byStatus).map(([status, value]) => `${status.toLowerCase()}: ${value.count} · $${value.budget.toLocaleString("en-US")}`).join("\n") || undefined);
      return {
        byStatus, largestOpen: openProposals,
        autoApproveLimitUSD: config?.aiAutoApproveThresholdUSD ?? 500, councilLimitUSD: config?.councilVoteThresholdUSD ?? 5000,
        note: "Proposal budgets only. Treasury balances and reserves aren't available to Sage.",
      };
    },
  });
  return [getProposalExposure];
}

export function buildSpecialistTools(ctx: AgentToolContext, log?: SpecialistLog) {
  return [...buildCadenceTools(ctx, log), ...buildGuardianTools(ctx, log), ...buildBridgeTools(ctx, log), ...buildLedgerTools(ctx, log)];
}

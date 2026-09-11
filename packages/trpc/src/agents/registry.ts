import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Agent, run } from "@openai/agents";
import { proposalEngine, ProposalInputZ, ProposalOutputZ } from "@repo/validators";

import type { AgentToolContext } from "./tools/index.js";
import { buildDbTools, buildQueryObservationsTool, buildSearchKnowledgeBaseTool } from "./tools/index.js";

export interface AgentDefinition {
  key: string;
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  // toolCtx is additive/optional - the 5 tool-less agents below ignore it.
  run: (input: any, toolCtx?: AgentToolContext) => Promise<any>;
}

export interface AgentMetadata {
  key: string;
  name: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
}

// ── 1. Commons Assistant ──────────────────────────────────────────────────
// Mirrors the standalone runCommonsAi() in packages/trpc/src/routers/commons.ts
// (kept as a small duplicate here rather than exported/imported, since that
// function is a private implementation detail of the commons router).

const CommonsAssistantInputZ = z.object({
  prompt: z.string().min(1).describe("The message to send to the assistant"),
});

const CommonsAssistantOutputZ = z.object({
  response: z.string(),
});

async function runCommonsAssistant(
  input: z.infer<typeof CommonsAssistantInputZ>
): Promise<z.infer<typeof CommonsAssistantOutputZ>> {
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

  const result = (await run(agent, input.prompt)) as unknown as {
    finalOutput?: string;
    output?: string;
  };

  return { response: result.finalOutput || result.output || "" };
}

// ── 2. Comment Evaluation Agent ────────────────────────────────────────────
// Calls the real proposalEngine.evaluateComment() (public method) - no
// duplicated prompt logic, so this exercises the exact production agent.

const CommentEvaluationInputZ = z.object({
  proposalTitle: z.string().min(1),
  proposalSummary: z.string().min(1),
  category: z.string().min(1),
  commentText: z.string().min(1).describe("The community comment to evaluate"),
});

const CommentEvaluationOutputZ = z.object({
  alignment: z.enum(["ALIGNED", "NEUTRAL", "MISALIGNED"]),
  score: z.number(),
  analysis: z.string(),
  goalsImpacted: z.array(z.string()),
});

async function runCommentEvaluation(
  input: z.infer<typeof CommentEvaluationInputZ>
): Promise<z.infer<typeof CommentEvaluationOutputZ>> {
  return proposalEngine.evaluateComment(input.commentText, {
    title: input.proposalTitle,
    summary: input.proposalSummary,
    category: input.category,
  });
}

// ── 3. Proposal Engine ─────────────────────────────────────────────────────
// Calls the real proposalEngine.processProposal() (public method) - the full
// pipeline (extraction, evaluation, domain/structural scoring, governance,
// KPIs, alternatives, missing-data checks, compliance) in one shot, using
// the exact same ProposalInputZ/ProposalOutputZ schemas the production
// proposal-submission flow uses. Runs with no CoopConfig override (the
// engine's built-in defaults apply) - pass a coopId in the input to test
// against a specific commons' charter/mission goals once that's wired up.

async function runProposalEngine(
  input: z.infer<typeof ProposalInputZ>
): Promise<z.infer<typeof ProposalOutputZ>> {
  return proposalEngine.processProposal(input);
}

// ── 4. Proposal Rewrite Agent ─────────────────────────────────────────────
// Calls the real proposalEngine.rewriteWithAlternative() (public method).

const ProposalRewriteInputZ = z.object({
  originalText: z.string().min(1),
  label: z.string().min(1).describe("Short label for the alternative being applied"),
  rationale: z.string().min(1),
  changes: z.array(z.object({
    field: z.string().min(1),
    from: z.string().optional(),
    to: z.string().min(1),
  })).min(1),
});

const ProposalRewriteOutputZ = z.object({
  rewrittenText: z.string(),
});

async function runProposalRewrite(
  input: z.infer<typeof ProposalRewriteInputZ>
): Promise<z.infer<typeof ProposalRewriteOutputZ>> {
  const rewrittenText = await proposalEngine.rewriteWithAlternative(input.originalText, {
    label: input.label,
    rationale: input.rationale,
    changes: input.changes,
  });
  return { rewrittenText };
}

// ── 5. Commons Recommender ─────────────────────────────────────────────────
// Looks up a user's onboarding profile and every active commons' profile
// (plus a rough summary of who's already in each one), then recommends
// which commons they should join.

const CommonsRecommenderInputZ = z.object({
  userId: z.string().min(1).describe("The user's ID to fetch onboarding info for"),
});

const CommonsRecommenderOutputZ = z.object({
  recommendations: z.array(z.object({
    coopId: z.string(),
    name: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  })),
  question: z.string().optional().describe(
    "A follow-up question worth asking the user, populated when confidence is low or the agent has something it would want clarified. Recommendations are still always returned regardless."
  ),
});

function topByFrequency(values: string[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value);
}

async function runCommonsRecommender(
  input: z.infer<typeof CommonsRecommenderInputZ>
): Promise<z.infer<typeof CommonsRecommenderOutputZ>> {
  const { db } = await import("@repo/db");

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
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
    },
  });

  if (!user) {
    throw new Error(`No user found with id "${input.userId}"`);
  }

  const allCommons = await db.coopConfig.findMany({
    where: { isActive: true, isDemo: false },
    select: {
      coopId: true,
      name: true,
      tagline: true,
      description: true,
      displayMission: true,
      eligibility: true,
    },
  });

  const myMemberships = await db.userCoopMembership.findMany({
    where: { userId: input.userId, status: "ACTIVE" },
    select: { coopId: true },
  });
  const myCoopIds = new Set(myMemberships.map((m) => m.coopId));

  const commons = allCommons.filter((c) => !myCoopIds.has(c.coopId));

  const memberships = await db.userCoopMembership.findMany({
    where: { coopId: { in: commons.map((c) => c.coopId) }, status: "ACTIVE" },
    select: {
      coopId: true,
      user: { select: { skills: true, interests: true } },
    },
    take: 500,
  });

  const compositionByCoopId = new Map<string, { skills: string[]; interests: string[] }>();
  for (const m of memberships) {
    const bucket = compositionByCoopId.get(m.coopId) ?? { skills: [], interests: [] };
    bucket.skills.push(...m.user.skills);
    bucket.interests.push(...m.user.interests);
    compositionByCoopId.set(m.coopId, bucket);
  }

  const commonsContext = commons.map((c) => {
    const comp = compositionByCoopId.get(c.coopId);
    return [
      `- ${c.name ?? c.coopId} (coopId: ${c.coopId})`,
      `  Tagline: ${c.tagline ?? "n/a"}`,
      `  Mission: ${c.displayMission ?? c.description ?? "n/a"}`,
      `  Eligibility: ${c.eligibility ?? "open to all"}`,
      `  Current members' skills: ${comp?.skills.length ? topByFrequency(comp.skills).join(", ") : "none listed"}`,
      `  Current members' interests: ${comp?.interests.length ? topByFrequency(comp.interests).join(", ") : "none listed"}`,
    ].join("\n");
  }).join("\n\n") || "No commons available to recommend - the user is already an active member of every eligible commons.";

  const userContext = [
    `Name: ${user.name ?? "unknown"}`,
    `Self description: ${user.selfDescription ?? "none provided"}`,
    `Short-term goals: ${user.shortTermGoals ?? "none provided"}`,
    `Long-term goals: ${user.longTermGoals ?? "none provided"}`,
    `Skills: ${user.skills.length ? user.skills.join(", ") : "none listed"}`,
    `Interests: ${user.interests.length ? user.interests.join(", ") : "none listed"}`,
    `Resources offered: ${user.resourcesOffered.length ? user.resourcesOffered.join(", ") : "none listed"}`,
    `Resources needed: ${user.resourcesNeeded.length ? user.resourcesNeeded.join(", ") : "none listed"}`,
    `Business summary: ${user.businessSummary ?? "none provided"}`,
    `Location: ${user.locationSummary ?? "unknown"}`,
  ].join("\n");

  const agent = new Agent({
    name: "Commons Recommender",
    model: "gpt-5.2",
    instructions: [
      "You help match a prospective or existing member to the right commons (cooperative) to join, based on their onboarding profile, each commons' description, and who is already in each commons.",
      "The list below already excludes commons the user is currently an active member of - only recommend from this list.",
      "Always return 1-3 ranked commons with a short reasoning for each, grounded in specific overlaps with the commons' mission or membership. Make your best recommendation even if the profile is thin - never leave recommendations empty, unless the list below is empty, in which case return no recommendations.",
      "If your top confidence is low, or there's something specific about the user you'd want to know to recommend more precisely, also fill in the question field with ONE concise question. Leave question empty if you're already confident.",
      "",
      "Available commons:",
      commonsContext,
    ].join("\n"),
    outputType: CommonsRecommenderOutputZ,
  });

  const prompt = `User profile:\n${userContext}`;

  const result = await run(agent, prompt) as unknown as {
    finalOutput?: z.infer<typeof CommonsRecommenderOutputZ>;
    output?: z.infer<typeof CommonsRecommenderOutputZ>;
  };

  return result.finalOutput ?? result.output ?? { recommendations: [] };
}

// ── 6. Community Observer ──────────────────────────────────────────────────
// A single, scope-agnostic agent used everywhere the platform wants an LLM
// to look at some content-in-context and produce ONE structured observation
// (type, confidence, summary, optional details) matching the AIObservation
// shape (packages/db/prisma/schema.prisma) - rather than a bespoke agent per
// feature. Two production call sites share this exact Agent instance/
// instructions: commons post classification (routers/commons.ts createPost)
// and the circle digest (routers/groups.ts getAiDigest) - each just passes a
// different `task`/`content`/`allowedTypes`. This generalizes what used to be
// a Post-Classifier-only agent (kept the same registry slot rather than
// adding a second one, since it was never called from production code).
//
// When called with a toolCtx (run()'s optional second arg), the agent also
// gets DB-query, knowledge-base search, and prior-observation-read tools so
// it isn't limited to only what the caller pre-fetched into `content`.

export const COMMUNITY_OBSERVER_POST_TYPES = [
  "proposal_seed",
  "event",
  "need",
  "resource",
  "market",
  "project",
  "decision",
  "update",
  "support",
  "win",
  "social",
] as const;

const CommunityObserverInputZ = z.object({
  task: z.string().min(1).describe(
    "What to look at and what kind of observation to produce, e.g. 'Classify this single community post' or 'Summarize recent circle activity since the last digest'"
  ),
  content: z.string().min(1).describe("The content/context to analyze"),
  allowedTypes: z.array(z.string()).optional().describe(
    "If set, constrain the observation's `type` field to one of these values"
  ),
});

const CommunityObserverOutputZ = z.object({
  type: z.string().describe("A short machine-readable label for this observation, e.g. a category or 'circle_digest_summary'"),
  confidence: z.number().min(0).max(1),
  summary: z.string().describe("A plain-language summary of the observation"),
  details: z.record(z.string(), z.unknown()).optional().describe("Optional structured extras beyond the summary"),
});

async function runCommunityObserver(
  input: z.infer<typeof CommunityObserverInputZ>,
  toolCtx?: AgentToolContext,
): Promise<z.infer<typeof CommunityObserverOutputZ>> {
  const agent = new Agent({
    name: "Community Observer",
    model: "gpt-5.2",
    instructions: [
      "You look at content from a cooperative/mutual-aid community platform and produce ONE structured observation: a short `type` label, a confidence (0-1), a plain-language summary, and optional structured details.",
      "Treat your output as a suggestion for humans to review, not a final decision - don't overstate confidence.",
      "If the task specifies allowed types, the `type` field MUST be one of those values.",
      "If you have tools available, use them to look up additional context (user profiles, group history, past observations, knowledge base documents) rather than guessing - but don't fabricate specifics you can't verify.",
      "If you use a knowledge base search result, cite the document title inline in your summary.",
    ].join("\n"),
    tools: toolCtx
      ? [...buildDbTools(toolCtx), buildQueryObservationsTool(toolCtx), buildSearchKnowledgeBaseTool(toolCtx)]
      : [],
    ...(toolCtx ? { modelSettings: { toolChoice: "auto" as const } } : {}),
    outputType: CommunityObserverOutputZ,
  });

  const prompt = [
    `Task: ${input.task}`,
    input.allowedTypes?.length ? `Allowed types: ${input.allowedTypes.join(", ")}` : "",
    `Content:\n${input.content}`,
  ].filter(Boolean).join("\n\n");

  const result = await run(agent, prompt) as unknown as {
    finalOutput?: z.infer<typeof CommunityObserverOutputZ>;
    output?: z.infer<typeof CommunityObserverOutputZ>;
  };

  return result.finalOutput ?? result.output ?? { type: "unknown", confidence: 0, summary: "The agent returned no output." };
}

// ── 7. Sage Commons Reply ──────────────────────────────────────────────────
// The Commons' Twitter/Grok-style @-mention bot. Given a coopId and the
// mentioning message (plus optional thread/DM context), loads that Commons'
// own active CoopConfig (charterText + missionGoals - same fields proposal.ts
// uses to build CoopConfigData) and answers grounded ONLY in that charter/
// mission. Multi-tenant by construction: same agent code, different
// instructions per coopId, because CoopConfig is looked up fresh on every
// call rather than baked into the Agent definition. One global bot identity
// (handle "sage") is shared across every Commons; only its knowledge/
// personality shifts per-coopId.

const SageCommonsReplyInputZ = z.object({
  coopId: z.string().min(1).describe("Which Commons' charter/mission to ground the reply in"),
  message: z.string().min(1).describe("The message that mentioned or was sent to Sage"),
  threadContext: z.string().optional().describe("Prior thread/comment/DM history, oldest-first, for continuity"),
});

const SageCommonsReplyOutputZ = z.object({
  reply: z.string(),
});

async function runSageCommonsReply(
  input: z.infer<typeof SageCommonsReplyInputZ>
): Promise<z.infer<typeof SageCommonsReplyOutputZ>> {
  const { db } = await import("@repo/db");

  const coopConfig = await db.coopConfig.findFirst({
    where: { coopId: input.coopId, isActive: true },
    orderBy: { version: "desc" },
    select: { name: true, charterText: true, missionGoals: true },
  });

  const missionGoals = (coopConfig?.missionGoals as
    | Array<{ key: string; label: string; priorityWeight: number; description?: string }>
    | undefined) ?? [];

  const commonsName = coopConfig?.name || input.coopId;
  const charterText = coopConfig?.charterText?.trim();

  const missionGoalsSummary = missionGoals.length
    ? missionGoals.map((g) => `- ${g.label}${g.description ? `: ${g.description}` : ""}`).join("\n")
    : "No mission goals have been configured for this Commons yet.";

  const agent = new Agent({
    name: "Sage",
    model: process.env.COMMONS_AI_MODEL || "gpt-5.2",
    instructions: [
      `You are Sage, the AI assistant for "${commonsName}", a specific Commons (cooperative community) inside the Cahootz platform.`,
      "You were @-mentioned or messaged directly inside this Commons' social feed or DMs. Reply in a natural, concise, conversational tone appropriate for a social feed reply - not a long essay.",
      "Ground every answer ONLY in this Commons' own charter and mission goals below. Do not invent policies, numbers, or commitments that aren't in the charter.",
      "If the question isn't covered by this Commons' charter or mission goals, say so plainly and briefly rather than guessing or answering generically.",
      "Never claim to take real-world actions (payments, votes, membership changes) - you can only inform and discuss.",
      "",
      `${commonsName}'s charter:`,
      charterText || "(No charter text has been configured for this Commons yet.)",
      "",
      `${commonsName}'s mission goals:`,
      missionGoalsSummary,
    ].join("\n"),
  });

  const prompt = [
    input.threadContext ? `Prior conversation (oldest first):\n${input.threadContext}` : "",
    `Message to reply to: ${input.message}`,
  ].filter(Boolean).join("\n\n");

  const result = (await run(agent, prompt)) as unknown as {
    finalOutput?: string;
    output?: string;
  };

  return { reply: result.finalOutput || result.output || "I don't have a grounded answer for that in this Commons' charter right now." };
}

// ── Registry ────────────────────────────────────────────────────────────
// To add a new agent: define its input/output Zod schemas and a run()
// function above, then add one entry below. No other file needs to change -
// the admin playground page discovers agents purely from this list.

export const agentRegistry: AgentDefinition[] = [
  {
    key: "commons-assistant",
    name: "Commons Assistant",
    description: "General-purpose community assistant used across Cahootz Commons.",
    inputSchema: CommonsAssistantInputZ,
    outputSchema: CommonsAssistantOutputZ,
    run: runCommonsAssistant,
  },
  {
    key: "comment-evaluation",
    name: "Comment Evaluation Agent",
    description: "Scores whether a proposal comment supports or conflicts with the co-op's mission goals.",
    inputSchema: CommentEvaluationInputZ,
    outputSchema: CommentEvaluationOutputZ,
    run: runCommentEvaluation,
  },
  {
    key: "proposal-engine",
    name: "Proposal Engine",
    description: "Runs the full proposal pipeline: extraction, mission/structural scoring, governance, KPIs, alternatives, and missing-data checks.",
    inputSchema: ProposalInputZ,
    outputSchema: ProposalOutputZ,
    run: runProposalEngine,
  },
  {
    key: "proposal-rewrite",
    name: "Proposal Rewrite Agent",
    description: "Rewrites a proposal's text to incorporate a chosen alternative's field changes.",
    inputSchema: ProposalRewriteInputZ,
    outputSchema: ProposalRewriteOutputZ,
    run: runProposalRewrite,
  },
  {
    key: "commons-recommender",
    name: "Commons Recommender",
    description: "Given a user ID, recommends which commons (excluding ones they're already in) they should join, with an optional follow-up question when confidence is low.",
    inputSchema: CommonsRecommenderInputZ,
    outputSchema: CommonsRecommenderOutputZ,
    run: runCommonsRecommender,
  },
  {
    key: "community-observer",
    name: "Community Observer",
    description: "Looks at content-in-context (a post, a window of circle activity, etc.) and produces one structured observation - type, confidence, summary - used to populate AI Working Memory across the platform.",
    inputSchema: CommunityObserverInputZ,
    outputSchema: CommunityObserverOutputZ,
    run: runCommunityObserver,
  },
  {
    key: "sage-commons-reply",
    name: "Sage",
    description: "The Commons' @-mention and DM bot. Answers grounded only in the specific Commons' own charter and mission goals (per coopId via CoopConfig).",
    inputSchema: SageCommonsReplyInputZ,
    outputSchema: SageCommonsReplyOutputZ,
    run: runSageCommonsReply,
  },
];

export function getAgent(key: string): AgentDefinition | undefined {
  return agentRegistry.find((a) => a.key === key);
}

export function listAgentMetadata(): AgentMetadata[] {
  return agentRegistry.map((agent) => ({
    key: agent.key,
    name: agent.name,
    description: agent.description,
    inputSchema: zodToJsonSchema(agent.inputSchema, { target: "jsonSchema7" }),
    outputSchema: zodToJsonSchema(agent.outputSchema, { target: "jsonSchema7" }),
  }));
}

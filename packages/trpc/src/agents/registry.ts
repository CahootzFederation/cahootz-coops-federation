import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Agent, run } from "@openai/agents";
import { proposalEngine, ProposalInputZ, ProposalOutputZ } from "@repo/validators";

export interface AgentDefinition {
  key: string;
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  run: (input: any) => Promise<any>;
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

// ── 6. Post Classifier ─────────────────────────────────────────────────────
// Classifies a CommonsPost into the same `classification` categories the
// keyword-based classifyPost() in packages/trpc/src/routers/commons.ts
// already assigns on post creation - but via an LLM instead of keyword
// matching, so the two approaches can be compared side by side. Mirrors
// that function's real input shape (title, content, tag); the tag enum is
// duplicated here rather than imported since it's a private const in that
// router file, not exported.

const POST_CLASSIFICATIONS = [
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

const PostClassifierInputZ = z.object({
  title: z.string().optional().describe("The post's title, if it has one"),
  content: z.string().min(1).describe("The post's body text"),
  tag: z.enum([
    "Thought", "Ask", "Offer", "Event", "Project", "Proposal", "Product",
    "Update", "Decision", "Receipt", "Social", "Meme", "Win", "Need",
    "Idea", "Vote", "Resource", "Opportunity",
  ]).optional().describe("The post's user-selected type, if any"),
});

const PostClassifierOutputZ = z.object({
  classification: z.enum(POST_CLASSIFICATIONS),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

async function runPostClassifier(
  input: z.infer<typeof PostClassifierInputZ>
): Promise<z.infer<typeof PostClassifierOutputZ>> {
  const agent = new Agent({
    name: "Post Classifier",
    model: "gpt-5.2",
    instructions: [
      "Classify a community post into exactly one of these categories:",
      "- proposal_seed: proposes a decision, vote, or policy for the group to consider",
      "- event: an event, meetup, or gathering with a time/place component",
      "- need: the author is asking for help or looking for something",
      "- resource: sharing a template, guide, link, toolkit, or receipt",
      "- market: a job, gig, hiring, sale, or other economic opportunity",
      "- project: an update on or call to collaborate on an ongoing project",
      "- decision: announcing a decision that's been made",
      "- update: a general status update",
      "- support: celebrating, encouraging, or congratulating someone",
      "- win: sharing a personal or community win",
      "- social: general social chatter, memes, or anything that doesn't fit above (default)",
      "",
      "The post's user-selected tag (if given) is a strong signal but not decisive - classify based on the actual content.",
    ].join("\n"),
    outputType: PostClassifierOutputZ,
  });

  const prompt = [
    input.title ? `Title: ${input.title}` : "",
    `Content: ${input.content}`,
    input.tag ? `User-selected tag: ${input.tag}` : "",
  ].filter(Boolean).join("\n");

  const result = await run(agent, prompt) as unknown as {
    finalOutput?: z.infer<typeof PostClassifierOutputZ>;
    output?: z.infer<typeof PostClassifierOutputZ>;
  };

  return result.finalOutput ?? result.output ?? { classification: "social", confidence: 0, reasoning: "The agent returned no output." };
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
    key: "post-classifier",
    name: "Post Classifier",
    description: "Classifies a community post into one of the same categories the rule-based classifier uses, for comparison.",
    inputSchema: PostClassifierInputZ,
    outputSchema: PostClassifierOutputZ,
    run: runPostClassifier,
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

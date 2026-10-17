import { db } from "@repo/db";

import { ensureSageBotUser } from "../lib/bot.js";
import { checkSageOutput, cleanseUntrustedText } from "./untrusted-input.js";

/**
 * Sage's open question to the whole Commons about a community pattern.
 *
 * A hypothesis (sage-community-memory.ts) is built from private check-ins, so no one person may hold it:
 * not a steward, not an admin, not the steward agent. When one is ACTIVE, Sage asks everyone instead,
 * with a fixed question about what the group could do together. The text comes from a template keyed
 * by theme, so it never carries a count, a quote, or a hint that members said anything privately, and
 * it costs no model call. The question is recorded as an ASK_COMMONS action linked to the hypothesis
 * (originObservationId), and members' public replies and reactions are what its impact reviews count.
 */
export const COMMUNITY_QUESTION_SOURCE = "community_question";
export const COMMUNITY_QUESTION_CLASSIFICATION = "sage_community_question";
/** At most one question per Commons in this many days. */
export const COMMUNITY_QUESTION_COMMONS_COOLDOWN_DAYS = 14;
/** The same theme is asked at most once in this many days. */
export const COMMUNITY_QUESTION_THEME_COOLDOWN_DAYS = 90;
/** Distinct members who must reply or react for a question to count as helpful in an impact review. */
export const COMMUNITY_QUESTION_MIN_RESPONDERS = 2;
const CONFIG_KEY = "sage-community-question:v1";
const DAY_MS = 86_400_000;

const CLOSING = "Reply with what would work for you, or react if you'd join in. If enough of us want the same thing, it could become a proposal for the group to decide.";

/** One question per theme from sage-private-signals.ts. Each asks what the group could do together, never who is struggling. */
const QUESTIONS: Record<string, { title: string; ask: string; label: string }> = {
  transportation_access: {
    title: "Getting places together", label: "getting places",
    ask: "Is getting to events, markets or meetings harder than it should be? Would a ride board or carpools help?",
  },
  food_access: {
    title: "Sharing food and groceries", label: "food and groceries",
    ask: "Would a shared grocery run, a meal swap or a pantry shelf be useful to this group?",
  },
  housing_stability: {
    title: "Helping each other at home", label: "help at home",
    ask: "Could we pool help on home repairs, moving days or finding good places to live?",
  },
  childcare_and_care: {
    title: "Sharing childcare and care", label: "childcare and care",
    ask: "Would a childcare swap, a shared sitter list or trading care time help this group?",
  },
  jobs_and_work: {
    title: "Finding work together", label: "finding work",
    ask: "Would it help to share job leads, practice interviews together, or hire from within the group first?",
  },
  learning_and_school: {
    title: "Learning together", label: "learning together",
    ask: "Would a homework circle, tutoring swap or shared class be useful to this group?",
  },
  digital_access: {
    title: "Sharing internet and devices", label: "internet and devices",
    ask: "Would a shared laptop, a device lending list, or help getting online be useful to this group?",
  },
  belonging_connection: {
    title: "More ways to get together", label: "getting together",
    ask: "Would a regular, low-key way to get together help, like a standing meal, a walk or a work session?",
  },
  time_and_workload: {
    title: "Sharing the load", label: "sharing the load",
    ask: "Would trading time help, like childcare swaps, shared errands or splitting chores?",
  },
  safety_access: {
    title: "Getting around safely", label: "getting around safely",
    ask: "Would it help to travel together to evening events, or to agree on places that need better lighting?",
  },
  shared_resources: {
    title: "Sharing tools and equipment", label: "sharing tools",
    ask: "Would a shared tool library or lending list help? What could you lend, or what would you borrow?",
  },
  skills_and_help: {
    title: "Trading skills", label: "trading skills",
    ask: "Would a skills swap help, where members trade what they're good at?",
  },
};

export interface QuestionHypothesis { id: string; themeKey: string; confidence: number; goalLabels: string[] }
export interface AskedQuestion { themeKey: string; createdAt: Date }

/** The fixed post for a theme, or null for a theme with no question. A goal line is added only if it passes the output check. */
export function communityQuestionText(themeKey: string, goalLabels: string[] = []): { title: string; body: string; label: string } | null {
  const question = QUESTIONS[themeKey];
  if (!question) return null;
  const body = `${question.ask}\n\n${CLOSING}`;
  const goal = goalLabels.map((label) => cleanseUntrustedText(label, { maxChars: 80 }).text).find(Boolean);
  const withGoal = goal ? `${question.ask}\n\nThis ties right into one of our goals: ${goal}.\n\n${CLOSING}` : body;
  return { title: question.title, label: question.label, body: goal && checkSageOutput(withGoal).ok ? withGoal : body };
}

/**
 * Which hypothesis, if any, Sage asks about now: none if the Commons was asked in the last two weeks;
 * otherwise the most confident one whose theme has a question and wasn't asked in the last 90 days.
 */
export function pickCommunityQuestion(hypotheses: QuestionHypothesis[], asked: AskedQuestion[], now: Date): QuestionHypothesis | null {
  const since = (days: number) => now.getTime() - days * DAY_MS;
  if (asked.some((entry) => entry.createdAt.getTime() > since(COMMUNITY_QUESTION_COMMONS_COOLDOWN_DAYS))) return null;
  const recentThemes = new Set(asked.filter((entry) => entry.createdAt.getTime() > since(COMMUNITY_QUESTION_THEME_COOLDOWN_DAYS)).map((entry) => entry.themeKey));
  return hypotheses
    .filter((hypothesis) => QUESTIONS[hypothesis.themeKey] && !recentThemes.has(hypothesis.themeKey))
    .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function themeOf(payload: unknown): string | null {
  const theme = (payload as { themeKey?: unknown } | null)?.themeKey;
  return typeof theme === "string" ? theme : null;
}

/** Posts at most one question for a Commons. Idempotent per hypothesis: a hypothesis is asked about once. */
export async function askCommonsAboutHypothesis(coopId: string, hypotheses: QuestionHypothesis[], now = new Date()): Promise<{ asked: boolean; reason?: string; actionId?: string; postId?: string }> {
  if (!hypotheses.length) return { asked: false, reason: "No active community pattern" };
  const previous = await db.commonsAction.findMany({
    where: {
      coopId, type: "ASK_COMMONS", status: { not: "FAILED" },
      createdAt: { gte: new Date(now.getTime() - COMMUNITY_QUESTION_THEME_COOLDOWN_DAYS * DAY_MS) },
    },
    select: { createdAt: true, payload: true },
  });
  const asked = previous.flatMap((row) => {
    const themeKey = themeOf(row.payload);
    return themeKey ? [{ themeKey, createdAt: row.createdAt }] : [];
  });
  const hypothesis = pickCommunityQuestion(hypotheses, asked, now);
  if (!hypothesis) return { asked: false, reason: "Asked recently, or nothing new to ask" };
  const text = communityQuestionText(hypothesis.themeKey, hypothesis.goalLabels)!;
  if (!checkSageOutput(`${text.title}\n${text.body}`).ok) return { asked: false, reason: "The question failed Sage's output check" };

  const sage = await ensureSageBotUser(db, coopId);
  // Claim first: the unique source key keeps one question per hypothesis even if two sweeps overlap.
  let action;
  try {
    action = await db.commonsAction.create({
      data: {
        coopId, sourceType: COMMUNITY_QUESTION_SOURCE, sourceId: hypothesis.id, sourcePostId: hypothesis.id, sourceAuthorId: sage.id,
        contentHash: hypothesis.themeKey, position: 0, type: "ASK_COMMONS", status: "PENDING",
        summary: `Sage asked the Commons about ${text.label}`, confidence: hypothesis.confidence,
        draftText: text.body, generatedDraftText: text.body, charterConfigId: CONFIG_KEY,
        originObservationId: hypothesis.id, payload: { themeKey: hypothesis.themeKey, title: text.title, body: text.body },
        auditEvents: { create: { eventType: "SUGGESTION_CREATED", metadata: { kind: COMMUNITY_QUESTION_SOURCE } } },
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { asked: false, reason: "Already asked about this pattern" };
    throw error;
  }

  try {
    const post = await db.commonsPost.create({
      data: {
        coopId, circleId: `general:${coopId}`, authorId: sage.id, title: text.title, content: text.body,
        tag: "Idea", classification: COMMUNITY_QUESTION_CLASSIFICATION, classificationConfidence: 1,
        classificationSignals: { version: 1, source: COMMUNITY_QUESTION_SOURCE, actionId: action.id },
      },
      select: { id: true },
    });
    // sourcePostId now points at the question itself, so the admin page shows it and can remove it.
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "PUBLISHED", sourcePostId: post.id } });
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "QUESTION_POSTED", metadata: { resultEntityType: "CommonsPost", resultEntityId: post.id } } });
    return { asked: true, actionId: action.id, postId: post.id };
  } catch (error) {
    await db.commonsAction.update({ where: { id: action.id }, data: { status: "FAILED" } }).catch(() => {});
    await db.commonsActionAudit.create({ data: { actionId: action.id, eventType: "ACTION_FAILED", metadata: { error: error instanceof Error ? error.message : String(error) } } }).catch(() => {});
    throw error;
  }
}

/** Distinct members (not Sage) who replied to, reacted to, or supported a question post. Null if the post is gone. */
export async function countQuestionResponders(postId: string): Promise<number | null> {
  const post = await db.commonsPost.findUnique({
    where: { id: postId },
    select: {
      comments: { where: { author: { isBot: false } }, select: { authorId: true } },
      reactions: { where: { user: { isBot: false } }, select: { userId: true } },
      supports: { where: { user: { isBot: false } }, select: { userId: true } },
    },
  });
  if (!post) return null;
  return new Set([
    ...post.comments.map((comment) => comment.authorId),
    ...post.reactions.map((reaction) => reaction.userId),
    ...post.supports.map((support) => support.userId),
  ]).size;
}

import { db } from "@repo/db";

import { createSageTask } from "./sage-tasks.js";

/**
 * Thread facilitation: code, not the model, decides when an active Commons or circle thread needs Sage
 * to step in like an assistant community manager. Detection is pattern- and count-based, reads only the
 * thread itself, and costs nothing. The model is told which kind of help fits (and which reply template)
 * only after code has decided a thread needs it.
 *
 * What triggers it, in priority order:
 * - deferral: the newest comment puts the discussion off ("let's revisit next week"). Sage doesn't
 *   comment; it schedules a SageTask and brings the thread back when it's due (kind "revisit").
 * - unanswered_question: a factual question that later comments show nobody has resolved.
 * - ready_for_proposal: three or more members back a shared purchase or project with concrete details.
 * - disagreement: at least two members push back on each other across three or more comments.
 * - narrow_decision: one or two people settle something in a longer thread nobody else joined.
 * - busy_thread: many comments or participants since Sage last spoke, with no decision yet.
 *
 * Every trigger respects a per-thread cooldown, and each is claimed once (kind plus the comment that
 * tripped it), so Sage comments at most once per trigger.
 */

export const FACILITATION_COOLDOWN_HOURS = 12;
export const BUSY_THREAD_COMMENTS = 8;
export const BUSY_THREAD_PARTICIPANTS = 4;
export const PROPOSAL_SUPPORTERS = 3;
export const DISAGREEMENT_MIN_COMMENTS = 3;
export const THREAD_ENTRY_LIMIT = 60;
export const DEFAULT_REVISIT_DAYS = 3;
/** Recorded with each claimed trigger, so a trigger is only ever claimed once. */
export const FACILITATION_SCAN_TYPE = "thread_facilitation";
export const FACILITATION_SCAN_KEY = "sage-facilitation:v1";
export const THREAD_REVISIT_SUBJECT = "thread_revisit";

const HOUR_MS = 3_600_000;

export type FacilitationKind =
  | "deferral" | "unanswered_question" | "ready_for_proposal" | "disagreement" | "narrow_decision" | "busy_thread" | "revisit";

export interface ThreadEntry {
  id: string;
  authorId: string;
  /** Sage (or any bot). Sage's own comments mark where its last contribution was. */
  isSage: boolean;
  content: string;
  createdAt: Date;
}

export interface ThreadSnapshot {
  postId: string;
  postAuthorId: string;
  title: string;
  content: string;
  createdAt: Date;
  /** Oldest first. */
  comments: ThreadEntry[];
}

export interface FacilitationSignal {
  kind: FacilitationKind;
  /** The reply template that fits (see sage-reply-templates.ts), or null when the right move is an
   * answer, a proposal draft, or no comment at all. */
  template: string | null;
  /** What code saw, in plain words, for the model and the decision trail. */
  reason: string;
  /** The entry that tripped the trigger; with kind, it identifies one trigger. */
  anchorId: string;
  /** For a deferral: how many days until Sage brings the thread back. */
  revisitInDays?: number;
  /** For an unanswered question: its text. */
  question?: string;
  /** For a proposal: who owns the draft (the member who raised the idea). */
  draftOwnerId?: string;
  /** A sparse, deterministic social opening. Code adds it; the model cannot invent flattery. */
  social?: { style: "compliment" | "light_humor"; opening: string };
  /** Why code kept the social tone neutral, shown in the decision trail. */
  socialRestricted?: string;
}

export interface FacilitationResult {
  signal: FacilitationSignal | null;
  /** Why nothing fired even though something might have: the cooldown. */
  blocked?: string;
}

// ── Patterns ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WHEN = String.raw`(later|tomorrow|next (?:week|month|meeting|time)|this weekend|after the (?:weekend|holidays?|meeting)|in a (?:few|couple(?: of)?) (?:days|weeks)|in a week|on (?:mon|tues|wednes|thurs|fri|satur|sun)day)`;
const DEFERRAL_PATTERNS = [
  new RegExp(String.raw`\b(?:let'?s|let us|we (?:can|could|should|will|'ll)|can we|could we|maybe)\s+(?:revisit|come back to|circle back|pick (?:this|it|that) (?:back )?up|table|park|pause|hold off|talk about|decide|discuss|figure (?:this|it|that) out|look at|deal with)\b[^.!?]{0,40}?\b${WHEN}`, "i"),
  /\b(?:let'?s revisit|revisit (?:this|it|that)|circle back (?:on|to) (?:this|it|that)|table (?:this|it) for now|park (?:this|it) for now|put (?:this|it) on hold)\b/i,
  new RegExp(String.raw`\b(?:come back to|pick up|revisit) (?:this|it|that) ${WHEN}`, "i"),
];

const FACTUAL_QUESTION = /^(?:what(?:'s| is| are| was| time| day| does| do we know)|when|where|who|which|how (?:much|many|long|far|often|do|does|did)|does|do (?:we|they|you) (?:know|have)|is (?:there|it|the)|are (?:there|they|the)|can (?:we|you|i)|did|has|have|anyone know|does anyone know)\b/i;
// Discussion prompts and opinions are choices for the group, not facts to look up.
const OPINION_QUESTION = /^(?:should|would (?:you|we|people)|what do (?:you|we|people|y'all) think|what if|thoughts|anyone (?:in|interested|want)|who(?:'s| is) (?:in|around|up for|interested|free)|which (?:one |option )?do (?:you|we|people) (?:prefer|like|want)|how about|what about|why not)\b/i;
const UNCERTAINTY = /\b(?:not sure|no idea|don'?t know|do not know|anyone know|does anyone know|good question|i wonder|unsure|idk|can'?t remember|not certain)\b/i;
const ANSWER_OPENER = /^(?:yes|yeah|yep|no\b|nope|it'?s\b|it is|they(?:'re| are)?\b|the \w+ (?:is|are|closes|opens|costs)|i (?:checked|called|asked|looked)|according to|it (?:closes|opens|costs|starts|ends))/i;
const DISAGREEMENT = /\b(?:i disagree|disagree|i don'?t think|i'?m not sure (?:that|about|it)|not convinced|but what about|that won'?t work|(?:it |that )?wouldn'?t work|too (?:expensive|far|late|early|much|risky)|i'?d (?:rather|prefer)|i prefer|better (?:to|if)|instead|on the other hand|not a good idea|i'?m against|against (?:it|this|that)|the problem is|my concern is|worried (?:that|about))\b/i;
const AGREEMENT = /(?:\+1|\b(?:i agree|agreed|i'?m in|count me in|sounds good|i like (?:this|it|that)|let'?s do it|i'?d support|i support|yes,? let'?s|love (?:this|it|that)|i'?m on board|me too|great idea|i'?d chip in|i can chip in)\b)/i;
const DECISION = /\b(?:let'?s go with|let'?s do (?:it|that|the|saturday|sunday|\w+day)|we'?ll go with|we'?re going with|(?:it'?s |that'?s )?decided|it'?s settled|settled then|that settles it|agreed then|done deal)\b/i;
const SHARED_ACTION = /(?:\$\s?\d|\b(?:buy|rent|fund|pay for|pool|hire|split the cost|chip in|budget|costs?|purchase|lease)\b)/i;
const CONCRETE = /\d/;
const SOCIALLY_SENSITIVE = /\b(?:suicid|self[- ]?harm|emergency|danger|abuse|assault|harass|threat|grie(?:f|ving)|funeral|died|death|bereave|racis|discriminat|sexist|homophob|transphob|ableis|evict(?:ion|ed|ing)?|foreclos|homeless|food insecurity|can'?t afford|cannot afford|medical crisis|job loss|laid off|domestic violence|fraud|scam|retaliat|bully|moderation|moderator|ban(?:ned|ning)?|suspend|remove (?:a )?member|code of conduct)\b/i;

function stableBucket(value: string, size: number): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

/** Social warmth is deterministic and never used in sensitive or conflict-heavy discussions. */
export function socialFacilitationFor(
  thread: ThreadSnapshot,
  signal: Pick<FacilitationSignal, "kind" | "anchorId">,
): Pick<FacilitationSignal, "social" | "socialRestricted"> {
  const text = [thread.title, thread.content, ...thread.comments.map((comment) => comment.content)].join("\n");
  if (SOCIALLY_SENSITIVE.test(text)) {
    return { socialRestricted: "The discussion may be sensitive or high-stakes, so Sage keeps the tone neutral." };
  }
  if (signal.kind === "ready_for_proposal") {
    return { social: { style: "compliment", opening: "You’ve turned this from an idea into a concrete plan members can review." } };
  }
  if (signal.kind === "busy_thread") {
    return stableBucket(`${thread.postId}:${signal.anchorId}`, 2) === 0
      ? { social: { style: "compliment", opening: "You’ve surfaced the constraints clearly; here’s what still needs deciding." } }
      : { social: { style: "light_humor", opening: "This thread has done a few laps; here’s the useful part." } };
  }
  return {};
}

function withSocialFacilitation(thread: ThreadSnapshot, signal: FacilitationSignal): FacilitationSignal {
  if (signal.kind === "disagreement" || signal.kind === "narrow_decision") {
    return { ...signal, socialRestricted: "The discussion involves disagreement or representation, so Sage keeps the tone neutral." };
  }
  return { ...signal, ...socialFacilitationFor(thread, signal) };
}

/** Adds code-approved social warmth once; model-written jokes or compliments are not trusted. */
export function applySocialFacilitation(text: string, signal: FacilitationSignal | undefined): string {
  if (!signal?.social || text.startsWith(signal.social.opening)) return text;
  return `${signal.social.opening}\n\n${text}`;
}

function firstSentenceMatching(text: string, test: (sentence: string) => boolean): string | null {
  const sentences = text.split(/(?<=[?.!])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences.find(test) ?? null;
}

/** The first factual question in a text ("When does the library close?"), or null. Opinion and
 * choice questions ("Should we…?", "What do you think?") are left to the group. */
export function factualQuestion(text: string): string | null {
  return firstSentenceMatching(text, (sentence) => sentence.endsWith("?") && FACTUAL_QUESTION.test(sentence) && !OPINION_QUESTION.test(sentence));
}

export function isDeferral(text: string): boolean {
  return DEFERRAL_PATTERNS.some((pattern) => pattern.test(text));
}

/** Days until Sage brings a deferred thread back, from the words used. Clamped by createSageTask. */
export function revisitDays(text: string, now = new Date()): number {
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) return 1;
  if (/\bnext month\b/.test(lower)) return 14;
  if (/\bcouple(?: of)? weeks\b/.test(lower)) return 14;
  if (/\b(?:next (?:week|meeting|time)|in a week|after the holidays?)\b/.test(lower)) return 7;
  if (/\b(?:this weekend|after the weekend)\b/.test(lower)) return Math.max(1, (6 - now.getUTCDay() + 7) % 7 || 7);
  const day = DAY_NAMES.findIndex((name) => new RegExp(`\\b${name}\\b`).test(lower));
  if (day >= 0) return ((day - now.getUTCDay() + 7) % 7) || 7;
  return DEFAULT_REVISIT_DAYS;
}

// ── Detection ────────────────────────────────────────────────────────────────

interface Turn { id: string; authorId: string; content: string; isPost: boolean }

/** The member turns since Sage last spoke in the thread (the post itself counts while Sage hasn't). */
function turnsSinceSage(thread: ThreadSnapshot): { turns: Turn[]; lastSageAt: Date | null } {
  let lastSage = -1;
  thread.comments.forEach((entry, index) => { if (entry.isSage) lastSage = index; });
  const members = thread.comments.slice(lastSage + 1).filter((entry) => !entry.isSage)
    .map((entry) => ({ id: entry.id, authorId: entry.authorId, content: entry.content, isPost: false }));
  const turns = lastSage < 0
    ? [{ id: thread.postId, authorId: thread.postAuthorId, content: `${thread.title}\n${thread.content}`, isPost: true }, ...members]
    : members;
  return { turns, lastSageAt: lastSage < 0 ? null : thread.comments[lastSage]!.createdAt };
}

function distinct(values: string[]): number {
  return new Set(values).size;
}

function unansweredQuestion(turns: Turn[]): { turn: Turn; question: string } | null {
  for (const [index, turn] of turns.entries()) {
    const question = factualQuestion(turn.content);
    if (!question) continue;
    const later = turns.slice(index + 1);
    const others = later.filter((entry) => entry.authorId !== turn.authorId);
    if (!others.length) continue;
    const doubtIndex = later.reduce((found, entry, position) =>
      (entry.authorId !== turn.authorId && UNCERTAINTY.test(entry.content))
      || (entry.authorId === turn.authorId && factualQuestion(entry.content)) ? position : found, -1);
    if (doubtIndex < 0) continue;
    // Someone may have answered after the last "not sure".
    const answeredSince = later.slice(doubtIndex + 1).some((entry) => entry.authorId !== turn.authorId && ANSWER_OPENER.test(entry.content.trim()));
    if (!answeredSince) return { turn, question };
  }
  return null;
}

/**
 * Decides, from the thread alone, whether Sage should step in and how. `newestId` is the comment that
 * just arrived; triggers only fire on activity since Sage last spoke, and never within the cooldown.
 */
export function detectFacilitation(thread: ThreadSnapshot, now = new Date()): FacilitationResult {
  const { turns, lastSageAt } = turnsSinceSage(thread);
  const newest = turns.at(-1);
  if (!newest || newest.isPost) return { signal: null };

  // A deferral schedules a follow-up rather than a comment, so the comment cooldown doesn't stop it.
  if (isDeferral(newest.content)) {
    const days = revisitDays(newest.content, now);
    return { signal: withSocialFacilitation(thread, {
      kind: "deferral", template: null, anchorId: newest.id, revisitInDays: days,
      reason: `A member put the discussion off ("${clip(newest.content, 120)}"), so Sage brings it back in ${days} day${days === 1 ? "" : "s"} instead of commenting now.`,
    }) };
  }
  if (lastSageAt && now.getTime() - lastSageAt.getTime() < FACILITATION_COOLDOWN_HOURS * HOUR_MS) {
    const hours = Math.max(1, Math.round((now.getTime() - lastSageAt.getTime()) / HOUR_MS));
    return { signal: null, blocked: `Sage commented in this thread ${hours} hour${hours === 1 ? "" : "s"} ago (it waits ${FACILITATION_COOLDOWN_HOURS} hours).` };
  }

  const memberTurns = turns.length;
  const participants = distinct(turns.map((turn) => turn.authorId));

  const unanswered = unansweredQuestion(turns);
  if (unanswered) {
    return { signal: withSocialFacilitation(thread, {
      kind: "unanswered_question", template: "missing-piece", anchorId: unanswered.turn.id, question: unanswered.question,
      reason: `A factual question is still open: "${clip(unanswered.question, 160)}". Later comments show nobody has answered it.`,
    }) };
  }

  const supporters = new Set(turns.filter((turn) => !turn.isPost && AGREEMENT.test(turn.content)).map((turn) => turn.authorId));
  const allText = turns.map((turn) => turn.content).join("\n");
  if (SHARED_ACTION.test(`${thread.title}\n${thread.content}`) || SHARED_ACTION.test(allText)) supporters.add(thread.postAuthorId);
  if (supporters.size >= PROPOSAL_SUPPORTERS && CONCRETE.test(`${thread.content}\n${allText}`) && SHARED_ACTION.test(`${thread.title}\n${thread.content}\n${allText}`)) {
    return { signal: withSocialFacilitation(thread, {
      kind: "ready_for_proposal", template: null, anchorId: newest.id, draftOwnerId: thread.postAuthorId,
      reason: `${supporters.size} members back a shared plan with concrete details, so it's ready to become a proposal draft for the member who raised it.`,
    }) };
  }

  // A real back-and-forth, not one reply: at least three comments (the post doesn't count).
  const pushback = new Set(turns.filter((turn) => DISAGREEMENT.test(turn.content)).map((turn) => turn.authorId));
  const comments = turns.filter((turn) => !turn.isPost).length;
  if (pushback.size >= 2 && comments >= DISAGREEMENT_MIN_COMMENTS) {
    return { signal: withSocialFacilitation(thread, {
      kind: "disagreement", template: "trade-off", anchorId: newest.id,
      reason: `${pushback.size} members are pushing back on each other's options across ${comments} comments, with no decision.`,
    }) };
  }

  const everyone = distinct([thread.postAuthorId, ...thread.comments.filter((entry) => !entry.isSage).map((entry) => entry.authorId)]);
  const totalMemberTurns = 1 + thread.comments.filter((entry) => !entry.isSage).length;
  if (DECISION.test(newest.content) && everyone <= 2 && totalMemberTurns >= 4) {
    return { signal: withSocialFacilitation(thread, {
      kind: "narrow_decision", template: "before-we-decide", anchorId: newest.id,
      reason: `Only ${everyone} member${everyone === 1 ? "" : "s"} have settled this across ${totalMemberTurns} posts and comments; others it affects haven't weighed in.`,
    }) };
  }

  const settled = turns.slice(-2).some((turn) => DECISION.test(turn.content));
  if (!settled && (memberTurns >= BUSY_THREAD_COMMENTS || (participants >= BUSY_THREAD_PARTICIPANTS && memberTurns >= BUSY_THREAD_PARTICIPANTS + 1))) {
    return { signal: withSocialFacilitation(thread, {
      kind: "busy_thread", template: "where-we-are", anchorId: newest.id,
      reason: `${memberTurns} comments from ${participants} members since Sage last spoke, and no decision yet.`,
    }) };
  }
  return { signal: null };
}

/** The signal for bringing a deferred thread back when its follow-up is due. */
export function revisitSignal(anchorId: string, deferredText: string): FacilitationSignal {
  return {
    kind: "revisit", template: "where-we-are", anchorId,
    reason: `The group said it would come back to this ("${clip(deferredText, 120)}"), the time has come, and nobody has picked it up.`,
  };
}

/** What the model is told for a thread code flagged. The kind decides the help; the template is a fit, not a must. */
export function facilitationInstruction(signal: FacilitationSignal): string {
  const instruction = (() => { switch (signal.kind) {
    case "deferral": return "The group put this off for now. Don't comment; Sage will bring it back later.";
    case "unanswered_question": return `Answer this open question if a source you can check has the fact: "${signal.question}". If nothing you can check answers it, use the Missing piece template: name the fact and who could supply it (a role, not a name).`;
    case "ready_for_proposal": return "Members agree on a shared plan with details. Include MAKE_PROPOSAL drafted from what members said (the draft goes to the member who raised it). A short Where we are reply may accompany it.";
    case "disagreement": return "Members disagree. Use the Trade-off template: lay out the options evenly, what each costs or risks, and the one fact that would decide it. Don't take a side.";
    case "narrow_decision": return "A few people are settling something that may affect others who haven't spoken. Use the Before we decide template. Name an affected group only when the thread or a checked source explicitly supports it; otherwise say other affected members and ask who else is affected.";
    case "busy_thread": return "The thread is long with no decision. Use the Where we are template: what's agreed, what's still open, and the question that would settle it.";
    case "revisit": return "The group said it would come back to this, and it's time. Use the Where we are template to summarize where it was left and ask whether the group is ready to decide.";
  } })();
  if (signal.social) return `${instruction} Code will add one approved ${signal.social.style.replace("_", " ")} opening; don't add another joke, compliment, greeting, or flourish.`;
  return `${instruction} Keep the tone direct and neutral; don't add a joke, compliment, greeting, or flourish.`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ── Data access ──────────────────────────────────────────────────────────────

/** The thread as code reads it: the post and its latest comments, oldest first. */
export async function loadThread(postId: string): Promise<ThreadSnapshot | null> {
  const post = await db.commonsPost.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, title: true, content: true, createdAt: true },
  });
  if (!post) return null;
  const comments = await db.commonsComment.findMany({
    where: { postId }, orderBy: { createdAt: "desc" }, take: THREAD_ENTRY_LIMIT,
    select: { id: true, authorId: true, content: true, createdAt: true, author: { select: { isBot: true } } },
  });
  return {
    postId: post.id, postAuthorId: post.authorId, title: post.title, content: post.content, createdAt: post.createdAt,
    comments: comments.reverse().map((comment) => ({
      id: comment.id, authorId: comment.authorId, isSage: comment.author.isBot, content: comment.content, createdAt: comment.createdAt,
    })),
  };
}

/** The thread as it stood when a comment arrived, so a scan that runs late reads the same thread. */
export function threadUpTo(thread: ThreadSnapshot, commentId: string): ThreadSnapshot {
  const index = thread.comments.findIndex((comment) => comment.id === commentId);
  return index < 0 ? thread : { ...thread, comments: thread.comments.slice(0, index + 1) };
}

/**
 * Claims one trigger for one thread: refused if this exact trigger was already claimed, or if Sage tried
 * to facilitate this thread within the cooldown (whatever came of it), so a thread that keeps tripping a
 * trigger doesn't cost a model call per comment. Deferrals schedule a follow-up, not a comment, so they
 * neither wait for nor start the cooldown.
 */
export async function claimFacilitation(coopId: string, postId: string, signal: FacilitationSignal, now = new Date()): Promise<{ claimed: boolean; reason?: string }> {
  if (signal.kind !== "deferral" && signal.kind !== "revisit") {
    const recent = await db.commonsContentScan.findFirst({
      where: {
        sourceType: FACILITATION_SCAN_TYPE, sourceId: postId, charterConfigId: FACILITATION_SCAN_KEY,
        scannedAt: { gt: new Date(now.getTime() - FACILITATION_COOLDOWN_HOURS * HOUR_MS) },
        NOT: { contentHash: { startsWith: "deferral:" } },
      },
      select: { contentHash: true, scannedAt: true },
    });
    if (recent) return { claimed: false, reason: `Sage already stepped into this thread within the last ${FACILITATION_COOLDOWN_HOURS} hours (${recent.contentHash.split(":")[0]}).` };
  }
  try {
    await db.commonsContentScan.create({ data: {
      coopId, sourceType: FACILITATION_SCAN_TYPE, sourceId: postId, contentHash: `${signal.kind}:${signal.anchorId}`,
      charterConfigId: FACILITATION_SCAN_KEY, status: "SUCCESS", scannedAt: now,
    } });
    return { claimed: true };
  } catch {
    return { claimed: false, reason: "This trigger was already handled." };
  }
}

/**
 * A deferral becomes a SageTask owned by the member who deferred, so it shows under their Following and
 * the wake loop brings the thread back when it's due. One open revisit per thread.
 */
export async function scheduleThreadRevisit(input: {
  coopId: string; circleId: string | null; postId: string; postTitle: string; commentId: string; ownerUserId: string;
  deferredText: string; days: number; sourceActionId?: string | null;
}): Promise<{ created: boolean; reason?: string; taskId?: string }> {
  const open = await db.sageTask.findFirst({
    where: { subjectType: THREAD_REVISIT_SUBJECT, subjectId: input.postId, status: "OPEN" }, select: { id: true, dueAt: true },
  });
  if (open) return { created: false, taskId: open.id, reason: `Sage is already bringing this back on ${open.dueAt.toISOString().slice(0, 10)}` };
  return createSageTask({
    coopId: input.coopId, circleId: input.circleId, kind: "FOLLOW_UP",
    title: `Bring back: ${input.postTitle || "a discussion"}`.slice(0, 160),
    reason: `A member put the discussion off: "${clip(input.deferredText, 300)}"`,
    expected: "the group picks the discussion back up", offer: "I can summarize where we left it so we can decide",
    ownerUserId: input.ownerUserId, subjectType: THREAD_REVISIT_SUBJECT, subjectId: input.postId, postId: input.postId,
    sourceActionId: input.sourceActionId ?? null, dueInDays: input.days,
  });
}

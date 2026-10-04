/**
 * Defenses against members steering Sage or the proposal engine through what they write.
 *
 * Inputs: every member-written text is cleansed before it reaches a model (hidden and zero-width
 * characters removed, lookalike Unicode normalized, padding collapsed, length capped) and checked for
 * instruction-like text aimed at the AI. Flagged text is still analyzed - it may be a legitimate
 * proposal or question - but callers stop Sage from acting on it alone: comments and replies go to a
 * person for review, and a flagged proposal can't be auto-approved.
 *
 * Outputs: anything Sage would publish by itself is checked first - no links, no @mentions, no claims
 * of having taken real-world actions, no echoed instructions, and a length limit.
 */

export type InputFlag = "HIDDEN_CHARACTERS" | "INSTRUCTION_LIKE_TEXT" | "TRUNCATED";

export interface CleansedText {
  text: string;
  flags: InputFlag[];
  /** The instruction-like phrases found, for the decision trail. */
  matches: string[];
}

// Control characters (except tab/newline), soft hyphen, zero-width and joiner characters, bidi
// overrides and isolates, word joiners, BOM, interlinear annotations, and Unicode "tag" characters
// that can smuggle invisible text.
const HIDDEN_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿￹-￻]|[\u{E0000}-\u{E007F}]/gu;

// Markers models treat as structure. Members can't use them to fake a boundary or a new role.
const STRUCTURE_MARKERS = /<<<|>>>|<\|[^|>]{0,40}\|>|\[\/?(?:INST|SYS)\]/gi;

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|the|these|those)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules?|directions?|guidelines?|polic(?:y|ies))\b/i,
  /\b(?:you are now|from now on,? you|pretend (?:to be|you are)|act as (?:an?|the) (?:admin|administrator|system|developer|moderator))\b/i,
  /(?:^|\n)\s*(?:system|developer|assistant)\s*(?:prompt|message|instructions?)?\s*:/i,
  /\b(?:reveal|print|show|repeat|output)\b[^.\n]{0,30}\b(?:system prompt|your instructions|hidden prompt|initial prompt)\b/i,
  /\b(?:set|give|assign|score|rate|mark)\b[^.\n]{0,40}\b(?:score|confidence|rating|alignment)\b[^.\n]{0,25}\b(?:to|of|as|at)\s*(?:1(?:\.0+)?|100\s*%|10\s*\/\s*10|maximum|max|perfect)(?![\w.])/i,
  /\b(?:approve|pass|advance|accept)\b[^.\n]{0,20}\b(?:this|the|my)\s+(?:proposal|request)\b[^.\n]{0,40}\b(?:automatically|regardless|no matter|without (?:review|checks?|questions?))\b/i,
  /\b(?:as an ai|as the ai|ai reviewer|language model)\b[^.\n]{0,40}\b(?:must|should|will|have to)\b/i,
];

export function cleanseUntrustedText(raw: string | null | undefined, options: { maxChars: number }): CleansedText {
  const flags = new Set<InputFlag>();
  let text = (raw ?? "").normalize("NFKC");
  const withoutHidden = text.replace(HIDDEN_CHARACTERS, "");
  if (withoutHidden !== text) flags.add("HIDDEN_CHARACTERS");
  text = withoutHidden.replace(STRUCTURE_MARKERS, " ");
  // Collapse padding used to push instructions out of view.
  text = text.replace(/[ \t]{3,}/g, "  ").replace(/\n{3,}/g, "\n\n").trim();

  const matches = INSTRUCTION_PATTERNS.flatMap((pattern) => {
    const match = text.match(pattern);
    return match ? [match[0].trim().slice(0, 120)] : [];
  });
  if (matches.length) flags.add("INSTRUCTION_LIKE_TEXT");

  if (text.length > options.maxChars) {
    text = text.slice(0, options.maxChars);
    flags.add("TRUNCATED");
  }
  return { text, flags: [...flags], matches };
}

export function mergeFlags(results: CleansedText[]): { flags: InputFlag[]; matches: string[] } {
  return {
    flags: [...new Set(results.flatMap((result) => result.flags))],
    matches: [...new Set(results.flatMap((result) => result.matches))].slice(0, 5),
  };
}

export function isSteeringAttempt(flags: InputFlag[]): boolean {
  return flags.includes("INSTRUCTION_LIKE_TEXT");
}

/** One-line description of input flags for a decision-trail policy step. */
export function describeInputFlags(result: { flags: InputFlag[]; matches: string[] }): string | undefined {
  const parts = [
    result.flags.includes("INSTRUCTION_LIKE_TEXT") ? `Instruction-like text: ${result.matches.map((match) => `"${match}"`).join(", ")}` : "",
    result.flags.includes("HIDDEN_CHARACTERS") ? "Hidden characters were removed." : "",
    result.flags.includes("TRUNCATED") ? "Long text was shortened." : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

// ── Output check ────────────────────────────────────────────────────────────

export type OutputProblem = "EMPTY" | "TOO_LONG" | "LINK" | "MENTION" | "ACTION_CLAIM" | "INSTRUCTION_ECHO";

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|ly|me|info|biz|xyz|link|click)(?:\/\S*)?\b/gi;
const MENTION = /\[@[^\]]+\]|(?:^|[\s(])@[a-z0-9_.-]{2,}/gi;
const ACTION_CLAIM = /\b(?:I|I've|I have|Sage|Sage has|we have)\s+(?:just\s+)?(?:approved|transferred|sent|paid|refunded|voted|removed|banned|suspended|deleted|submitted|funded|granted|revoked|changed your role)\b/i;

export interface OutputCheck {
  ok: boolean;
  problems: OutputProblem[];
  /** The text with links and mentions removed, for replies a member asked for. */
  cleaned: string;
}

export const SAGE_OUTPUT_MAX_CHARS = 1200;

export function checkSageOutput(text: string): OutputCheck {
  const problems = new Set<OutputProblem>();
  const trimmed = text.trim();
  if (!trimmed) problems.add("EMPTY");
  if (trimmed.length > SAGE_OUTPUT_MAX_CHARS) problems.add("TOO_LONG");
  if (new RegExp(LINK.source, "i").test(trimmed)) problems.add("LINK");
  if (new RegExp(MENTION.source, "i").test(trimmed)) problems.add("MENTION");
  if (ACTION_CLAIM.test(trimmed)) problems.add("ACTION_CLAIM");
  if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(trimmed))) problems.add("INSTRUCTION_ECHO");
  const cleaned = trimmed.replace(LINK, "").replace(MENTION, (match) => match.replace(/\[?@[^\]\s]*\]?/, "").trimEnd())
    .replace(/[ \t]{2,}/g, " ").trim().slice(0, SAGE_OUTPUT_MAX_CHARS);
  return { ok: problems.size === 0, problems: [...problems], cleaned };
}

const PROBLEM_LABEL: Record<OutputProblem, string> = {
  EMPTY: "it was empty", TOO_LONG: `it was over ${SAGE_OUTPUT_MAX_CHARS} characters`, LINK: "it contained a link",
  MENTION: "it @mentioned someone", ACTION_CLAIM: "it claimed Sage took a real-world action",
  INSTRUCTION_ECHO: "it repeated instruction-like text",
};

export function describeOutputProblems(problems: OutputProblem[]): string | undefined {
  return problems.length ? `Failed because ${problems.map((problem) => PROBLEM_LABEL[problem]).join(", ")}.` : undefined;
}

/** Problems serious enough that a reply a member asked for is replaced rather than cleaned up. */
export function isUnsafeReply(problems: OutputProblem[]): boolean {
  return problems.includes("ACTION_CLAIM") || problems.includes("INSTRUCTION_ECHO") || problems.includes("EMPTY");
}

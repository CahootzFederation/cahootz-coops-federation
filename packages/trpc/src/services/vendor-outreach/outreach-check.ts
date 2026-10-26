/**
 * Checks any wording that goes into an outreach email that code didn't write:
 * Sage's personal line and an admin's extra line. Code writes the facts, prices
 * and terms; this text may only say why the business seems like a good fit.
 */
const PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|co|io|us)\b/i, reason: "it includes a link" },
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, reason: "it includes an email address" },
  { pattern: /@\w/, reason: "it mentions a handle" },
  { pattern: /\$\s?\d|\d+\s?(dollars|cents|%|percent)\b/i, reason: "it mentions a price or percentage" },
  {
    pattern: /\b(guarantee[sd]?|promise[sd]?|contract|we will (buy|purchase|order)|we'll (buy|purchase|order)|deal is (done|set|agreed)|already agreed|committed to)\b/i,
    reason: "it makes a promise only a person can make",
  },
  { pattern: /\b(approved|endorsed|recommended) by\b/i, reason: "it claims someone approved this" },
  { pattern: /\b(ai|a\.i\.|artificial intelligence|sage|chatbot|bot|assistant|automated|language model)\b/i, reason: "it talks about how the email was written" },
  { pattern: /\b(church|congregation|pastor|parish|ministry)\b/i, reason: "it could identify the community" },
];

export function checkOutreachText(
  text: string,
  options: { maxChars?: number; forbiddenNames?: string[] } = {},
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "it's empty" };
  if (trimmed.length > (options.maxChars ?? 600)) return { ok: false, reason: "it's too long" };
  for (const { pattern, reason } of PATTERNS) {
    if (pattern.test(trimmed)) return { ok: false, reason };
  }
  const lower = trimmed.toLowerCase();
  for (const name of options.forbiddenNames ?? []) {
    const clean = name.trim().toLowerCase();
    if (clean.length >= 3 && lower.includes(clean)) return { ok: false, reason: "it names the community" };
  }
  return { ok: true };
}

/** Title comparison shared by Sage's repeat check and its suggestion follow-up. */

const TITLE_STOPWORDS = new Set(["a", "an", "the", "for", "to", "of", "and", "our", "your", "in", "on", "at", "with", "about", "this", "that", "some"]);

/** Rough singular form so "libraries"/"library" and "days"/"day" match; not a full stemmer. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function titleWords(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((word) => word && !TITLE_STOPWORDS.has(word))
    .map(singular));
}

/** Near-identical: the same meaningful words (ignoring case, punctuation, filler words and plurals),
 * mostly overlapping, or one title's words all contained in the other's. */
export function titlesNearlyIdentical(a: string, b: string): boolean {
  const left = titleWords(a);
  const right = titleWords(b);
  if (!left.size || !right.size) return false;
  const shared = [...left].filter((word) => right.has(word)).length;
  if (shared / new Set([...left, ...right]).size >= 0.75) return true;
  const smaller = Math.min(left.size, right.size);
  return smaller >= 2 && shared === smaller;
}

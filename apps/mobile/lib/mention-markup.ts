import {
  generateValueFromMentionStateAndChangedText,
  replaceTriggerValues,
  type Part,
  type TriggersConfig,
} from 'react-native-controlled-mentions';

/**
 * Single mention trigger shared by every composer in the app. The rendered
 * pill text is `@{handle}` (name === handle, since backend mention
 * resolution is purely handle-based - see packages/trpc/src/lib/mentions.ts).
 */
export const MENTION_TRIGGERS_CONFIG: TriggersConfig<'mention'> = {
  mention: {
    trigger: '@',
    textStyle: { fontWeight: 'bold', color: '#B91C1C' },
  },
};

const BRACKET_MENTION_RE = /\[@([a-zA-Z0-9_-]+)\]/g;

/**
 * Converts the backend's canonical stored form (`[@handle]`, as written by
 * encodeMentions on the server) into this library's internal raw markup
 * (`{@}[handle](handle)`), so an existing comment's mentions render as
 * interactive pills when it's opened for editing.
 */
export function bracketMentionsToMarkup(text: string): string {
  return text.replace(BRACKET_MENTION_RE, (_full, handle: string) => `{@}[${handle}](${handle})`);
}

/**
 * Converts this library's internal raw markup value back into the plain
 * `@handle` text the backend expects (it re-resolves and re-encodes `@handle`
 * tokens itself - see encodeMentions). Used right before submitting a post,
 * comment, or DM.
 */
export function markupToPlainMentions(value: string): string {
  return replaceTriggerValues(value, ({ name }) => `@${name}`);
}

/**
 * Given the OLD raw markup value's parsed mention state and the RAW markup
 * produced by a naive text edit, detects whether the edit partially clipped
 * one or more mention pills (rather than cleanly removing them whole or
 * leaving them untouched) and, if so, expands the edit so the entire pill(s)
 * are removed atomically - this is what makes backspacing into a mention
 * delete the whole thing in one step instead of eating it letter by letter.
 *
 * Operates on plain text (the human-visible string, e.g. "Hey @sage, ..."),
 * not the raw markup - `oldParts`/`oldPlainText` come from the mention
 * library's own parsed state for the CURRENT (pre-edit) value.
 */
export function applyAtomicMentionGuard(
  oldPlainText: string,
  newPlainText: string,
  oldParts: Part[],
): string {
  const maxCommonStart = Math.min(oldPlainText.length, newPlainText.length);
  let start = 0;
  while (start < maxCommonStart && oldPlainText[start] === newPlainText[start]) {
    start++;
  }

  let oldEnd = oldPlainText.length;
  let newEnd = newPlainText.length;
  while (oldEnd > start && newEnd > start && oldPlainText[oldEnd - 1] === newPlainText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  // Pure insertion (nothing removed) - no mention could have been partially eaten.
  if (oldEnd <= start) {
    return newPlainText;
  }

  const touchedMentions = oldParts.filter(
    (part) => part.data && part.position.start < oldEnd && part.position.end > start,
  );

  if (touchedMentions.length === 0) {
    return newPlainText;
  }

  const expandedStart = Math.min(start, ...touchedMentions.map((p) => p.position.start));
  const expandedEnd = Math.max(oldEnd, ...touchedMentions.map((p) => p.position.end));
  const insertedText = newPlainText.slice(start, newEnd);

  return oldPlainText.slice(0, expandedStart) + insertedText + oldPlainText.slice(expandedEnd);
}

/**
 * Applies an edited plain-text value against the current mention state,
 * atomically dropping any partially-clipped mention, and returns the new
 * raw markup value ready to feed back into the composer's controlled state.
 */
export function reconcileMentionEdit(
  oldPlainText: string,
  oldParts: Part[],
  newPlainText: string,
): string {
  const corrected = applyAtomicMentionGuard(oldPlainText, newPlainText, oldParts);
  return generateValueFromMentionStateAndChangedText({ plainText: oldPlainText, parts: oldParts }, corrected);
}

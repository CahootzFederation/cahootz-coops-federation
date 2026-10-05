/**
 * Plain wording for when voting on a proposal closes. Used by the proposal
 * detail screen and the proposal hub cards so both say the same thing.
 */

export interface VotingDeadlineProposal {
  status: string;
  /** ISO date when voting closes (set once the proposal is open for voting). */
  votingEndsAt?: string | null;
  /** ISO date of the proposal's last change; roughly when a decided proposal was decided. */
  updatedAt?: string | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DECIDED = new Set(['approved', 'rejected', 'funded', 'failed']);

function parse(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Oct 14", with the year added when it isn't this year. */
export function shortDate(date: Date, now = new Date()): string {
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** "5:00 PM" */
export function clockTime(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Whole calendar days from today to the date, in the member's own time zone. */
export function calendarDaysUntil(date: Date, now = new Date()): number {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(date) - startOf(now)) / 86_400_000);
}

/** "today", "tomorrow" or "in 3 days". */
function whenFromNow(date: Date, now: Date): string {
  const days = calendarDaysUntil(date, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function isOpen(proposal: VotingDeadlineProposal) {
  return proposal.status.toLowerCase() === 'votable';
}

/**
 * The line for the top of the proposal detail screen:
 * "Voting closes Tue, Oct 14 at 5:00 PM (in 3 days)", "Voting closed Oct 14"
 * or "Decided Oct 14". Null for drafts, proposals in review, withdrawn
 * proposals, and when there's no date to show.
 */
export function votingDeadlineLine(proposal: VotingDeadlineProposal, now = new Date()): string | null {
  const endsAt = parse(proposal.votingEndsAt);

  if (isOpen(proposal)) {
    if (!endsAt) return null;
    if (endsAt.getTime() <= now.getTime()) return `Voting closed ${shortDate(endsAt, now)}`;
    const day = `${DAYS[endsAt.getDay()]}, ${shortDate(endsAt, now)}`;
    return `Voting closes ${day} at ${clockTime(endsAt)} (${whenFromNow(endsAt, now)})`;
  }

  if (DECIDED.has(proposal.status.toLowerCase())) {
    // A council can decide before the window ends, so use whichever came first.
    const candidates = [endsAt, parse(proposal.updatedAt)].filter((d): d is Date => d !== null);
    if (candidates.length === 0) return null;
    const decided = new Date(Math.min(...candidates.map((d) => d.getTime())));
    return `Decided ${shortDate(decided, now)}`;
  }

  return null;
}

/**
 * The short label for a proposal card: "Closes in 3 days", "Closes tomorrow",
 * "Closes today" or "Voting closed". Null unless the proposal is open for voting
 * and has an end date.
 */
export function votingDeadlineShort(proposal: VotingDeadlineProposal, now = new Date()): string | null {
  if (!isOpen(proposal)) return null;
  const endsAt = parse(proposal.votingEndsAt);
  if (!endsAt) return null;
  if (endsAt.getTime() <= now.getTime()) return 'Voting closed';
  return `Closes ${whenFromNow(endsAt, now)}`;
}

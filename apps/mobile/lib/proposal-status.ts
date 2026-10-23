/**
 * Plain words for a proposal's status. The server sends enum values like
 * "votable" or "SUBMITTED"; members should never see those.
 */

const BADGE_LABELS: Record<string, string> = {
  submitted: 'Being checked',
  votable: 'Open for discussion',
  approved: 'Approved',
  funded: 'Funded',
  rejected: 'Not approved',
  failed: 'Not approved',
  withdrawn: 'Withdrawn',
};

const SENTENCE_WORDS: Record<string, string> = {
  submitted: 'being checked',
  votable: 'open for discussion',
  approved: 'approved',
  funded: 'funded',
  rejected: 'not approved',
  failed: 'not approved',
  withdrawn: 'withdrawn',
};

function fallback(status: string) {
  return status.toLowerCase().replace(/_/g, ' ');
}

/** A short label for a status badge, like "Open for discussion". */
export function proposalStatusLabel(status?: string | null) {
  if (!status) return 'Open';
  const key = status.toLowerCase();
  if (BADGE_LABELS[key]) return BADGE_LABELS[key];
  const words = fallback(status);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The status as words inside a sentence, like "This proposal is now approved." */
export function plainProposalStatus(status?: string | null) {
  if (!status) return 'open';
  return SENTENCE_WORDS[status.toLowerCase()] ?? fallback(status);
}

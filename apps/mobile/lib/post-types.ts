export const INTENT_POST_TYPES = Object.freeze([
  { value: 'Thought', label: 'thought' },
  { value: 'Ask', label: 'ask' },
  { value: 'Offer', label: 'offer' },
  { value: 'Event', label: 'event' },
  { value: 'Project', label: 'project' },
  { value: 'Proposal', label: 'proposal' },
  { value: 'Product', label: 'product' },
  { value: 'Update', label: 'update' },
  { value: 'Decision', label: 'decision' },
  { value: 'Receipt', label: 'receipt' },
] as const);

export const LEGACY_POST_TYPES = Object.freeze([
  'Social',
  'Meme',
  'Win',
  'Need',
  'Idea',
  'Vote',
  'Resource',
  'Opportunity',
] as const);

export type IntentPostType = (typeof INTENT_POST_TYPES)[number]['value'];
export type LegacyPostType = (typeof LEGACY_POST_TYPES)[number];
export type CommonsPostTag = IntentPostType | LegacyPostType;
export type SelectedPostType = IntentPostType | null;

export const DEFAULT_POST_TYPE: SelectedPostType = null;

export function postTypeLabel(value: CommonsPostTag | null | undefined) {
  if (!value) return '';
  return INTENT_POST_TYPES.find((type) => type.value === value)?.label ?? value.toLowerCase();
}

export function shouldShowPostType(value: CommonsPostTag | null | undefined) {
  return !!value && INTENT_POST_TYPES.some((type) => type.value === value);
}

export function postTypePlaceholder(value: CommonsPostTag | null | undefined) {
  switch (value) {
    case 'Ask':
      return 'What do you need help with?';
    case 'Offer':
      return 'What can you offer?';
    case 'Event':
      return 'What is happening, when, and where?';
    case 'Project':
      return 'What are you working on?';
    case 'Proposal':
      return 'What should the group consider?';
    case 'Product':
      return 'What are you listing or selling?';
    case 'Update':
      return 'What changed?';
    case 'Decision':
      return 'What was decided?';
    case 'Receipt':
      return 'What should be recorded?';
    default:
      return "Share what's happening...";
  }
}

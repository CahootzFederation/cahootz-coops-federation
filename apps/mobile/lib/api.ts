import type {
  NotificationCategory,
  NotificationCursor,
  NotificationPage,
  NotificationPreferences,
} from '@repo/validators/notification';

import type { CommonsPostTag } from './post-types';
// Expo-compatible API client for Cahootz co-op applications
// Uses native fetch API - no additional dependencies required

import { getApiUrl, getWebUrl, networkConfig } from './config';
import { apiError, httpError } from './friendly-error';
import { coopConfig } from './coop-config';

/**
 * Resolve the coopId to use for public marketplace queries.
 * Prefer the authenticated user's coop (from coopConfig), then the
 * EXPO_PUBLIC_COOP_ID env override, and finally fall back to 'soulaan'.
 */
export function resolveCoopId(): string {
  const fromConfig = coopConfig().id;
  if (fromConfig && fromConfig !== 'default') return fromConfig;
  return 'error-no-coop-id';
}

// API configuration
export const API_BASE_URL = getApiUrl();

/**
 * Session expiry detection.
 *
 * Individual API calls don't go through a shared response-reading helper (each
 * endpoint parses its own response), so we can't centralize this at that layer.
 * Instead we patch `fetch` once and watch for 401s from our own backend - that
 * catches every endpoint, present and future, without touching call sites.
 *
 * Not every 401 means the account session expired - `x-wallet-address`-gated
 * endpoints (privateProcedure/authenticatedProcedure) also throw 401 for
 * unrelated reasons (no wallet address on this call, invalid signature, wrong
 * password, expired login code). Only `accountAuthenticatedProcedure` uses the
 * literal message below when the session token itself is invalid/expired, so
 * we match on that instead of the status code alone.
 */
const SESSION_EXPIRED_MESSAGE = /session expired/i;

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener) {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function notifySessionExpired() {
  sessionExpiredListeners.forEach((listener) => listener());
}

declare global {
  // eslint-disable-next-line no-var
  var __soulaanOriginalFetch: typeof fetch | undefined;
}

async function checkForSessionExpiry(response: Response) {
  try {
    const body = await response.clone().json();
    const message: unknown = body?.error?.message;
    if (typeof message === 'string' && SESSION_EXPIRED_MESSAGE.test(message)) {
      notifySessionExpired();
    }
  } catch {
    // Non-JSON 401 body - not one of our tRPC error responses, ignore.
  }
}

function installSessionExpiryInterceptor() {
  const baseFetch = globalThis.__soulaanOriginalFetch ?? globalThis.fetch;
  globalThis.__soulaanOriginalFetch = baseFetch;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const response = await baseFetch(...args);

    const url =
      typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    if (response.status === 401 && url.startsWith(API_BASE_URL)) {
      void checkForSessionExpiry(response);
    }

    return response;
  }) as typeof fetch;
}

installSessionExpiryInterceptor();

/**
 * Helper to create headers with optional wallet address
 * Used for authenticated requests that require wallet verification
 */
export function createApiHeaders(
  walletAddress?: string | null,
  sessionToken?: string | null,
): HeadersInit {
  const headers: Record<string, string> = {
    ...networkConfig.defaultHeaders,
  };

  // Add wallet address header if provided (for privateProcedure endpoints)
  if (walletAddress) {
    headers['x-wallet-address'] = walletAddress;
  }

  if (sessionToken) {
    headers['x-session-token'] = sessionToken;
  }

  return headers;
}

/** One payment as its receipt shows it (`p2p.getTransfer`). */
export interface TransferReceipt {
  id: string;
  direction: 'sent' | 'received' | 'pending';
  amount: number;
  fee: number;
  counterparty: string;
  status: string;
  transferType: 'PERSONAL' | 'RENT' | 'SERVICE' | 'STORE';
  storeName: string | null;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * A short, readable payment reference: the last 8 characters of the payment
 * id in capitals, split in two ("K7QX-2M9P"). Easy to read out to support.
 */
export function formatPaymentReference(id: string): string {
  const tail = id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
  return tail.length > 4 ? `${tail.slice(0, 4)}-${tail.slice(4)}` : tail;
}

/** "Oct 5, 2026 at 2:30 PM" in the member's own time zone. */
export function formatReceiptDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

// Application submission types
export interface ApplicationData {
  // Coop identification
  coopId: string;

  // Personal Information
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password?: string;
  confirmPassword?: string;

  // Media Uploads (optional)
  videoCID?: string;
  photoCID?: string;

  // Terms Agreement
  agreeToCoopValues: boolean;
  agreeToTerms: boolean;
  agreeToPrivacy: boolean;

  // Co-op configured question answers
  dynamicAnswers?: Record<string, any>;

  // Allow dynamic question answers
  [key: string]: any;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface EmailCodeAuthResult {
  success: boolean;
  message: string;
  user?: {
    id: string;
    email: string;
    handle: string;
    name: string | null;
    roles: string[];
    status: string;
    walletAddress: string | null;
    phone: string | null;
    createdAt: string;
    selfDescription: string | null;
    shortTermGoals: string | null;
    longTermGoals: string | null;
    skills: string[];
    interests: string[];
    resourcesOffered: string[];
    resourcesNeeded: string[];
    businessSummary: string | null;
    locationSummary: string | null;
    profileSignals?: unknown;
    profileOnboardingCompletedAt: string | null;
    sessionToken: string;
    coop?: {
      id: string;
      name: string;
      shortName: string;
      apiUrl: string;
      webUrl: string;
      primaryColor?: string;
      accentColor?: string;
      logoUrl?: string;
    };
  };
}

export interface WalletInfo {
  walletId: string | null;
  address: string;
  walletType: 'EXTERNAL' | 'MANAGED' | null;
  isPrimary: boolean;
  verifiedAt?: string;
  walletCreatedAt?: string;
  hasWallet: boolean;
}

export interface WaitlistSignupData {
  email: string;
  name?: string;
  suggestedCoop?: string;
}

export interface CommonsSuggestionData {
  name: string;
  reason?: string;
  email: string;
  suggestedByName?: string;
  coopId?: string;
}

export interface NewsletterSubmissionData {
  coopId: string;
  type: 'article' | 'event';
  title: string;
  summary: string;
  date?: string;
  location?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  imageUrl?: string;
}

export interface CommonsComment {
  id: string;
  authorId?: string;
  author: string;
  authorHandle?: string;
  /** Written by Sage (or another AI account), so the app labels it. */
  authorIsAi?: boolean;
  /** How many members liked (❤️) this comment. */
  reactionCount?: number;
  /** Whether the signed-in viewer has liked this comment. */
  viewerReacted?: boolean;
  /** Every emoji reaction, the like included, in first-used order. */
  reactions?: ReactionSummary[];
  body: string;
  supporterBadge?: SupporterBadge | null;
  media?: CommonsPostMedia[];
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  viewerReacted: boolean;
}

export interface WelcomeIntroStatus {
  /** True when the lounge feed should prompt this member for an intro. */
  eligible: boolean;
  /** The lounge's Sage welcome post, where intros are posted as comments. */
  welcomePostId: string | null;
  prompt: string;
  intro: { id: string; commentId: string; respondedAt: string | null } | null;
}

export interface SupporterBadge {
  tier: string;
  name: string;
  shortName: string;
  color: string;
}

export interface CommonsPostMedia {
  id?: string;
  pathname: string;
  url: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
}

export interface CircleGalleryItem extends CommonsPostMedia {
  id: string;
  createdAt: string;
  postId: string;
  postTitle: string;
  author: string;
}

export type EventRsvpStatus = 'GOING' | 'MAYBE' | 'CANT_GO';
export type EventRecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface EventHostSummary {
  id: string;
  name: string;
  handle: string;
}

export interface EventSummary {
  id: string;
  postId?: string;
  coopId?: string;
  circleId?: string | null;
  title?: string;
  startAt: string;
  endAt: string;
  isOnline: boolean;
  location: string | null;
  meetingUrl: string | null;
  allowComments: boolean;
  seriesId?: string | null;
  recurrenceFreq?: EventRecurrenceFreq | null;
  recurrenceInterval?: number;
  recurrenceCount?: number | null;
  hosts: EventHostSummary[];
  goingCount: number;
  maybeCount: number;
  cantGoCount: number;
  viewerRsvpStatus: EventRsvpStatus | null;
}

export interface EventDetail extends EventSummary {
  post: {
    id: string;
    title: string;
    body: string;
    author: string;
    authorHandle?: string;
    replies: number;
    support: number;
    media: CommonsPostMedia[];
    comments: CommonsComment[];
  };
}

export interface CommonsPost {
  id: string;
  createdAt?: string;
  coopId?: string;
  circleId?: string;
  authorId?: string;
  author: string;
  authorHandle?: string;
  /** Written by Sage (or another AI account), so the app labels it. */
  authorIsAi?: boolean;
  supporterBadge?: SupporterBadge | null;
  group: string;
  time: string;
  title: string;
  body: string;
  tag: CommonsPostTag;
  classification?: string;
  replies: number;
  support: number;
  /** Emoji reactions other than the like (❤️, counted in `support`). */
  reactions?: ReactionSummary[];
  pledges?: string;
  isPinned?: boolean;
  event?: EventSummary;
  media: CommonsPostMedia[];
  comments: CommonsComment[];
}

export interface SearchPerson {
  id: string;
  name: string;
  handle: string;
}

export interface PrivateGroupSummary {
  id: string;
  name: string;
  purpose: string | null;
  privacy: 'public' | 'private' | 'invite-only';
  memberCount: number;
  isLeader: boolean;
  isMember?: boolean;
  createdAt: string;
  kind: 'STANDARD' | 'WELCOME_TABLE';
  colorKey: string;
  iconEmoji?: string | null;
  iconColor?: string | null;
  chattingCount: number;
  welcomeTableNumber: number | null;
  welcomeTableStatus: 'OPEN' | 'FULL' | 'CLOSED' | null;
  capacity: number | null;
  newcomerCount: number | null;
}

export interface PrivateGroupMember {
  userId: string;
  name: string;
  handle?: string | null;
  isLeader: boolean;
  joinedAt: string;
}

export interface PrivateGroupDetail {
  id: string;
  name: string;
  purpose: string | null;
  privacy: 'public' | 'private' | 'invite-only';
  isLeader: boolean;
  createdAt: string;
  coopId: string;
  coopName: string;
  kind?: 'STANDARD' | 'WELCOME_TABLE';
  iconEmoji?: string | null;
  iconColor?: string | null;
  myNotificationLevel: CircleNotificationLevel;
}

export interface PrivateGroupPendingInvite {
  inviteId: string;
  userId: string;
  name: string;
  invitedAt: string;
}

export interface CircleInviteCandidate {
  userId: string;
  name: string;
  handle: string | null;
  invited: boolean;
}

export interface CircleInvitation {
  inviteId: string;
  groupId: string;
  coopId: string;
  name: string;
  purpose: string | null;
  privacy: 'public' | 'private' | 'invite-only';
  iconEmoji: string | null;
  iconColor: string | null;
  memberCount: number;
  invitedBy: string;
  invitedAt: string;
}

export type CircleNotificationLevel = 'ALL' | 'MENTIONS' | 'NONE';

export interface PrivateGroupComment {
  id: string;
  authorId: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface GroupCreateRequirements {
  minScBalance: number;
  currentScBalance: number;
  canCreate: boolean;
}

export interface PersonalPageProfile {
  id: string;
  name: string;
  handle: string;
  bio?: string | null;
  avatarUrl?: string | null;
  avatarEmoji?: string | null;
  avatarColor?: string | null;
  createdAt: string;
  followerCount: number;
  followingCount: number;
  isOwnPage: boolean;
  viewerIsFollowing: boolean;
  /** Public commons, plus private ones the viewer also belongs to. */
  commons?: PersonalPageCommons[];
}

export interface PersonalPageCommons {
  coopId: string;
  name: string;
  shortName: string;
  iconEmoji?: string | null;
  iconColor?: string | null;
  isPrivate: boolean;
  roles: string[];
  badges: SupporterBadge[];
}

export interface PersonalPageComment {
  id: string;
  authorId?: string;
  author: string;
  authorHandle?: string;
  body: string;
  createdAt: string;
}

export interface PersonalPageFeedPost {
  id: string;
  authorId?: string;
  author: string;
  handle: string;
  body: string;
  tag: CommonsPostTag | null;
  time: string;
  createdAt: string;
  replies: number;
  support: number;
  media: CommonsPostMedia[];
  comments: PersonalPageComment[];
}

export interface CommonsProfile {
  id: string;
  name: string;
  shortName: string;
  description: string;
}

export type CommonsAccessStatus = 'ACTIVE' | 'PENDING' | 'REJECTED' | 'LOCKED';

export interface CommonsDirectoryItem extends CommonsProfile {
  tagline?: string | null;
  mission?: string | null;
  eligibility?: string | null;
  iconEmoji?: string | null;
  iconColor?: string | null;
  accessStatus: CommonsAccessStatus;
  joinPolicy?: CommonsJoinPolicy;
  isPrivate?: boolean;
  isMember: boolean;
  isSteward?: boolean;
  isLocked: boolean;
  canApply: boolean;
  applicationId?: string | null;
  applicationStatus?: string | null;
  requestType?: 'APPLICATION' | 'ACCESS_REQUEST' | null;
  circleCount?: number;
}

export type CommonsJoinPolicy = 'AUTOMATIC' | 'APPLICATION_REQUIRED' | 'INVITE_ONLY';
export type CommonsInvitationPurpose = 'DIRECT_JOIN' | 'APPLY' | 'REQUEST_ACCESS';

/** What an invitation shows before joining - never who else is a member. */
export interface CommonsInvitationDetail {
  invitationId: string | null;
  purpose: CommonsInvitationPurpose;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED' | 'PENDING_APPROVAL';
  expiresAt: string;
  recipientHint: string | null;
  recipientName: string | null;
  message: string | null;
  inviterName: string;
  commons: {
    id: string;
    name: string;
    tagline: string | null;
    description: string | null;
    iconEmoji: string | null;
    iconColor: string | null;
    joinPolicy: CommonsJoinPolicy;
    isPrivate: boolean;
    rules: string | null;
    privacyNotice: string | null;
  };
  viewer: {
    signedIn: boolean;
    isMember: boolean;
    contactMatch: 'EMAIL' | 'PHONE' | null;
    requestStatus: string | null;
  };
}

export type AcceptCommonsInvitationResult =
  | { outcome: 'JOINED' | 'ALREADY_MEMBER'; coopId: string; welcomePostId: string | null }
  | { outcome: 'REQUESTED'; coopId: string; reason: string; alreadyRequested: boolean }
  | { outcome: 'APPLY'; coopId: string; invitationId: string };

export interface CommonsInvitationOverview {
  commons: { id: string; name: string; joinPolicy: CommonsJoinPolicy; isPrivate: boolean };
  isSteward: boolean;
  /** Can invite directly but not review, manage roles or remove anyone. */
  isGuide: boolean;
  canInviteDirectly: boolean;
  invitations: {
    id: string;
    purpose: CommonsInvitationPurpose;
    status: 'PENDING' | 'PENDING_APPROVAL' | 'ACCEPTED';
    contact: string | null;
    contactType: 'EMAIL' | 'PHONE';
    recipientName: string | null;
    inviterName: string;
    isMine: boolean;
    acceptedByName: string | null;
    createdAt: string;
    expiresAt: string;
  }[];
  shareLinks: { id: string; createdByName: string; createdAt: string; expiresAt: string }[];
  requests: {
    id: string;
    requestType: string;
    applicant: { id: string; name: string | null; handle: string | null; email: string };
    note: string | null;
    reason: string | null;
    invitedAs: string | null;
    invitedByName: string | null;
    requestedAt: string;
  }[];
  members: {
    id: string;
    name: string | null;
    handle: string | null;
    isSteward: boolean;
    isGuide: boolean;
    isYou: boolean;
  }[];
}

/** Answers from the guided Start a family steps (see packages/trpc/src/services/family-setup.ts). */
export interface FamilySetupInput {
  mission?: string;
  goals: {
    label: string;
    detail?: string;
    targetAmountUSD?: number;
    targetMonths?: number;
    /** Share of the priority, 1-100; every goal's share adds up to 100. */
    priorityPercent?: number;
  }[];
  votingWindowDays: 3 | 7 | 14;
  approval: 'MAJORITY' | 'TWO_THIRDS';
  houseRules: string[];
}

/** A family's saved setup, for its stewards to edit. */
export interface FamilySetupView {
  coopId: string;
  name: string;
  setup: FamilySetupInput;
  isSetUp: boolean;
  /** Stewards can change it only while everyone in the family is a steward. */
  canEdit: boolean;
  nonStewards: number;
  lockedReason: string | null;
}

export interface CommonsMissionGoal {
  key: string;
  label: string;
  priorityWeight: number;
  description?: string;
}

export interface CommonsProposalCategory {
  key: string;
  label: string;
  isActive: boolean;
  description?: string;
}

export interface ApplicationQuestion {
  id: string;
  type: string;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  validation?: Record<string, unknown>;
}

export interface CoopConfigDetail {
  coopId: string;
  name?: string;
  slug?: string;
  tagline?: string;
  description?: string;
  eligibility?: string;
  displayMission?: string;
  iconEmoji?: string | null;
  iconColor?: string | null;
  charterText: string;
  missionGoals: CommonsMissionGoal[];
  proposalCategories: CommonsProposalCategory[];
  applicationQuestions?: ApplicationQuestion[] | null;
  quorumPercent: number;
  approvalThresholdPercent: number;
  votingWindowDays: number;
  aiAutoApproveThresholdUSD: number;
  councilVoteThresholdUSD: number;
  treasurySafeAddress?: string;
  scTokenSymbol?: string;
  scTokenName?: string;
}

export interface ProposalSummary {
  id: string;
  createdAt: string;
  /** Last change; roughly when a decided proposal was decided. */
  updatedAt?: string | null;
  status: string;
  /** The commons this proposal belongs to. */
  coopId?: string | null;
  /** When voting closes (ISO), once the proposal is open for voting. */
  votingEndsAt?: string | null;
  title: string;
  summary: string;
  category: string;
  budget?: {
    amount?: number;
    currency?: string;
  };
  proposer?: {
    displayName?: string | null;
    wallet?: string;
  };
}

export type SageTrailStage = 'OBSERVED' | 'EVIDENCE' | 'CONSIDERED' | 'POLICY' | 'TAKEN' | 'RESULT' | 'FOLLOW_UP';

export interface SageTaskView {
  id: string;
  kind: string;
  status: string;
  title: string;
  reason: string;
  expected: string | null;
  offer: string | null;
  postId: string | null;
  subjectType: string;
  subjectId: string;
  nextWakeAt: string;
  attempts: number;
  outcome: string | null;
  updatedAt: string;
}

export interface SageAlertView {
  id: string;
  coopId: string;
  category: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  body: string;
  evidence: { source: string; quote?: string; why: string; recommendation: string };
  postId: string | null;
  status: string;
  dueAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export type SageTrailFilter = { postId: string } | { actionId: string } | { proposalId: string } | { circleId: string };

export interface SageDecisionTrail {
  id: string;
  agent: string;
  agentLabel: string;
  coopId: string;
  circleId: string | null;
  sourceType: string;
  trigger: string;
  triggerLabel: string;
  outcome: string;
  observed: {
    title?: string;
    content?: string;
    context?: string;
    circleName?: string;
    itemCount?: number;
    items?: { author: string; content: string; at: string }[];
  };
  steps: { stage: SageTrailStage; label: string; detail?: string; outcome?: 'PASS' | 'FAIL' | 'INFO' }[];
  hiddenSteps: number;
  createdAt: string;
}

// A direct message thread is a private two-person circle (Group kind DIRECT).
export interface DirectThread {
  groupId: string;
  coopId: string;
  person: DirectPerson;
  preview: string | null;
  lastMessageAt: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
}

export interface DirectPerson {
  id: string;
  name: string;
  handle: string | null;
}

export interface DirectMessage {
  id: string;
  authorId: string;
  fromMe: boolean;
  body: string;
  createdAt: string;
}

export interface DirectMember {
  id: string;
  name: string;
  handle: string;
  role: string;
}

async function readTrpcResult<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const result = await response.json();

  if (result.error) {
    throw apiError(result.error, fallbackMessage);
  }

  if (!response.ok) {
    throw httpError(response.status);
  }

  return result.result?.data as T;
}

async function postCommonsInvitations<T>(
  procedure: string,
  body: unknown,
  sessionToken: string,
  fallbackMessage: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/trpc/commonsInvitations.${procedure}`,
    {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify(body),
    },
  );
  return readTrpcResult<T>(response, fallbackMessage);
}

// Helper functions for API calls
export const api = {
  /**
   * Submit a new application to join a Cahootz co-op
   */
  async submitApplication(data: ApplicationData) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/application.submitApplication`,
      {
        method: 'POST',
        headers: {
          ...networkConfig.defaultHeaders,
        },
        body: JSON.stringify(data),
      },
    );

    // Always parse the response body, even for error responses
    const result = await response.json();

    console.log('📥 Raw API response:', JSON.stringify(result, null, 2));
    console.log('📥 Response status:', response.status);
    console.log('📥 Has error?', !!result.error);
    if (result.error) {
      console.log('📥 Error object:', JSON.stringify(result.error, null, 2));
      console.log('📥 Error message:', result.error.message);
    }

    // Check if there's a tRPC error in the response
    if (result.error) {
      const errorMessage =
        result.error.message ||
        result.error.data?.message ||
        'Application submission failed';
      console.log('📥 Throwing error with message:', errorMessage);
      throw apiError(result.error, errorMessage);
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw httpError(response.status);
    }

    // tRPC wraps the response in result.data
    return result.result?.data;
  },

  async submitWaitlist(data: WaitlistSignupData) {
    const response = await fetch(`${getWebUrl()}/api/waitlist`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({
        email: data.email,
        name: data.name,
        source: 'hero',
        suggestedCoop: data.suggestedCoop,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(
        result.message || 'Could not join the waitlist. Please try again.',
      );
    }

    return result as { success: boolean; message: string };
  },

  async submitNewsletterSubmission(
    data: NewsletterSubmissionData,
    walletAddress?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/publicCoopInfo.submitNewsletterSubmission`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();

    if (result.error) {
      throw apiError(result.error, 'Could not submit to the newsletter');
    }

    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  async listCommonsFeed(
    coopId = 'cahootz',
    sessionToken?: string | null,
    cursor?: string | null,
    circleId?: string,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({
        coopId,
        limit: 30,
        ...(cursor ? { cursor } : {}),
        ...(circleId ? { circleId } : {}),
      }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.listFeed?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      coop: CommonsProfile;
      circleName?: string | null;
      circleIsMember?: boolean | null;
      posts: CommonsPost[];
      pinnedPost: CommonsPost | null;
      upcomingEvents: EventSummary[];
      nextCursor: string | null;
    }>(response, 'Failed to load Commons feed');
  },

  async listCircleMedia(
    coopId: string,
    circleId: string,
    sessionToken?: string | null,
    cursor?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ coopId, circleId, limit: 30, ...(cursor ? { cursor } : {}) }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.listCircleMedia?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      circleName: string;
      items: CircleGalleryItem[];
      nextCursor: string | null;
    }>(response, "Couldn't load this circle's photos and videos");
  },

  async searchCommons(
    data: { coopId?: string; query: string; limit?: number },
    sessionToken?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({
        coopId: data.coopId || 'cahootz',
        query: data.query,
        limit: data.limit ?? 10,
      }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.search?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{ people: SearchPerson[]; posts: CommonsPost[] }>(
      response,
      'Search failed',
    );
  },

  async getCommonsPost(
    data: { coopId?: string; postId: string },
    sessionToken?: string | null,
  ) {
    const input = encodeURIComponent(JSON.stringify(data));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.getPost?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{ coop: CommonsProfile; post: CommonsPost; circleIsMember?: boolean | null }>(
      response,
      'Failed to load post',
    );
  },

  async getPersonalPage(
    handle: string,
    sessionToken?: string | null,
    cursor?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ handle, limit: 30, ...(cursor ? { cursor } : {}) }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.getPersonalPage?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      profile: PersonalPageProfile;
      posts: PersonalPageFeedPost[];
      nextCursor: string | null;
    }>(response, 'Failed to load personal page');
  },

  async listCommonsDirectory(sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.listDirectory`, {
      method: 'GET',
      headers: createApiHeaders(null, sessionToken),
    });

    return readTrpcResult<{ coops: CommonsDirectoryItem[] }>(
      response,
      'Failed to load commons',
    );
  },

  async applyToCommons(
    data: {
      coopId: string;
      displayName?: string;
      phone?: string;
      dynamicAnswers?: Record<string, unknown>;
      invitationId?: string;
      invitationToken?: string;
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.applyToCommons`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify(data),
      },
    );

    return readTrpcResult<{
      success: boolean;
      message: string;
      applicationId: string;
    }>(response, 'Failed to apply to commons');
  },

  async createFamilyCommons(
    data: { name: string; description?: string; iconEmoji?: string; setup?: FamilySetupInput },
    sessionToken: string,
  ) {
    return postCommonsInvitations<{ coopId: string; welcomePostId: string }>(
      'createFamily',
      data,
      sessionToken,
      'Could not start your family',
    );
  },

  /** The family agreement the guided setup would save; nothing is stored. */
  async previewFamilyAgreement(
    data: { name: string; setup: FamilySetupInput; coopId?: string },
    sessionToken: string,
  ) {
    return postCommonsInvitations<{ charterText: string }>(
      'previewFamilyAgreement',
      data,
      sessionToken,
      "Couldn't show the agreement right now",
    );
  },

  async getFamilySetup(coopId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commonsInvitations.familySetup?input=${input}`,
      { method: 'GET', headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<FamilySetupView>(response, "Couldn't load your family's setup");
  },

  async updateFamilySetup(data: { coopId: string; setup: FamilySetupInput }, sessionToken: string) {
    return postCommonsInvitations<FamilySetupView & { changed: boolean }>(
      'updateFamilySetup',
      data,
      sessionToken,
      "Couldn't save your family's setup",
    );
  },

  async suggestFamilyNames(
    data: { currentName?: string; description?: string },
    sessionToken: string,
  ) {
    return postCommonsInvitations<{ names: string[] }>(
      'suggestFamilyNames',
      data,
      sessionToken,
      "Couldn't come up with ideas right now",
    );
  },

  async previewCommonsInvitation(token: string, sessionToken?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ token }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commonsInvitations.preview?input=${input}`,
      { method: 'GET', headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<CommonsInvitationDetail>(response, 'Could not open this invitation');
  },

  async getMyCommonsInvitation(invitationId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ invitationId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commonsInvitations.getMine?input=${input}`,
      { method: 'GET', headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<CommonsInvitationDetail>(response, 'Could not open this invitation');
  },

  async listMyCommonsInvitations(sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsInvitations.listMine`, {
      method: 'GET',
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<{ invitations: CommonsInvitationDetail[] }>(
      response,
      'Could not load your invitations',
    );
  },

  async acceptCommonsInvitation(
    data: { token?: string; invitationId?: string; acceptRules: boolean; note?: string },
    sessionToken: string,
  ) {
    return postCommonsInvitations<AcceptCommonsInvitationResult>(
      'accept',
      data,
      sessionToken,
      'Could not accept this invitation',
    );
  },

  async inviteToCommons(
    data: {
      coopId: string;
      email?: string;
      phone?: string;
      recipientName?: string;
      message?: string;
    },
    sessionToken: string,
  ) {
    return postCommonsInvitations<{
      invitationId: string;
      status: 'PENDING' | 'PENDING_APPROVAL';
      alreadyInvited: boolean;
      channels: string[];
    }>('invite', data, sessionToken, 'Could not send the invitation');
  },

  async getCommonsInvitationOverview(coopId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commonsInvitations.overview?input=${input}`,
      { method: 'GET', headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<CommonsInvitationOverview>(response, 'Could not load invitations');
  },

  async approveCommonsRecommendation(invitationId: string, sessionToken: string) {
    return postCommonsInvitations<{ invitationId: string; channels: string[] }>(
      'approveRecommendation',
      { invitationId },
      sessionToken,
      'Could not approve the recommendation',
    );
  },

  async revokeCommonsInvitation(invitationId: string, sessionToken: string) {
    return postCommonsInvitations<{ revoked: boolean }>(
      'revoke',
      { invitationId },
      sessionToken,
      'Could not cancel the invitation',
    );
  },

  async createCommonsShareLink(coopId: string, sessionToken: string) {
    return postCommonsInvitations<{
      invitationId: string;
      token: string;
      appLink: string;
      expiresAt: string;
    }>('createShareLink', { coopId }, sessionToken, 'Could not create a link');
  },

  async reviewCommonsRequest(
    data: { applicationId: string; decision: 'APPROVE' | 'DECLINE'; note?: string },
    sessionToken: string,
  ) {
    return postCommonsInvitations<{ joined: boolean; coopId: string }>(
      'reviewRequest',
      data,
      sessionToken,
      'Could not review the request',
    );
  },

  async withdrawCommonsRequest(coopId: string, sessionToken: string) {
    return postCommonsInvitations<{ applicationId: string }>(
      'withdrawRequest',
      { coopId },
      sessionToken,
      'Could not withdraw your request',
    );
  },

  async removeCommonsMember(coopId: string, userId: string, sessionToken: string) {
    return postCommonsInvitations<{ removed: boolean }>(
      'removeMember',
      { coopId, userId },
      sessionToken,
      'Could not remove this member',
    );
  },

  async setCommonsSteward(
    coopId: string,
    userId: string,
    steward: boolean,
    sessionToken: string,
  ) {
    return postCommonsInvitations<{ roles: string[] }>(
      'setSteward',
      { coopId, userId, steward },
      sessionToken,
      'Could not change stewards',
    );
  },

  async setCommonsGuide(
    coopId: string,
    userId: string,
    guide: boolean,
    sessionToken: string,
  ) {
    return postCommonsInvitations<{ roles: string[] }>(
      'setGuide',
      { coopId, userId, guide },
      sessionToken,
      'Could not change guides',
    );
  },

  async getCommonsActivityStats(coopId: string, sessionToken?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.getActivityStats?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      activeMembers: number;
      discussionsThisMonth: number;
      openVotes: number;
    }>(response, 'Failed to load commons activity stats');
  },

  async getCommonsAISpending(coopId: string, sessionToken?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.getAISpending?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      thisMonthUsd: number;
      lastMonthUsd: number;
      callsThisMonth: number;
      unpricedCallsThisMonth: number;
      byCategory: { category: string; estimatedUsd: number; calls: number }[];
      sageAutonomy: {
        usd: number;
        calls: number;
        usdLimit: number;
        callLimit: number;
        paused: boolean;
        pausedReason: 'USD_LIMIT' | 'CALL_LIMIT' | null;
        resetsAt: string;
      };
    }>(response, 'Failed to load commons AI spending');
  },

  async listCommonsMembers(
    coopId: string,
    sessionToken?: string | null,
    limit = 8,
  ) {
    const input = encodeURIComponent(JSON.stringify({ coopId, limit }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.listMembers?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      totalCount: number;
      members: { id: string; name: string; handle: string }[];
    }>(response, 'Failed to load commons members');
  },

  async askCommonsAi(prompt: string, postId?: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.ask`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ prompt, postId }),
    });

    return readTrpcResult<{ answer: string }>(
      response,
      'Failed to ask Cahootz AI',
    );
  },

  async suggestCommons(
    data: CommonsSuggestionData,
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.suggestCommons`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({
          coopId: data.coopId || 'cahootz',
          name: data.name,
          reason: data.reason,
          email: data.email,
          suggestedByName: data.suggestedByName,
        }),
      },
    );

    return readTrpcResult<{ success: boolean; suggestionId: string }>(
      response,
      'Could not send the commons suggestion',
    );
  },

  async createCommonsPost(
    data: {
      content: string;
      title?: string;
      tag?: CommonsPost['tag'] | null;
      coopId?: string;
      circleId?: string;
      media?: CommonsPostMedia[];
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.createPost`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({
        coopId: data.coopId || 'cahootz',
        ...(data.circleId ? { circleId: data.circleId } : {}),
        title: data.title,
        content: data.content,
        ...(data.tag ? { tag: data.tag } : {}),
        media: data.media || [],
      }),
    });

    return readTrpcResult<{ post: CommonsPost }>(
      response,
      'Create an account to post',
    );
  },

  async createPersonalPagePost(
    data: {
      content: string;
      tag?: CommonsPost['tag'] | null;
      media?: CommonsPostMedia[];
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.createPersonalPagePost`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({
          content: data.content,
          ...(data.tag ? { tag: data.tag } : {}),
          media: data.media || [],
        }),
      },
    );

    return readTrpcResult<{ post: PersonalPageFeedPost }>(
      response,
      'Create an account to post',
    );
  },

  async updatePersonalPageProfile(
    data: {
      bio: string;
      avatarUrl: string | null;
      avatarEmoji: string | null;
      avatarColor: string | null;
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.updatePersonalPageProfile`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify(data),
      },
    );

    return readTrpcResult<{
      bio: string | null;
      avatarUrl: string | null;
      avatarEmoji: string | null;
      avatarColor: string | null;
    }>(response, 'Could not save your profile');
  },

  async deleteCommonsPost(postId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.deletePost`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ postId }),
    });

    return readTrpcResult<{ success: boolean }>(
      response,
      'Failed to delete post',
    );
  },

  async pinCommonsPost(postId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.pinPost`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ postId }),
    });

    return readTrpcResult<{ success: boolean }>(response, 'Failed to pin post');
  },

  async unpinCommonsPost(postId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.unpinPost`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ postId }),
    });

    return readTrpcResult<{ success: boolean }>(response, 'Failed to unpin post');
  },

  async createEvent(
    data: {
      coopId?: string;
      circleId?: string;
      title: string;
      description?: string;
      startAt: string;
      endAt: string;
      isOnline: boolean;
      location?: string;
      meetingUrl?: string;
      allowComments?: boolean;
      recurrence?: {
        freq: EventRecurrenceFreq;
        interval?: number;
        count?: number;
      };
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/events.create`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({
        coopId: data.coopId || 'cahootz',
        ...(data.circleId ? { circleId: data.circleId } : {}),
        title: data.title,
        description: data.description || '',
        startAt: data.startAt,
        endAt: data.endAt,
        isOnline: data.isOnline,
        ...(data.location ? { location: data.location } : {}),
        ...(data.meetingUrl ? { meetingUrl: data.meetingUrl } : {}),
        allowComments: data.allowComments ?? true,
        ...(data.recurrence ? { recurrence: data.recurrence } : {}),
      }),
    });

    return readTrpcResult<{ postId: string; event: EventSummary; seriesCount: number }>(
      response,
      'Failed to create event',
    );
  },

  async fetchEventDetail(eventId: string, sessionToken?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ eventId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/events.get?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<EventDetail>(response, 'Failed to load event');
  },

  async rsvpToEvent(
    eventId: string,
    status: EventRsvpStatus,
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/events.rsvp`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ eventId, status }),
    });

    return readTrpcResult<EventSummary>(response, 'Failed to RSVP');
  },

  async muteEventReminder(
    eventId: string,
    muted: boolean,
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/events.muteReminder`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ eventId, muted }),
    });

    return readTrpcResult<{ success: boolean }>(
      response,
      'Failed to update reminder',
    );
  },

  async deletePersonalPagePost(postId: string, sessionToken?: string | null) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.deletePersonalPagePost`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ postId }),
      },
    );

    return readTrpcResult<{ success: boolean }>(
      response,
      'Failed to delete post',
    );
  },

  async createPersonalPageComment(
    data: { postId: string; content: string },
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.createPersonalPagePostComment`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify(data),
      },
    );

    return readTrpcResult<{ comment: PersonalPageComment }>(
      response,
      'Failed to add comment',
    );
  },

  async editPersonalPageComment(
    data: { commentId: string; content: string },
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.editPersonalPagePostComment`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify(data),
      },
    );

    return readTrpcResult<{ comment: PersonalPageComment }>(
      response,
      'Failed to edit comment',
    );
  },

  async deletePersonalPageComment(
    commentId: string,
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.deletePersonalPagePostComment`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ commentId }),
      },
    );

    return readTrpcResult<{ success: boolean }>(
      response,
      'Failed to delete comment',
    );
  },

  async togglePersonalPageSupport(
    postId: string,
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.togglePersonalPagePostSupport`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ postId }),
      },
    );

    return readTrpcResult<{ supported: boolean }>(
      response,
      'Failed to update like',
    );
  },

  async editComment(
    data: { commentId: string; content: string },
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.editComment`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify(data),
    });

    return readTrpcResult<{ comment: CommonsComment }>(
      response,
      'Failed to edit comment',
    );
  },

  async deleteComment(commentId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.deleteComment`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ commentId }),
    });

    return readTrpcResult<{ success: boolean }>(
      response,
      'Failed to delete comment',
    );
  },

  async toggleFollowUser(userId: string, sessionToken?: string | null) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.toggleFollowUser`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ userId }),
      },
    );

    return readTrpcResult<{ following: boolean }>(
      response,
      'Failed to update follow',
    );
  },

  async listFollowing(sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.listFollowing`, {
      method: 'GET',
      headers: createApiHeaders(null, sessionToken),
    });

    return readTrpcResult<{
      members: { id: string; name: string; handle: string }[];
    }>(response, 'Failed to load following');
  },

  async listFollowers(sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.listFollowers`, {
      method: 'GET',
      headers: createApiHeaders(null, sessionToken),
    });

    return readTrpcResult<{
      members: { id: string; name: string; handle: string }[];
    }>(response, 'Failed to load followers');
  },

  async uploadCommonsPostMedia(data: {
    coopId: string;
    /** Blob folder; profile photos use 'profile'. */
    uploadType?: 'post' | 'profile';
    uri: string;
    fileName?: string | null;
    mimeType: string;
    mediaType: 'image' | 'video';
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    sizeBytes?: number | null;
  }): Promise<CommonsPostMedia> {
    const fileName =
      data.fileName ||
      data.uri.split('/').pop() ||
      (data.mediaType === 'video' ? 'post-video.mp4' : 'post-image.jpg');

    const tokenResponse = await fetch(`${API_BASE_URL}/api/upload/presigned`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
        'X-Coop-Id': data.coopId,
      },
      body: JSON.stringify({
        filename: fileName,
        contentType: data.mimeType,
        uploadType: data.uploadType || 'post',
        resourceId: data.coopId,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.success) {
      throw new Error(tokenData.error || 'Failed to get upload token');
    }

    if (!tokenResponse.ok) {
      throw httpError(tokenResponse.status);
    }

    const fileResponse = await fetch(data.uri);
    const fileBlob = await fileResponse.blob();
    const uploadResponse = await fetch(tokenData.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenData.clientToken}`,
        'x-api-version': '7',
        'x-content-type': data.mimeType,
      },
      body: fileBlob,
    });

    if (!uploadResponse.ok) {
      throw httpError(uploadResponse.status);
    }

    const blobResult = await uploadResponse.json();

    return {
      pathname: tokenData.pathname,
      url: blobResult.url,
      mediaType: data.mediaType,
      mimeType: data.mimeType,
      fileName,
      width: data.width ?? null,
      height: data.height ?? null,
      durationMs: data.durationMs ?? null,
      sizeBytes: data.sizeBytes ?? null,
    };
  },

  async uploadCommonsCommentMedia(data: {
    postId: string;
    uri: string;
    fileName?: string | null;
    mimeType: string;
    mediaType: 'image';
    width?: number | null;
    height?: number | null;
    sizeBytes?: number | null;
  }): Promise<CommonsPostMedia> {
    const fileName =
      data.fileName ||
      data.uri.split('/').pop() ||
      (data.mimeType === 'image/gif'
        ? 'comment-image.gif'
        : 'comment-image.jpg');

    const tokenResponse = await fetch(`${API_BASE_URL}/api/upload/presigned`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({
        filename: fileName,
        contentType: data.mimeType,
        uploadType: 'comment',
        resourceId: data.postId,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.success) {
      throw new Error(tokenData.error || 'Failed to get upload token');
    }

    if (!tokenResponse.ok) {
      throw httpError(tokenResponse.status);
    }

    const fileResponse = await fetch(data.uri);
    const fileBlob = await fileResponse.blob();
    const uploadResponse = await fetch(tokenData.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenData.clientToken}`,
        'x-api-version': '7',
        'x-content-type': data.mimeType,
      },
      body: fileBlob,
    });

    if (!uploadResponse.ok) {
      throw httpError(uploadResponse.status);
    }

    const blobResult = await uploadResponse.json();

    return {
      pathname: tokenData.pathname,
      url: blobResult.url,
      mediaType: 'image',
      mimeType: data.mimeType,
      fileName,
      width: data.width ?? null,
      height: data.height ?? null,
      durationMs: null,
      sizeBytes: data.sizeBytes ?? null,
    };
  },

  async createCommonsComment(
    data: {
      postId: string;
      content: string;
      media?: CommonsPostMedia[];
      /** The comment being answered, when the author tapped "Reply". */
      replyToCommentId?: string;
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.createComment`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify(data),
    });

    return readTrpcResult<{ comment: CommonsComment }>(
      response,
      'Create an account to comment',
    );
  },

  /** Toggles one emoji on a comment; the like (❤️) when no emoji is given. */
  async toggleCommentReaction(commentId: string, sessionToken?: string | null, emoji?: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.toggleCommentReaction`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify(emoji ? { commentId, emoji } : { commentId }),
    });

    return readTrpcResult<{
      emoji: string;
      reacted: boolean;
      reactionCount: number;
      viewerReacted?: boolean;
      reactions?: ReactionSummary[];
    }>(
      response,
      'Could not update your reaction',
    );
  },

  /** Toggles one emoji on a post; ❤️ is the post's like. */
  async togglePostReaction(postId: string, emoji: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.togglePostReaction`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ postId, emoji }),
    });

    return readTrpcResult<{
      emoji: string;
      reacted: boolean;
      support: number;
      reactions: ReactionSummary[];
    }>(response, 'Could not update your reaction');
  },

  async toggleCommonsSupport(postId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/commons.toggleSupport`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ postId }),
    });

    return readTrpcResult<{ supported: boolean }>(
      response,
      'Create an account to support posts',
    );
  },

  async listMyGroups(sessionToken?: string | null, coopId?: string) {
    const input = encodeURIComponent(JSON.stringify(coopId ? { coopId } : {}));
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.listMine?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{ groups: PrivateGroupSummary[] }>(
      response,
      'Failed to load groups',
    );
  },

  async listVisibleCircles(sessionToken: string, coopId: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.listVisible?input=${input}`,
      { method: 'GET', headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<{ groups: PrivateGroupSummary[] }>(
      response,
      'Failed to load visible circles',
    );
  },

  async createGroup(
    data: {
      name: string;
      purpose?: string;
      privacy: 'public' | 'private' | 'invite-only';
      coopId?: string;
      iconEmoji?: string;
      iconColor?: string;
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.create`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify(data),
    });

    return readTrpcResult<{
      group: PrivateGroupSummary & { inviteCode: string };
    }>(response, 'Failed to create group');
  },

  async updateGroupIcon(
    data: { groupId: string; iconEmoji: string | null; iconColor: string | null },
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.updateIcon`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify(data),
    });

    return readTrpcResult<{
      iconEmoji: string | null;
      iconColor: string | null;
    }>(response, 'Failed to update circle icon');
  },

  async getGroupCreateRequirements(
    sessionToken?: string | null,
    coopId?: string,
  ) {
    const input = encodeURIComponent(JSON.stringify(coopId ? { coopId } : {}));
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.getCreateRequirements?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<GroupCreateRequirements>(
      response,
      'Failed to check space creation requirements',
    );
  },

  async getGroupDetail(groupId: string, sessionToken?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ groupId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.getDetail?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      group: PrivateGroupDetail;
      members: PrivateGroupMember[];
      pendingInvites: PrivateGroupPendingInvite[];
    }>(response, 'Failed to load group');
  },

  async searchCircleInvitees(
    groupId: string,
    query: string,
    sessionToken: string,
  ) {
    const input = encodeURIComponent(JSON.stringify({ groupId, query }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.searchInvitees?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{ people: CircleInviteCandidate[] }>(
      response,
      'Could not search people',
    );
  },

  async inviteToCircle(groupId: string, userId: string, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.invite`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId, userId }),
    });

    return readTrpcResult<{ inviteId: string; alreadyInvited: boolean }>(
      response,
      'Could not send invitation',
    );
  },

  async revokeCircleInvite(inviteId: string, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.revokeInvite`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ inviteId }),
    });

    return readTrpcResult<{ success: boolean }>(
      response,
      'Could not cancel invitation',
    );
  },

  async listMyCircleInvites(sessionToken: string, coopId?: string) {
    const input = encodeURIComponent(JSON.stringify(coopId ? { coopId } : {}));
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.listMyInvites?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{ invites: CircleInvitation[] }>(
      response,
      'Could not load circle invitations',
    );
  },

  async respondToCircleInvite(
    inviteId: string,
    accept: boolean,
    sessionToken: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.respondToInvite`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ inviteId, accept }),
    });

    return readTrpcResult<{
      groupId: string;
      coopId: string;
      accepted: boolean;
    }>(response, 'Could not respond to invitation');
  },

  async joinPublicCircle(groupId: string, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.joinPublic`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId }),
    });
    return readTrpcResult<{ groupId: string; name: string; joined: boolean }>(
      response,
      'Could not join circle',
    );
  },

  async updateCirclePrivacy(
    groupId: string,
    privacy: 'public' | 'private',
    confirmExposeHistory: boolean,
    sessionToken: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.updatePrivacy`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId, privacy, confirmExposeHistory }),
    });
    return readTrpcResult<{ privacy: 'public' | 'private' }>(
      response,
      'Could not update circle privacy',
    );
  },

  async updateCircleNotificationLevel(
    groupId: string,
    level: CircleNotificationLevel,
    sessionToken: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.updateNotificationLevel`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ groupId, level }),
      },
    );
    return readTrpcResult<{ level: CircleNotificationLevel }>(
      response,
      'Could not update circle notifications',
    );
  },

  async transferGroupLeadership(
    groupId: string,
    newLeaderUserId: string,
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.transferLeadership`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ groupId, newLeaderUserId }),
      },
    );

    return readTrpcResult<{ success: boolean }>(
      response,
      'Failed to transfer leadership',
    );
  },

  async leaveGroup(groupId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.leave`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId }),
    });

    return readTrpcResult<{ success: boolean; groupDeleted: boolean }>(
      response,
      'Failed to leave group',
    );
  },

  async assignWelcomeTable(sessionToken?: string | null, coopId?: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.assignWelcomeTable`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify(coopId ? { coopId } : {}),
    });

    return readTrpcResult<{ groupId: string; name: string; welcomeTableNumber: number | null }>(
      response,
      'Could not join a welcome lounge',
    );
  },

  async getWelcomeIntroStatus(groupId: string, sessionToken?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ groupId }));
    const response = await fetch(`${API_BASE_URL}/trpc/groups.getWelcomeIntroStatus?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(null, sessionToken),
    });

    return readTrpcResult<WelcomeIntroStatus>(response, 'Could not load your welcome lounge intro');
  },

  async enterCircleChat(groupId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.enterChat`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId }),
    });

    return readTrpcResult<{ success: boolean }>(response, 'Could not enter circle chat');
  },

  async refreshCircleChatPresence(groupId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.refreshChatPresence`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId }),
    });

    return readTrpcResult<{ success: boolean }>(response, 'Could not refresh circle chat presence');
  },

  async leaveCircleChat(groupId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.leaveChat`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId }),
      // Leaving is often sent as the page goes away (a reload, closing the
      // tab, navigating off it on web). Without keepalive the browser cancels
      // it, and the member looks "in the chat" for 90s and misses alerts.
      keepalive: true,
    });

    return readTrpcResult<{ success: boolean }>(response, 'Could not leave circle chat');
  },

  async listGroupComments(
    groupId: string,
    sessionToken?: string | null,
    cursor?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ groupId, ...(cursor ? { cursor } : {}) }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.listComments?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      comments: PrivateGroupComment[];
      nextCursor: string | null;
    }>(response, 'Failed to load comments');
  },

  async addGroupComment(
    groupId: string,
    content: string,
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.addComment`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId, content }),
    });

    return readTrpcResult<{ comment: PrivateGroupComment }>(
      response,
      'Failed to add comment',
    );
  },

  async listDirectThreads(sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.listDirect`, {
      method: 'GET',
      headers: createApiHeaders(null, sessionToken),
    });

    return readTrpcResult<{ threads: DirectThread[] }>(
      response,
      'Create an account to view DMs',
    );
  },

  async openDirectThread(
    userId: string,
    sessionToken?: string | null,
    coopId = 'cahootz',
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.openDirect`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ userId, coopId }),
    });

    return readTrpcResult<{ groupId: string; coopId: string; person: DirectPerson }>(
      response,
      'Could not open this conversation',
    );
  },

  async listDirectMessages(groupId: string, sessionToken?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ groupId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/groups.listDirectMessages?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{
      groupId: string;
      coopId: string;
      person: DirectPerson | null;
      messages: DirectMessage[];
      olderCursor: string | null;
    }>(response, 'Could not load messages');
  },

  async markDirectThreadRead(groupId: string, sessionToken?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.markDirectRead`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId }),
    });

    return readTrpcResult<{ success: boolean }>(response, 'Could not mark messages read');
  },

  async listDirectMembers(sessionToken?: string | null) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commons.listDirectMembers`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    return readTrpcResult<{ members: DirectMember[] }>(
      response,
      'Create an account to view Commons members',
    );
  },

  async sendDirectMessage(
    groupId: string,
    content: string,
    sessionToken?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/groups.sendDirect`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ groupId, content }),
    });

    return readTrpcResult<{ message: DirectMessage }>(
      response,
      'Create an account to send DMs',
    );
  },

  async requestLoginCode(email: string, coopId?: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/auth.requestLoginCode`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        ...(coopId ? { coopId } : {}),
      }),
    });

    return readTrpcResult<{ success: boolean; message: string }>(
      response,
      'Failed to send login code',
    );
  },

  async verifyLoginCode(
    email: string,
    code: string,
    coopId?: string,
    anonymousId?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/auth.verifyLoginCode`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        ...(coopId ? { coopId } : {}),
        ...(anonymousId ? { anonymousId } : {}),
      }),
    });

    return readTrpcResult<EmailCodeAuthResult>(
      response,
      'Failed to verify login code',
    );
  },

  async saveAnonymousProfile(data: {
    anonymousId: string;
    selfDescription: string;
    goals?: string;
    interests?: string[];
    resourcesOffered?: string[];
    resourcesNeeded?: string[];
    businessSummary?: string;
    locationSummary?: string;
  }) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/anonymousProfile.upsert`,
      {
        method: 'POST',
        headers: {
          ...networkConfig.defaultHeaders,
        },
        body: JSON.stringify(data),
      },
    );

    return readTrpcResult<{ success: boolean }>(
      response,
      'Could not save your answers',
    );
  },

  async completeProfileOnboarding(
    data: {
      selfDescription: string;
      goals?: string;
      shortTermGoals?: string;
      longTermGoals?: string;
      skills?: string[];
      interests?: string[];
      resourcesOffered?: string[];
      resourcesNeeded?: string[];
      businessSummary?: string;
      locationSummary?: string;
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/user.completeProfileOnboarding`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify(data),
      },
    );

    return readTrpcResult<{
      success: boolean;
      user: Omit<
        NonNullable<EmailCodeAuthResult['user']>,
        'sessionToken' | 'coop'
      >;
    }>(response, 'Could not save your profile');
  },

  async registerPushDevice(
    data: {
      expoPushToken: string;
      platform: string;
      coopId?: string;
      deviceName?: string | null;
      appVersion?: string | null;
    },
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/notification.registerPushDevice`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify(data),
      },
    );

    console.info('[push] Device registration API response', {
      status: response.status,
      ok: response.ok,
    });
    return readTrpcResult<{ success: boolean }>(
      response,
      'Could not register notifications',
    );
  },

  /**
   * Login with email and password
   */
  async login(data: LoginData) {
    const response = await fetch(`${API_BASE_URL}/trpc/auth.login`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify(data),
    });

    // Always parse the response body, even for error responses
    const result = await response.json();

    // Check if there's a tRPC error in the response
    if (result.error) {
      throw apiError(result.error, 'Login failed');
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw httpError(response.status);
    }

    // tRPC wraps the response in result.data.json
    return result.result?.data;
  },

  /**
   * Check if user can login (status check)
   */
  async checkLoginStatus(email: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/auth.checkLoginStatus`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ email }),
    });

    // Always parse the response body, even for error responses
    const result = await response.json();

    // Check if there's a tRPC error in the response
    if (result.error) {
      throw apiError(result.error, 'Status check failed');
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw httpError(response.status);
    }

    // tRPC wraps the response in result.data.json
    return result.result?.data;
  },

  /**
   * Refresh user data from the server
   * Used to get updated user info including wallet address
   */
  async refreshUser(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/user.getMe?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to refresh user');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // WALLET FUNCTIONS
  // ──────────────────────────────────────────────────────────

  /**
   * Get wallet info for a user
   */
  async getWalletInfo(
    userId: string,
    walletAddress?: string | null,
    sessionToken?: string | null,
  ): Promise<WalletInfo> {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/user.getWalletInfo?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress, sessionToken),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get wallet info');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  async exportWallet(
    userId: string,
    password: string,
    walletAddress?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/user.exportWallet`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, password }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to export wallet');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data as {
      address: string;
      privateKey: string;
      warning: string;
    };
  },

  async deleteAccount(userId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/user.deleteAccount`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to delete account');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data as {
      success: boolean;
      message: string;
      isDemoMode: boolean;
      deletedAt: string | null;
    };
  },

  async requestWalletChallenge(data: {
    userId: string;
    walletAddress: string;
    coopId?: string;
    purpose: string;
  }) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/walletAuth.requestChallenge`,
      {
        method: 'POST',
        headers: {
          ...networkConfig.defaultHeaders,
        },
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to request wallet challenge');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data as {
      challengeId: string;
      message: string;
      expiresAt: string;
    };
  },

  async verifyWalletSignature(data: {
    challengeId: string;
    walletAddress: string;
    signature: string;
  }) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/walletAuth.verifySignature`,
      {
        method: 'POST',
        headers: {
          ...networkConfig.defaultHeaders,
        },
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to verify wallet signature');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data as {
      success: boolean;
      userId: string;
      walletAddress: string;
      verifiedAt: string;
    };
  },

  /**
   * Create a wallet for a user
   */
  async createWallet(
    userId: string,
    sessionToken?: string | null,
    walletAddress?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/user.createWallet`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress, sessionToken),
      body: JSON.stringify({ userId }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to create wallet');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // P2P PAYMENT FUNCTIONS
  // ──────────────────────────────────────────────────────────

  /**
   * Get user's balance in USD
   */
  async getUSDBalance(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.getBalance?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get balance');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get the commons coin (SC) balance from the blockchain
   */
  async getTokenBalances(walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ walletAddress }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/user.getBalances?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get token balances');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data || { sc: '0', scRaw: '0' };
  },

  /**
   * Get P2P payment history
   */
  async getP2PHistory(
    userId: string,
    limit = 50,
    offset = 0,
    walletAddress?: string | null,
  ) {
    const input = encodeURIComponent(JSON.stringify({ userId, limit, offset }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.getHistory?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get history');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * One of the signed-in member's payments, for its receipt. The server only
   * returns it to the person who sent or received it.
   */
  async getTransferReceipt(
    transferId: string,
    walletAddress?: string | null,
  ): Promise<TransferReceipt> {
    const input = encodeURIComponent(JSON.stringify({ transferId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.getTransfer?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get payment');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get saved payment methods
   */
  async getPaymentMethods(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.getPaymentMethods?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get payment methods');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Create SetupIntent for adding a new card
   */
  async createSetupIntent(userId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.createSetupIntent`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to create setup intent');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Save payment method after SetupIntent succeeds
   */
  async savePaymentMethod(
    userId: string,
    paymentMethodId: string,
    walletAddress?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.savePaymentMethod`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, paymentMethodId }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to save payment method');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Remove a payment method
   */
  async removePaymentMethod(
    userId: string,
    paymentMethodId: string,
    walletAddress?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.removePaymentMethod`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ userId, paymentMethodId }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to remove payment method');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(
    userId: string,
    paymentMethodId: string,
    walletAddress?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.setDefaultPaymentMethod`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ userId, paymentMethodId }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to set default payment method');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get notifications
   */
  async getP2PNotifications(
    userId: string,
    unreadOnly = false,
    limit = 20,
    sessionToken?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ userId, unreadOnly, limit }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.getNotifications?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(null, sessionToken),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get notifications');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Mark notification as read
   */
  async markNotificationRead(
    notificationId: string,
    sessionToken?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.markNotificationRead`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ notificationId }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to mark notification as read');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(userId: string, sessionToken?: string | null) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.markAllNotificationsRead`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ userId }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to mark notifications as read');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // BANK ACCOUNTS
  // ──────────────────────────────────────────────────────────

  /**
   * Get saved bank accounts
   */
  async getBankAccounts(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.getBankAccounts?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get bank accounts');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Add a new bank account
   */
  async addBankAccount(
    userId: string,
    accountHolderName: string,
    routingNumber: string,
    accountNumber: string,
    bankName?: string,
    walletAddress?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.addBankAccount`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({
        userId,
        accountHolderName,
        routingNumber,
        accountNumber,
        bankName,
      }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to add bank account');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Remove a bank account
   */
  async removeBankAccount(
    userId: string,
    bankAccountId: string,
    walletAddress?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.removeBankAccount`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, bankAccountId }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to remove bank account');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Set default bank account
   */
  async setDefaultBankAccount(
    userId: string,
    bankAccountId: string,
    walletAddress?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.setDefaultBankAccount`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ userId, bankAccountId }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to set default bank account');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // WITHDRAWALS
  // ──────────────────────────────────────────────────────────

  /**
   * Withdraw funds to bank account
   */
  async withdraw(
    userId: string,
    bankAccountId: string,
    amountUSD: number,
    walletAddress?: string | null,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.withdraw`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, bankAccountId, amountUSD }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to process withdrawal');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get withdrawal history
   */
  async getWithdrawals(
    userId: string,
    limit = 20,
    offset = 0,
    walletAddress?: string | null,
  ) {
    const input = encodeURIComponent(JSON.stringify({ userId, limit, offset }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/p2p.getWithdrawals?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get withdrawals');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // STORE / MARKETPLACE
  // ──────────────────────────────────────────────────────────

  /**
   * Get all stores (public)
   */
  async getStores(options?: {
    coopId?: string;
    category?: string;
    scVerifiedOnly?: boolean;
    featured?: boolean;
    search?: string;
    limit?: number;
    cursor?: string;
  }) {
    const input = encodeURIComponent(
      JSON.stringify({ ...options, coopId: options?.coopId ?? resolveCoopId() }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getStores?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get stores');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get single store details (public)
   */
  async getStore(storeId: string) {
    const input = encodeURIComponent(JSON.stringify({ storeId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getStore?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get store');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get products (public)
   */
  async getProducts(options: {
    coopId?: string;
    storeId?: string;
    category?: string;
    featured?: boolean;
    search?: string;
    limit?: number;
    cursor?: string;
  }) {
    // If no specific store is being queried, scope to the active coop so
    // browsing surfaces don't accidentally mix products across coops.
    const payload = options.storeId
      ? options
      : { ...options, coopId: options.coopId ?? resolveCoopId() };
    const input = encodeURIComponent(JSON.stringify(payload));
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getProducts?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get products');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get single product details (public)
   */
  async getProduct(productId: string) {
    const input = encodeURIComponent(JSON.stringify({ productId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getProduct?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get product');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get my store (authenticated)
   */
  async getMyStore(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyStore`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (!response.ok) {
      throw apiError(result.error, 'Failed to fetch store');
    }
    return result.result?.data || null;
  },

  async getMyStores(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyStores`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get my store');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  async getMyFundingBadges(walletAddress: string, coopId: string = resolveCoopId()) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyFundingBadges`, {
      method: 'GET',
      headers: { ...createApiHeaders(walletAddress), 'X-Coop-Id': coopId },
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      throw apiError(result.error, 'Failed to load funding badges');
    }
    return result.result?.data;
  },

  async getMyFundingBadgeHistory(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyFundingBadgeHistory`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      throw apiError(result.error, 'Failed to load badge history');
    }
    return result.result?.data ?? [];
  },

  async getCommerceTransaction(
    data: { userId: string; transactionId: string },
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/commerce.getTransaction`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get commerce transaction');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  async listCommerceTransactions(
    data: {
      userId: string;
      status?: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
      businessId?: string;
      customerId?: string;
      limit?: number;
      offset?: number;
    },
    walletAddress: string,
  ) {
    const input = encodeURIComponent(JSON.stringify(data));
    const response = await fetch(
      `${API_BASE_URL}/trpc/commerce.listTransactions?input=${input}`,
      {
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to list commerce transactions');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Apply to become a store (authenticated)
   */
  async applyForStore(
    data: {
      storeName: string;
      storeDescription: string;
      category: string;
      imageUrl?: string;
      bannerUrl?: string;
      businessName?: string;
      businessAddress?: string;
      businessCity?: string;
      businessState?: string;
      businessZip?: string;
      ownerName: string;
      ownerEmail: string;
      ownerPhone: string;
      communityBenefitStatement?: string;
      estimatedMonthlyRevenue?: string;
      websiteUrl?: string;
      socialMediaUrls?: string[];
      businessLicenseCID?: string;
    },
    walletAddress: string,
    coopId: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.applyForStore`, {
      method: 'POST',
      // The shop belongs to the commons the member picked.
      headers: { ...createApiHeaders(walletAddress), 'X-Coop-Id': coopId },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to submit store application');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  async createBusinessForStore(
    data: {
      userId: string;
      storeId: string;
      email: string;
      businessType?: 'individual' | 'company';
      country?: string;
    },
    walletAddress: string,
  ) {
    console.log('🔗 [Stripe Connect] Creating business for store', data);
    console.log('🔗 [Stripe Connect] Wallet address', walletAddress);
    console.log('🔗 [Stripe Connect] API base URL', API_BASE_URL);
    const response = await fetch(
      `${API_BASE_URL}/trpc/stripeConnect.createBusinessForStore`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to start Stripe onboarding');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  async syncStripeBusinessStatus(
    data: {
      userId: string;
      businessId: string;
    },
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/stripeConnect.syncStatus`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to sync Stripe onboarding status');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  async submitScVerificationApplication(
    data: {
      storeId: string;
      whyScEligible: string;
      expectedVolume?: string;
    },
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/scVerification.submitApplication`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();
    if (result.error) {
      // tRPC v11 wraps error details in a `json` envelope when no transformer is used
      const message =
        result.error?.json?.message ||
        result.error?.message ||
        'Failed to submit SC rewards application';
      throw apiError(result.error, message);
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data ?? result.result?.data?.json;
  },

  async getMyScVerificationStatus(storeId: string, walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ storeId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/scVerification.getMyApplicationStatus?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      const message =
        result.error?.json?.message ||
        result.error?.message ||
        'Failed to get SC rewards status';
      throw apiError(result.error, message);
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data ?? result.result?.data?.json;
  },

  /**
   * Get my products (authenticated - store owners)
   */
  async getMyProducts(
    walletAddress: string,
    includeInactive = false,
    storeId?: string,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ includeInactive, storeId }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getMyProducts?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get my products');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Add a product (authenticated - store owners)
   */
  async addProduct(
    data: {
      storeId: string;
      name: string;
      description?: string;
      category: string;
      imageUrl?: string;
      images?: string[];
      priceUSD: number;
      ucDiscountPrice?: number;
      sku?: string;
      quantity?: number;
      trackInventory?: boolean;
      allowBackorder?: boolean;
    },
    walletAddress: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.addProduct`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to add product');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Update a product (authenticated - store owners)
   */
  async updateProduct(
    productId: string,
    data: {
      name?: string;
      description?: string;
      category?: string;
      imageUrl?: string | null;
      images?: string[];
      priceUSD?: number;
      ucDiscountPrice?: number | null;
      sku?: string | null;
      quantity?: number;
      trackInventory?: boolean;
      allowBackorder?: boolean;
      isActive?: boolean;
    },
    walletAddress: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.updateProduct`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ productId, ...data }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to update product');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Delete a product (authenticated - store owners)
   */
  async deleteProduct(productId: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.deleteProduct`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ productId }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to delete product');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get featured products for home page (public)
   */
  async getFeaturedProducts(limit?: number) {
    const input = encodeURIComponent(JSON.stringify({ limit: limit || 8 }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getFeaturedProducts?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get featured products');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data || [];
  },

  // ──────────────────────────────────────────────────────────
  // STORE QUICK PAYMENT
  // ──────────────────────────────────────────────────────────

  /**
   * Get store's quick pay info (for store owners)
   */
  async getQuickPayInfo(walletAddress: string) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.getQuickPayInfo`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get quick pay info');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Generate or set store's short code
   */
  async generateShortCode(
    customCode: string | undefined,
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.generateShortCode`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ customCode }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to generate short code');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Check if a short code is available
   */
  async validateShortCode(code: string, walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ code }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.validateShortCode?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to validate short code');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Create a payment request (generates QR/link)
   */
  async createPaymentRequest(
    data: {
      amount?: number;
      description?: string;
      referenceId?: string;
      expiresInMinutes?: number;
    },
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.createPaymentRequest`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify(data),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to create payment request');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get payment request info by token (public)
   */
  async getPaymentRequest(token: string) {
    const input = encodeURIComponent(JSON.stringify({ token }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.getPaymentRequest?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get payment request');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Pay a payment request
   */
  async payRequest(token: string, amount: number, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.payRequest`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ token, amount }),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Payment failed');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get store by short code (public)
   */
  async getStoreByCode(code: string, coopId: string = resolveCoopId()) {
    // Store codes are only unique within a commons, so always send the
    // member's active commons.
    const input = encodeURIComponent(JSON.stringify({ code, coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.getStoreByCode?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get store');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Pay a store directly by code
   */
  async payByStoreCode(
    storeCode: string,
    amount: number,
    note: string | undefined,
    walletAddress: string,
    coopId: string = resolveCoopId(),
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.payByStoreCode`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ storeCode, amount, note, coopId }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Payment failed');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get store's payment request history
   */
  async getMyPaymentRequests(
    status: string | undefined,
    limit: number | undefined,
    cursor: string | undefined,
    walletAddress: string,
  ) {
    const input = encodeURIComponent(JSON.stringify({ status, limit, cursor }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.getMyPaymentRequests?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get payment requests');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Cancel a payment request
   */
  async cancelPaymentRequest(requestId: string, walletAddress: string) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/storePay.cancelPaymentRequest`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ requestId }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to cancel payment request');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // CATEGORIES
  // ──────────────────────────────────────────────────────────

  /**
   * Get store categories (public)
   */
  async getStoreCategories(includeAdminOnly = false) {
    const input = encodeURIComponent(JSON.stringify({ includeAdminOnly }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/categories.getStoreCategories?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get store categories');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // ORDERS
  // ──────────────────────────────────────────────────────────

  /**
   * Create an order from cart items
   */
  async createOrder(
    data: {
      storeId: string;
      items: { productId: string; quantity: number }[];
      shippingAddress?: string;
      note?: string;
    },
    walletAddress: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.createOrder`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to create order');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get buyer's order history
   */
  async getMyOrders(walletAddress: string, limit = 20, cursor?: string) {
    const input = encodeURIComponent(JSON.stringify({ limit, cursor }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getMyOrders?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get orders');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get single order details
   */
  async getOrder(orderId: string, walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ orderId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getOrder?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get order');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get store's incoming orders (for store owners)
   */
  async getStoreOrders(
    walletAddress: string,
    options?: {
      storeId?: string;
      status?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    const input = encodeURIComponent(JSON.stringify(options || {}));
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.getStoreOrders?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get store orders');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Update order fulfillment status (for store owners)
   */
  async updateOrderStatus(
    orderId: string,
    status: 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED',
    trackingNumber: string | undefined,
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/store.updateOrderStatus`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ orderId, status, trackingNumber }),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to update order status');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  /**
   * Get product categories (public)
   */
  async getProductCategories(includeAdminOnly = false) {
    const input = encodeURIComponent(JSON.stringify({ includeAdminOnly }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/categories.getProductCategories?input=${input}`,
      {
        method: 'GET',
        headers: {
          ...networkConfig.defaultHeaders,
        },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get product categories');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SC REWARDS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get user's SC reward history
   */
  async getUserSCRewards(
    userId: string,
    limit = 10,
    walletAddress?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({
        userId,
        status: 'COMPLETED', // Only show completed rewards
        limit,
        offset: 0,
      }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/scRewards.getSCRewards?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get SC rewards');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getResourceInvitations(sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.myResourceInvitations`, {
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<Array<{ id: string; coopId: string; coopName: string; kind: string; title: string; description: string; invitedAt: string | null }>>(
      response, 'Could not load resource invitations',
    );
  },

  async getCommonsResources(coopId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.listResources?input=${input}`, {
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<Array<{ id: string; kind: string; title: string; description: string; publishedAt: string | null }>>(
      response, 'Could not load Commons resources',
    );
  },

  async respondToResourceInvitation(resourceId: string, accept: boolean, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.respondToResourceInvitation`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ resourceId, accept }),
    });
    return readTrpcResult<{ accepted: boolean; listed: boolean }>(response, 'Could not respond to invitation');
  },

  async getResourceSettings(coopId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.resourceSettings?input=${input}`, {
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<{ autoListResources: boolean; isSteward: boolean }>(response, 'Could not load listing settings');
  },

  async setResourceAutoList(coopId: string, enabled: boolean, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.setResourceAutoList`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ coopId, enabled }),
    });
    return readTrpcResult<{ autoListResources: boolean }>(response, 'Could not change the listing setting');
  },

  async getResourcesAwaitingReview(coopId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.resourcesAwaitingReview?input=${input}`, {
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<Array<{ id: string; kind: string; title: string; description: string; respondedAt: string | null }>>(
      response, 'Could not load listings waiting for review',
    );
  },

  async reviewResource(resourceId: string, publish: boolean, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.reviewResource`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ resourceId, publish }),
    });
    return readTrpcResult<{ listed: boolean }>(response, 'Could not review this listing');
  },

  async getCommonsProposalDrafts(sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.myProposalDrafts`, {
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<Array<{ id: string; coopId: string; title: string; body: string }>>(
      response, 'Could not load proposal drafts',
    );
  },

  async getProposalActionSummary(coopId: string, walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposal.myActionSummary?input=${input}`,
      {
        headers: {
          ...createApiHeaders(walletAddress),
          'x-coop-id': coopId,
        },
      },
    );
    return readTrpcResult<{
      canVote: true;
      actionableVoteCount: number;
      actionableProposalIds: string[];
    }>(response, 'Could not load proposal actions');
  },

  async saveCommonsProposalDraft(draftId: string, title: string, body: string, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.updateMyProposalDraft`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ draftId, title, body }),
    });
    return readTrpcResult<{ saved: boolean }>(response, 'Could not save proposal draft');
  },

  async markCommonsProposalDraftSubmitted(draftId: string, proposalId: string, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/commonsActions.markProposalDraftSubmitted`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ draftId, proposalId }),
    });
    return readTrpcResult<{ submitted: boolean }>(response, 'Could not mark proposal draft submitted');
  },

  /**
   * Get user's notifications
   */
  async getNotifications(
    sessionToken: string,
    options?: {
      limit?: number;
      cursor?: NotificationCursor;
      unreadOnly?: boolean;
      category?: NotificationCategory;
    },
  ) {
    const input = encodeURIComponent(JSON.stringify(options || {}));
    const response = await fetch(
      `${API_BASE_URL}/trpc/notification.getNotifications?input=${input}`,
      {
        headers: createApiHeaders(null, sessionToken),
      },
    );
    return readTrpcResult<NotificationPage>(response, 'Could not load alerts');
  },

  async getUnreadNotificationCount(sessionToken: string) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/notification.getUnreadCount`,
      { headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<{ count: number }>(
      response,
      'Could not load unread count',
    );
  },

  async markNotificationAsRead(notificationId: string, sessionToken: string) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/notification.markAsRead`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({ notificationId }),
      },
    );
    return readTrpcResult<{ success: boolean }>(
      response,
      'Could not mark alert as read',
    );
  },

  async getNotificationPreferences(sessionToken: string) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/notification.getPreferences`,
      { headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<NotificationPreferences>(
      response,
      'Could not load notification settings',
    );
  },

  async updateNotificationPreferences(
    sessionToken: string,
    preferences: Partial<NotificationPreferences>,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/notification.updatePreferences`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify(preferences),
      },
    );
    return readTrpcResult<NotificationPreferences>(
      response,
      'Could not save notification settings',
    );
  },

  // ── Sage Suggestions ────────────────────────────────────────────────────────

  async listSageSuggestions(
    tab: 'NEEDS_YOU' | 'WAITING' | 'DONE',
    sessionToken: string,
    cursor?: string,
    coopId = 'cahootz',
  ) {
    const input = encodeURIComponent(JSON.stringify({ coopId, tab, ...(cursor ? { cursor } : {}) }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/sage.list?input=${input}`,
      { headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<{
      suggestions: Array<{ id: string; title: string; circleId: string | null; status: string; createdAt: string }>;
      nextCursor: string | null;
    }>(response, 'Could not load Sage suggestions');
  },

  async getSageSuggestion(actionId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ actionId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/sage.getDetail?input=${input}`,
      { headers: createApiHeaders(null, sessionToken) },
    );
    return readTrpcResult<{
      suggestion: {
        id: string;
        coopId: string;
        title: string;
        status: string;
        circleId: string | null;
        evidence: string | null;
        role: string;
        capability: string | null;
        proposedText: string | null;
        reason: string | null;
        result: { entityType: string; entityId: string } | null;
      };
      context: {
        circle: { id: string; name: string };
        targetPost: { id: string; title: string; content: string; author: string; createdAt: string } | null;
        conversation: Array<{ author: string; content: string; createdAt: string }>;
      } | null;
      reviews: Array<{ id: string; reviewType: string; status: string; presentationData: Record<string, unknown> | null; payloadHash: string }>;
      auditEvents: Array<{ description: string; createdAt: string }>;
    }>(response, 'Could not load this Sage suggestion');
  },

  async respondToSageReview(
    reviewId: string,
    response_: 'APPROVE' | 'DECLINE' | 'ESCALATE',
    sessionToken: string,
    payload?: Record<string, unknown>,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/sage.respondToReview`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ reviewId, response: response_, ...(payload ? { payload } : {}) }),
    });
    return readTrpcResult<{ success: boolean }>(response, 'Could not send your response');
  },

  async listSageTasks(sessionToken: string, coopId = 'cahootz') {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(`${API_BASE_URL}/trpc/sage.listTasks?input=${input}`, { headers: createApiHeaders(null, sessionToken) });
    return readTrpcResult<{ open: SageTaskView[]; closed: SageTaskView[] }>(response, "Could not load Sage's follow-ups");
  },

  async dismissSageTask(taskId: string, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/sage.dismissTask`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken), body: JSON.stringify({ taskId }),
    });
    return readTrpcResult<{ dismissed: boolean }>(response, 'Could not dismiss this follow-up');
  },

  async getSageAlert(alertId: string, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify({ alertId }));
    const response = await fetch(`${API_BASE_URL}/trpc/sage.getAlert?input=${input}`, { headers: createApiHeaders(null, sessionToken) });
    return readTrpcResult<SageAlertView>(response, 'Could not load this alert');
  },

  async acknowledgeSageAlert(alertId: string, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/sage.acknowledgeAlert`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken), body: JSON.stringify({ alertId }),
    });
    return readTrpcResult<{ acknowledged: boolean }>(response, 'Could not update this alert');
  },

  async sageAlertNotForMe(alertId: string, sessionToken: string, feedback?: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/sage.alertNotForMe`, {
      method: 'POST', headers: createApiHeaders(null, sessionToken), body: JSON.stringify({ alertId, ...(feedback ? { feedback } : {}) }),
    });
    return readTrpcResult<{ rerouted: boolean; to: string | null }>(response, 'Could not pass this alert on');
  },

  async getSageTrailSettings(sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/sage.trailSettings`, {
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<{ showSageDecisionTrails: boolean }>(response, 'Could not load Sage settings');
  },

  async setSageTrailSettings(showSageDecisionTrails: boolean, sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/sage.setTrailSettings`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
      body: JSON.stringify({ showSageDecisionTrails }),
    });
    return readTrpcResult<{ showSageDecisionTrails: boolean }>(response, 'Could not save Sage settings');
  },

  async listSageTrails(filter: SageTrailFilter, sessionToken: string) {
    const input = encodeURIComponent(JSON.stringify(filter));
    const response = await fetch(`${API_BASE_URL}/trpc/sage.listTrails?input=${input}`, {
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<{ enabled: boolean; trails: SageDecisionTrail[] }>(response, "Could not load Sage's decision trail");
  },

  async markSageSuggestionsSeen(sessionToken: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/sage.markSeen`, {
      method: 'POST',
      headers: createApiHeaders(null, sessionToken),
    });
    return readTrpcResult<{ success: boolean; count: number }>(response, 'Could not update Sage alerts');
  },

  // ── Coop Config ────────────────────────────────────────────────────────────

  /**
   * Get list of available coops for onboarding
   */
  async listAvailableCoops() {
    const response = await fetch(
      `${API_BASE_URL}/trpc/coopConfig.listAvailableCoops?input={}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get available coops');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }
    return result.result?.data as {
      id: string;
      name: string;
      tagline: string;
      description: string;
      mission: string;
      features: { title: string; description: string }[];
      eligibility: string;
      bgColor: string;
      accentColor: string;
    }[];
  },

  /**
   * Get the active CoopConfig (includes proposalCategories for label lookup)
   */
  async getCoopConfig(coopId: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/coopConfig.getActive?input=${input}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const result = await response.json();
    if (result.error) return null;
    return result.result?.data as CoopConfigDetail | null;
  },

  // ── Proposals ──────────────────────────────────────────────────────────────

  /**
   * List proposals with optional status filter
   */
  async listProposals(
    options: {
      coopId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
    walletAddress?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({
        coopId: options.coopId || resolveCoopId(),
        status: options.status,
        limit: options.limit ?? 20,
        offset: options.offset ?? 0,
      }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposal.list?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to load proposals');
    return result.result?.data as {
      proposals: ProposalSummary[];
      total: number;
      hasMore: boolean;
    };
  },

  /**
   * Get a single proposal by ID
   */
  async getProposal(id: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ id }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposal.getById?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to load proposal');
    return result.result?.data;
  },

  /**
   * Get proposals submitted by a specific wallet address
   */
  async getMyProposals(
    walletAddress: string,
    limit = 20,
    offset = 0,
    coopId?: string,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ wallet: walletAddress, coopId, limit, offset }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposal.getByProposer?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to load proposals');
    return result.result?.data as { proposals: any[]; total: number };
  },

  /**
   * Submit a new proposal (authenticated — requires wallet)
   */
  async createProposal(text: string, walletAddress: string, coopId?: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.create`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ text, coopId: coopId || resolveCoopId() }),
    });
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to submit proposal');
    return result.result?.data;
  },

  /**
   * List comments for a proposal
   */
  async listProposalComments(
    proposalId: string,
    walletAddress?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ proposalId, limit: 50, offset: 0 }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposalComment.listByProposal?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to load comments');
    return result.result?.data as { comments: any[]; total: number };
  },

  /**
   * Post a comment on a proposal (authenticated — requires wallet)
   */
  async createProposalComment(
    proposalId: string,
    content: string,
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposalComment.create`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ proposalId, content }),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to post comment');
    return result.result?.data;
  },

  /**
   * React to a proposal (toggle support/concern)
   * Authenticated — requires wallet address
   */
  async reactToProposal(
    proposalId: string,
    reaction: 'SUPPORT' | 'CONCERN',
    walletAddress: string,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposalReaction.upsert`,
      {
        method: 'POST',
        headers: createApiHeaders(walletAddress),
        body: JSON.stringify({ proposalId, reaction }),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to react');
    return result.result?.data as {
      support: number;
      concern: number;
      myReaction: 'SUPPORT' | 'CONCERN' | null;
    };
  },

  /**
   * Get reaction counts for a proposal
   */
  async getReactionCounts(proposalId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(
      JSON.stringify({ proposalId, walletAddress: walletAddress ?? undefined }),
    );
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposalReaction.getCounts?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to get reaction counts');
    return result.result?.data as {
      support: number;
      concern: number;
      myReaction: 'SUPPORT' | 'CONCERN' | null;
    };
  },

  /**
   * Withdraw a proposal (proposer only)
   */
  async withdrawProposal(id: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.withdraw`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ id }),
    });
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to withdraw proposal');
    return result.result?.data;
  },

  /**
   * Cast a council vote on a proposal (admin only)
   */
  async councilVote(
    proposalId: string,
    vote: 'FOR' | 'AGAINST' | 'ABSTAIN',
    walletAddress: string,
    coopId: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.councilVote`, {
      method: 'POST',
      headers: {
        ...createApiHeaders(walletAddress),
        'x-coop-id': coopId,
      },
      body: JSON.stringify({ proposalId, vote }),
    });
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to cast council vote');
    return result.result?.data as {
      vote: string;
      forCount: number;
      againstCount: number;
      abstainCount: number;
      newStatus: string | null;
    };
  },

  /**
   * Resubmit / edit a proposal (proposer only, status must be submitted or votable)
   */
  async resubmitProposal(
    proposalId: string,
    text: string,
    walletAddress: string,
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.resubmit`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ proposalId, text }),
    });
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to resubmit proposal');
    return result.result?.data;
  },

  /**
   * Get the full submission audit trail for a proposal (all revisions)
   */
  async getProposalRevisions(
    proposalId: string,
    walletAddress?: string | null,
  ) {
    const input = encodeURIComponent(JSON.stringify({ proposalId }));
    const response = await fetch(
      `${API_BASE_URL}/trpc/proposal.getRevisions?input=${input}`,
      {
        method: 'GET',
        headers: createApiHeaders(walletAddress),
      },
    );
    const result = await response.json();
    if (result.error)
      throw apiError(result.error, 'Failed to load revision history');
    return result.result?.data as {
      id: string;
      revisionNumber: number;
      submittedAt: string;
      rawText?: string;
      evaluation?: any;
      decision?: string;
      decisionReasons: string[];
      auditChecks: any[];
      status: string;
      engineVersion: string;
    }[];
  },

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(sessionToken: string) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/notification.markAllAsRead`,
      {
        method: 'POST',
        headers: createApiHeaders(null, sessionToken),
        body: JSON.stringify({}),
      },
    );
    return readTrpcResult<{ success: boolean }>(
      response,
      'Could not mark alerts as read',
    );
  },

  async getActiveFeeConfig(walletAddress?: string | null): Promise<{
    id: string;
    platformMarkupBps: number;
    merchantFeeBps: number;
    treasuryFeeBps: number;
  }> {
    const response = await fetch(
      `${API_BASE_URL}/trpc/treasuryLedger.getActiveFeeConfig`,
      {
        method: 'GET',
        headers: walletAddress
          ? createApiHeaders(walletAddress)
          : { ...networkConfig.defaultHeaders },
      },
    );

    const result = await response.json();
    if (result.error) {
      const message =
        result.error?.json?.message ||
        result.error?.message ||
        'Failed to load fee config';
      throw apiError(result.error, message);
    }

    return (
      result.result?.data ??
      result.result?.data?.json ?? {
        id: 'default',
        platformMarkupBps: 400,
        merchantFeeBps: 0,
        treasuryFeeBps: 400,
      }
    );
  },

  async getPlatformConfig(): Promise<{
    coin: { symbol: string; name: string; description: string };
    platformName: string;
  }> {
    const response = await fetch(
      `${API_BASE_URL}/trpc/platformConfig.getConfig`,
      {
        method: 'GET',
        headers: { ...networkConfig.defaultHeaders },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to load platform config');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return (
      result.result?.data ?? {
        coin: { symbol: 'SC', name: 'Cahootz Coin', description: '' },
        platformName: 'Cahootz',
      }
    );
  },

  /**
   * Get application questions for a specific coop
   */
  async getApplicationQuestions(coopId: string) {
    const response = await fetch(
      `${API_BASE_URL}/trpc/coopConfig.getApplicationQuestions?input=${encodeURIComponent(JSON.stringify({ coopId }))}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const result = await response.json();
    if (result.error) {
      throw apiError(result.error, 'Failed to get application questions');
    }
    if (!response.ok) {
      throw httpError(response.status);
    }

    return result.result?.data as { questions: ApplicationQuestion[] };
  },
};

// Hallmark - pre-emit critique: P4 H4 E4 S4 R4 V4
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings,
  Share2,
  ShoppingBag,
  SmilePlus,
  Sparkles,
  Store,
  UserCircle,
  Users,
  Vote,
  Wallet,
  X,
} from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { api, type CommonsDirectoryItem, type CommonsPost, type CommonsProfile } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

type Message = {
  id: string;
  role: 'assistant' | 'visitor';
  body: string;
};

type PendingAction = (sessionToken: string) => Promise<void>;
type ComposerNotice = { type: 'success' | 'error' | 'info'; body: string } | null;
type SuggestionStatus = 'idle' | 'submitting' | 'success' | 'error';

type CommonsAiEntryProps = {
  feedCoopId?: string;
  onMessagesPress?: () => void;
  onSignInPress?: () => void;
};

const SOCIAL_THEME = {
  paper: '#F6F7F8',
  primary: '#F97316',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  ink: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
};

const DEFAULT_COMMONS_PROFILE: CommonsProfile = {
  id: 'cahootz',
  name: 'Cahootz Commons',
  shortName: 'Cahootz',
  description: 'A social commons for conversation, resources, and coordinated action.',
};

const FEED_FILTERS = ['Trending', 'New', 'Market', 'Events', 'Support'] as const;
type FeedFilter = (typeof FEED_FILTERS)[number];

const EMOJI_SHORTCUTS = ['😂', '🔥', '👏', '🙏', '💡', '🎨', '📍', '💼', '🤝', '❤️', '👀', '🙌'] as const;
const PRIMARY_EMOJI_COUNT = 6;

const COMMONS_RULES = [
  'A commons is a social space for a real group, place, identity, craft, or shared economic interest.',
  'Members can talk normally, share wins, post needs, support businesses, and turn useful threads into action.',
  'Every commons should create value for its members. No scams, harassment, hate, extraction, or charity-only spaces.',
] as const;

const EVENT_SEARCH_TERMS = [
  'event',
  'meetup',
  'meeting',
  'workshop',
  'pop-up',
  'popup',
  'market',
  'tonight',
  'tomorrow',
  'saturday',
  'sunday',
] as const;

const MARKET_SEARCH_TERMS = [
  'market',
  'sell',
  'selling',
  'buy',
  'shop',
  'vendor',
  'business',
  'service',
  'offer',
  'available',
  'hiring',
] as const;

const isEventPost = (post: CommonsPost) => {
  if (post.tag === 'Opportunity') return true;
  const text = `${post.title} ${post.body}`.toLowerCase();
  return EVENT_SEARCH_TERMS.some((term) => text.includes(term));
};

const isSupportLanePost = (post: CommonsPost) =>
  post.tag === 'Need' || post.tag === 'Resource' || post.tag === 'Vote';

const isMarketPost = (post: CommonsPost) => {
  if (post.tag === 'Opportunity' || post.tag === 'Resource') return true;
  const text = `${post.title} ${post.body}`.toLowerCase();
  return MARKET_SEARCH_TERMS.some((term) => text.includes(term));
};

const DRAWER_NAV_ITEMS = [
  { label: 'Marketplace', description: 'Member businesses', icon: ShoppingBag, action: '/(tabs)/store' },
  { label: 'Proposals', description: 'Votes and drafts', icon: Vote, action: '/cahootz/proposal' },
  { label: 'Direct messages', description: 'Private follow-up', icon: MessageCircle, action: '/(tabs)/messages' },
];

function buildAiResponse(input: string, selectedPost?: CommonsPost): string {
  const source = input.trim() || selectedPost?.body || '';
  const lower = source.toLowerCase();

  if (!source) {
    return 'Pick a post or write a draft. I can summarize it, identify helpers, shape a vote, or turn it into a proposal.';
  }

  if (lower.includes('vote')) {
    return [
      'Vote shape:',
      'Question: What exactly should the community decide?',
      'Options: approve, revise, or decline.',
      'Before opening: confirm budget, steward, deadline, and who is eligible to vote.',
    ].join('\n');
  }

  if (lower.includes('fund') || lower.includes('cost') || lower.includes('pool') || lower.includes('$')) {
    return [
      'Resource read:',
      'This needs a clear minimum target, acceptable non-money contributions, and a steward who reports back.',
      'Start with pledges for dollars, tools, space, time, and local vendor quotes.',
    ].join('\n');
  }

  if (lower.includes('food') || lower.includes('child') || lower.includes('school') || lower.includes('mentor')) {
    return [
      'Coordination read:',
      'This should become a small working circle before a formal vote.',
      'Next steps: list affected people, available helpers, timing, safety needs, and the first low-cost pilot.',
    ].join('\n');
  }

  return [
    'Cahootz read:',
    'This can become a community thread first.',
    'If people respond with support, the app can turn it into a helper list, resource plan, or proposal draft.',
  ].join('\n');
}

export default function CommonsAiEntry({ feedCoopId = 'all', onMessagesPress, onSignInPress }: CommonsAiEntryProps) {
  const scrollRef = useRef<ScrollView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const { isAuthenticated, login, logout, sessionToken, user } = useAuth();
  const [draft, setDraft] = useState('');
  const [feedPosts, setFeedPosts] = useState<CommonsPost[]>([]);
  const [commonsProfile, setCommonsProfile] = useState<CommonsProfile>(DEFAULT_COMMONS_PROFILE);
  const [memberCommons, setMemberCommons] = useState<CommonsDirectoryItem[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('Trending');
  const [searchOpen, setSearchOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composerPickerOpen, setComposerPickerOpen] = useState(false);
  const [selectedComposerCoopId, setSelectedComposerCoopId] = useState(feedCoopId === 'all' ? 'cahootz' : feedCoopId);
  const [feedError, setFeedError] = useState('');
  const [commentingPostId, setCommentingPostId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [isPosting, setIsPosting] = useState(false);
  const [, setIsAskingAi] = useState(false);
  const [emojiExpanded, setEmojiExpanded] = useState(false);
  const [composerNotice, setComposerNotice] = useState<ComposerNotice>(null);
  const [accountPromptOpen, setAccountPromptOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [suggestCommonsOpen, setSuggestCommonsOpen] = useState(false);
  const [suggestedCommonsName, setSuggestedCommonsName] = useState('');
  const [suggestedCommonsReason, setSuggestedCommonsReason] = useState('');
  const [suggestedCommonsEmail, setSuggestedCommonsEmail] = useState('');
  const [suggestionStatus, setSuggestionStatus] = useState<SuggestionStatus>('idle');
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [, setMessages] = useState<Message[]>([
    {
      id: 'assistant-open',
      role: 'assistant',
      body:
        'Ask me anything about the commons, or use me inside a thread to turn conversation into helpers, votes, budgets, and proposal drafts.',
    },
  ]);
  const hasAccountSession = isAuthenticated && !!sessionToken;
  const accountName = user?.name?.trim() || user?.email?.split('@')[0] || 'member';
  const visibleEmojiShortcuts = emojiExpanded ? EMOJI_SHORTCUTS : EMOJI_SHORTCUTS.slice(0, PRIMARY_EMOJI_COUNT);
  const isScopedFeed = feedCoopId !== 'all';
  const feedTitle = isScopedFeed ? commonsProfile.name : 'Home';
  const feedShortName = isScopedFeed ? (commonsProfile.shortName || commonsProfile.name) : 'Home';
  const postableCommons = useMemo(() => {
    const byId = new Map<string, CommonsDirectoryItem>();
    const fallback = {
      ...DEFAULT_COMMONS_PROFILE,
      accessStatus: 'ACTIVE' as const,
      isMember: true,
      isLocked: false,
      canApply: false,
    };

    byId.set(fallback.id, fallback);
    memberCommons.forEach((commons) => byId.set(commons.id, commons));
    return Array.from(byId.values());
  }, [memberCommons]);
  const selectedComposerCommons = postableCommons.find((commons) => commons.id === selectedComposerCoopId) || postableCommons[0];
  const scopedFeedLocked =
    isScopedFeed &&
    feedCoopId !== DEFAULT_COMMONS_PROFILE.id &&
    directoryLoaded &&
    !memberCommons.some((commons) => commons.id === feedCoopId);
  const commonsDrawerItems = useMemo(
    () => {
      const activeCommonsForDrawer = memberCommons.length > 0
        ? memberCommons
        : [{
            ...DEFAULT_COMMONS_PROFILE,
            accessStatus: 'ACTIVE' as const,
            isMember: true,
            isLocked: false,
            canApply: false,
          }];

      return [
      ...activeCommonsForDrawer.map((commons) => ({
        id: commons.id,
        label: commons.name,
        description: commons.description,
        icon: commons.name.slice(0, 1).toUpperCase(),
      })),
      {
        id: 'discover-commons',
        label: 'Discover commons',
        description: 'Browse and apply',
        icon: '+',
      },
    ];
    },
    [memberCommons]
  );

  useEffect(() => {
    let mounted = true;

    api
      .listCommonsFeed(feedCoopId, sessionToken)
      .then((result) => {
        if (!mounted) return;
        setCommonsProfile(result.coop || DEFAULT_COMMONS_PROFILE);
        setFeedPosts(result.posts);
        setSelectedPostId((current) => current || result.posts[0]?.id || null);
        setFeedError('');
      })
      .catch((error) => {
        console.error('Failed to load Commons feed:', error);
        if (mounted) setFeedError('Could not load the Commons feed. Pull to refresh when the connection is back.');
      });

    return () => {
      mounted = false;
    };
  }, [feedCoopId, sessionToken]);

  useEffect(() => {
    let mounted = true;

    if (!sessionToken) {
      setMemberCommons([]);
      setDirectoryLoaded(true);
      return () => {
        mounted = false;
      };
    }

    setDirectoryLoaded(false);
    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        if (!mounted) return;
        setMemberCommons(result.coops.filter((commons) => commons.accessStatus === 'ACTIVE'));
      })
      .catch((error) => {
        console.error('Failed to load member commons:', error);
        if (mounted) setMemberCommons([]);
      })
      .finally(() => {
        if (mounted) setDirectoryLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, [sessionToken]);

  useEffect(() => {
    if (postableCommons.length === 0) return;
    const preferredCoopId = isScopedFeed ? feedCoopId : selectedComposerCoopId;
    const preferredExists = postableCommons.some((commons) => commons.id === preferredCoopId);

    if (preferredExists) {
      setSelectedComposerCoopId(preferredCoopId);
      return;
    }

    setSelectedComposerCoopId(postableCommons[0].id);
  }, [feedCoopId, isScopedFeed, postableCommons, selectedComposerCoopId]);

  const selectedPost = useMemo(
    () => feedPosts.find((post) => post.id === selectedPostId),
    [feedPosts, selectedPostId]
  );
  const visiblePosts = useMemo(() => {
    const groupPosts =
      activeFilter === 'Events'
        ? feedPosts.filter(isEventPost)
        : activeFilter === 'Support'
          ? feedPosts.filter(isSupportLanePost)
          : activeFilter === 'Market'
            ? feedPosts.filter(isMarketPost)
            : activeFilter === 'Trending'
              ? [...feedPosts].sort((a, b) => b.support - a.support || b.replies - a.replies)
              : feedPosts;
    const query = searchQuery.trim().toLowerCase();

    if (!query) return groupPosts;

    return groupPosts.filter((post) => {
      const haystack = [
        post.title,
        post.body,
        post.author,
        post.group,
        post.tag,
        post.pledges,
        ...post.comments.flatMap((comment) => [comment.author, comment.body]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [activeFilter, feedPosts, searchQuery]);

  useEffect(() => {
    if (visiblePosts.length === 0) return;
    if (!visiblePosts.some((post) => post.id === selectedPostId)) {
      setSelectedPostId(visiblePosts[0].id);
    }
  }, [selectedPostId, visiblePosts]);

  const requireAccount = async (action: PendingAction) => {
    if (hasAccountSession) {
      await action(sessionToken);
      return;
    }

    pendingActionRef.current = action;
    setAuthError('');
    setAccountPromptOpen(true);
  };

  const askAi = async (prompt: string, post?: CommonsPost) => {
    const trimmed = prompt.trim();
    if (!trimmed && !post) return;

    setIsAskingAi(true);
    const visitorMessage: Message = {
      id: `visitor-${Date.now()}`,
      role: 'visitor',
      body: trimmed || `${post?.title}\n${post?.body}`,
    };
    setMessages((current) => [...current, visitorMessage]);

    try {
      const result = await api.askCommonsAi(
        trimmed || `Help me understand this thread: ${post?.title}. ${post?.body}`,
        post?.id
      );
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: 'assistant', body: result.answer },
      ]);
    } catch (error) {
      console.error('Commons AI request failed:', error);
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: 'assistant', body: buildAiResponse(trimmed, post) },
      ]);
    } finally {
      setIsAskingAi(false);
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
    }
  };

  const postDraft = () => {
    const trimmed = draft.trim();
    if (isPosting) return;
    if (!trimmed) {
      setComposerNotice({ type: 'error', body: 'Write something first.' });
      return;
    }

    if (!hasAccountSession) {
      setComposerNotice({ type: 'info', body: `Sign in once to publish posts in ${selectedComposerCommons?.name || 'a commons'}.` });
    }

    if (!selectedComposerCommons) {
      setComposerNotice({ type: 'error', body: 'Choose a commons first.' });
      return;
    }

    void requireAccount(async (token) => {
      setIsPosting(true);
      setComposerNotice(null);
      try {
        const result = await api.createCommonsPost({ content: trimmed, coopId: selectedComposerCommons.id }, token);
        const belongsInCurrentFeed = feedCoopId === 'all' || result.post.coopId === feedCoopId;
        if (belongsInCurrentFeed) {
          setFeedPosts((current) => [result.post, ...current]);
          setSelectedPostId(result.post.id);
          setActiveFilter('New');
        }
        setDraft('');
        setComposerNotice({
          type: 'success',
          body: belongsInCurrentFeed
            ? `Posted to ${selectedComposerCommons.name}.`
            : `Posted to ${selectedComposerCommons.name}. It will show in Home.`,
        });
      } catch (error) {
        console.error('Failed to publish post:', error);
        const message = error instanceof Error ? error.message : 'Could not publish post.';
        setAuthError(message);
        setComposerNotice({ type: 'error', body: message });
      } finally {
        setIsPosting(false);
      }
    });
  };

  const appendEmoji = (emoji: string) => {
    setDraft((current) => {
      const trimmed = current.trimEnd();
      return trimmed ? `${trimmed} ${emoji}` : emoji;
    });
    setComposerNotice(null);
  };

  const composerNoticeColor = () => {
    if (!composerNotice) return SOCIAL_THEME.muted;
    if (composerNotice.type === 'error') return '#DC2626';
    if (composerNotice.type === 'success') return '#047857';
    return SOCIAL_THEME.muted;
  };

  const openSuggestCommons = () => {
    setDrawerOpen(false);
    setSuggestionStatus('idle');
    setSuggestionMessage('');
    if (user?.email) setSuggestedCommonsEmail(user.email);
    setSuggestCommonsOpen(true);
  };

  const submitCommonsSuggestion = async () => {
    if (suggestionStatus === 'submitting') return;

    const name = suggestedCommonsName.trim();
    const reason = suggestedCommonsReason.trim();
    const email = (user?.email || suggestedCommonsEmail).trim().toLowerCase();

    if (!name) {
      setSuggestionStatus('error');
      setSuggestionMessage('Name the commons you want to see.');
      return;
    }

    if (!email.includes('@')) {
      setSuggestionStatus('error');
      setSuggestionMessage('Add an email so we can follow up.');
      return;
    }

    setSuggestionStatus('submitting');
    setSuggestionMessage('');

    try {
      await api.suggestCommons(
        {
          name,
          reason: reason || undefined,
          email,
          suggestedByName: user?.name || undefined,
        },
        sessionToken
      );
      setSuggestionStatus('success');
      setSuggestionMessage('Suggestion sent. We will use it to decide which commons to open next.');
      setSuggestedCommonsName('');
      setSuggestedCommonsReason('');
    } catch (error) {
      console.error('Commons suggestion failed:', error);
      setSuggestionStatus('error');
      setSuggestionMessage(error instanceof Error ? error.message : 'Could not send the suggestion. Try again.');
    }
  };
  const runAiAction = (action: string, post = selectedPost) => {
    const prompt =
      action === 'Draft next step'
        ? `Draft a practical next step from this community conversation: ${post?.title || draft}. ${post?.body || draft}`
        : `${action}: ${post?.title || draft}. ${post?.body || draft}`;
    void askAi(prompt, post);
  };

  const sharePost = async (post: CommonsPost) => {
    try {
      await Share.share({
        title: post.title,
        message: `${post.title}\n\n${post.body}\n\n${post.group}`,
      });
    } catch (error) {
      console.error('Failed to share post:', error);
    }
  };

  const shareConversationInvite = async () => {
    const post = selectedPost;
    const message = post
      ? [
          `Can you look at this ${commonsProfile.name} conversation?`,
          '',
          post.title,
          post.body,
          '',
          'You can read it first and make an account only when you want to comment, support, or help.',
        ].join('\n')
      : [
          `Join me in ${commonsProfile.name}.`,
          '',
          'It is a social feed where community conversations can turn into coordinated help, votes, proposals, and shared resources.',
        ].join('\n');

    try {
      await Share.share({
        title: post?.title || commonsProfile.name,
        message,
      });
    } catch (error) {
      console.error('Failed to invite someone:', error);
    }
  };

  const submitComment = (post: CommonsPost) => {
    const content = commentDrafts[post.id]?.trim();
    if (!content) {
      setCommentingPostId(post.id);
      return;
    }

    void requireAccount(async (token) => {
      try {
        const result = await api.createCommonsComment({ postId: post.id, content }, token);
        setFeedPosts((current) =>
          current.map((item) =>
            item.id === post.id
              ? {
                  ...item,
                  replies: item.replies + 1,
                  comments: [...item.comments, result.comment].slice(-3),
                }
              : item
          )
        );
        setCommentDrafts((current) => ({ ...current, [post.id]: '' }));
        setCommentingPostId(null);
      } catch (error) {
        console.error('Failed to comment:', error);
        setAuthError(error instanceof Error ? error.message : 'Could not add comment.');
      }
    });
  };

  const supportPost = (post: CommonsPost) => {
    void requireAccount(async (token) => {
      try {
        const result = await api.toggleCommonsSupport(post.id, token);
        setFeedPosts((current) =>
          current.map((item) =>
            item.id === post.id
              ? { ...item, support: Math.max(0, item.support + (result.supported ? 1 : -1)) }
              : item
          )
        );
      } catch (error) {
        console.error('Failed to support post:', error);
        setAuthError(error instanceof Error ? error.message : 'Could not update support.');
      }
    });
  };

  const openMessages = () => {
    void requireAccount(async () => {
      onMessagesPress?.();
    });
  };

  const handleFilterPress = (filter: FeedFilter) => {
    setActiveFilter(filter);
  };

  const openSearch = () => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const requestCode = async () => {
    const email = accountEmail.trim().toLowerCase();
    if (isAuthBusy || !email.includes('@')) {
      setAuthError('Enter a valid email address.');
      return;
    }

    setIsAuthBusy(true);
    setAuthError('');

    try {
      await api.requestLoginCode(email);
      setCodeSent(true);
    } catch (error) {
      console.error('Request code failed:', error);
      setAuthError(error instanceof Error ? error.message : 'Could not send a code. Try again.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const verifyCode = async () => {
    const email = accountEmail.trim().toLowerCase();
    if (isAuthBusy || !email || accountCode.trim().length !== 6) {
      setAuthError('Enter the 6 digit code from your email.');
      return;
    }

    setIsAuthBusy(true);
    setAuthError('');

    try {
      const data = await api.verifyLoginCode(email, accountCode);

      if (data.success && data.user) {
        const verifiedUser = {
          ...data.user,
          createdAt: new Date(data.user.createdAt),
          profileOnboardingCompletedAt: data.user.profileOnboardingCompletedAt
            ? new Date(data.user.profileOnboardingCompletedAt)
            : null,
        };
        await login(verifiedUser);
        setAccountPromptOpen(false);
        setAccountCode('');
        setCodeSent(false);

        const pendingAction = pendingActionRef.current;
        pendingActionRef.current = null;
        if (verifiedUser.sessionToken && pendingAction && verifiedUser.profileOnboardingCompletedAt) {
          await pendingAction(verifiedUser.sessionToken);
        }
      } else {
        setAuthError('Invalid code.');
      }
    } catch (error) {
      console.error('Verify code failed:', error);
      setAuthError(error instanceof Error ? error.message : 'Could not verify the code. Try again.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const tagColor = (tag: CommonsPost['tag']) => {
    if (tag === 'Social') return { bg: '#F3F4F6', fg: '#374151' };
    if (tag === 'Meme') return { bg: SOCIAL_THEME.primarySoft, fg: '#C2410C' };
    if (tag === 'Win') return { bg: '#D1FAE5', fg: '#047857' };
    if (tag === 'Opportunity') return { bg: '#E0E7FF', fg: '#3730A3' };
    if (tag === 'Need') return { bg: '#DCFCE7', fg: '#166534' };
    if (tag === 'Vote') return { bg: SOCIAL_THEME.primarySoft, fg: '#C2410C' };
    if (tag === 'Resource') return { bg: '#FEE2E2', fg: '#B91C1C' };
    return { bg: '#E0F2FE', fg: '#075985' };
  };

  const isOrganizedPost = (post: CommonsPost) => post.tag !== 'Social' && post.tag !== 'Meme';

  const goToDrawerItem = (href: string | null) => {
    if (!href) {
      setDrawerOpen(false);
      return;
    }

    setDrawerOpen(false);
    router.push(href as any);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: SOCIAL_THEME.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="border-b border-gray-200 bg-white px-4 pt-14 pb-3">
          <View className="flex-row items-center gap-3">
            <TouchableOpacity
              onPress={() => setDrawerOpen(true)}
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={{ backgroundColor: SOCIAL_THEME.primary }}
              accessibilityLabel="Open menu"
            >
              <Menu size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-black uppercase text-gray-500">Commons</Text>
              <Text className="text-xl font-black text-gray-950">{feedTitle}</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/notifications' as any)}
              className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
              accessibilityLabel="Open notifications"
            >
              <Bell size={20} color={SOCIAL_THEME.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openSearch}
              className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200"
              style={{ backgroundColor: searchOpen ? SOCIAL_THEME.primarySoft : '#FFFFFF' }}
              accessibilityLabel="Search"
            >
              <Search size={20} color={searchOpen ? SOCIAL_THEME.primary : SOCIAL_THEME.ink} />
            </TouchableOpacity>
          </View>

          {searchOpen ? (
            <View className="mt-3 flex-row items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: SOCIAL_THEME.paper }}>
              <Search size={17} color={SOCIAL_THEME.muted} />
              <TextInput
                ref={searchInputRef}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={`Search ${feedShortName}`}
                placeholderTextColor={SOCIAL_THEME.muted}
                autoCapitalize="none"
                className="h-10 flex-1 text-base text-gray-900"
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')} className="px-2 py-1">
                  <Text className="text-sm font-bold" style={{ color: SOCIAL_THEME.primary }}>
                    Clear
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        <View className="px-4 py-3">
          {feedError ? (
            <View className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
              <Text className="text-sm font-semibold text-red-700">{feedError}</Text>
            </View>
          ) : null}

          {scopedFeedLocked ? (
            <View className="mb-3 rounded-xl border p-3" style={{ backgroundColor: SOCIAL_THEME.primarySoft, borderColor: SOCIAL_THEME.primaryBorder }}>
              <View className="flex-row items-start gap-2">
                <Lock size={18} color={SOCIAL_THEME.primary} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-black text-gray-950">This commons is locked</Text>
                  <Text className="mt-1 text-xs leading-4 text-gray-700">
                    Apply from the Wall to see member posts, comment, and publish here.
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {!scopedFeedLocked ? (
          <View className="rounded-xl border border-gray-200 bg-white p-3">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: SOCIAL_THEME.primarySoft }}>
                <Text className="font-black" style={{ color: SOCIAL_THEME.primary }}>
                  {accountName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <TextInput
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  if (composerNotice) setComposerNotice(null);
                }}
                placeholder={`What's happening in ${selectedComposerCommons?.shortName || selectedComposerCommons?.name || 'this commons'}?`}
                placeholderTextColor={SOCIAL_THEME.muted}
                multiline
                className="min-h-11 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                style={{ maxHeight: 112, textAlignVertical: 'top', backgroundColor: SOCIAL_THEME.paper }}
              />
            </View>
            <TouchableOpacity
              onPress={() => setComposerPickerOpen(true)}
              className="mt-3 flex-row items-center justify-between rounded-xl border border-gray-200 px-3 py-3"
              style={{ backgroundColor: SOCIAL_THEME.paper }}
              activeOpacity={0.75}
              accessibilityLabel="Choose commons to post in"
            >
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-black uppercase text-gray-500">Post in</Text>
                <Text className="mt-0.5 text-sm font-black text-gray-950" numberOfLines={1}>
                  {selectedComposerCommons?.name || 'Choose a commons'}
                </Text>
              </View>
              <ChevronDown size={18} color={SOCIAL_THEME.primary} />
            </TouchableOpacity>
            <View className="mt-3 flex-row items-center gap-2">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
                <View className="flex-row gap-2">
                  {visibleEmojiShortcuts.map((emoji) => (
                    <TouchableOpacity
                      key={emoji}
                      onPress={() => appendEmoji(emoji)}
                      className="h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white"
                      activeOpacity={0.75}
                      accessibilityLabel={`Add ${emoji}`}
                    >
                      <Text className="text-lg">{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => setEmojiExpanded((current) => !current)}
                    className="h-9 flex-row items-center gap-1 rounded-full border border-gray-200 bg-white px-3"
                    activeOpacity={0.75}
                  >
                    <SmilePlus size={15} color={SOCIAL_THEME.primary} />
                    <Text className="text-xs font-bold text-gray-700">{emojiExpanded ? 'Less' : 'More'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
            {composerNotice ? (
              <Text className="mt-2 text-xs font-semibold" style={{ color: composerNoticeColor() }}>
                {composerNotice.body}
              </Text>
            ) : null}
            <View className="mt-3">
              <TouchableOpacity
                onPress={postDraft}
                disabled={isPosting}
                className="h-11 flex-row items-center justify-center gap-2 rounded-xl"
                style={{ backgroundColor: draft.trim() ? SOCIAL_THEME.primary : '#FDBA74' }}
                activeOpacity={0.82}
              >
                {isPosting ? <ActivityIndicator size="small" color="white" /> : <Send size={16} color="white" />}
                <Text className="font-black text-white">{isPosting ? 'Posting...' : 'Post'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          ) : null}

          <View className="mt-3">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={() => setActiveFilter('Trending')}
                  className="w-40 rounded-xl border p-3"
                  style={{
                    backgroundColor: activeFilter === 'Trending' ? SOCIAL_THEME.primarySoft : '#FFFFFF',
                    borderColor: activeFilter === 'Trending' ? SOCIAL_THEME.primaryBorder : SOCIAL_THEME.border,
                  }}
                  activeOpacity={0.75}
                >
                  <Text className="text-sm font-black text-gray-950">Trending now</Text>
                  <Text className="mt-1 text-xs leading-4 text-gray-700">
                    {isScopedFeed ? 'Top conversations in this commons.' : 'Top conversations across your commons.'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setActiveFilter('Market')}
                  className="w-40 rounded-xl border border-gray-200 bg-white p-3"
                  style={{
                    backgroundColor: activeFilter === 'Market' ? SOCIAL_THEME.primarySoft : '#FFFFFF',
                    borderColor: activeFilter === 'Market' ? SOCIAL_THEME.primaryBorder : SOCIAL_THEME.border,
                  }}
                  activeOpacity={0.75}
                >
                  <View className="mb-1 flex-row items-center gap-1">
                    <Store size={14} color={SOCIAL_THEME.primary} />
                    <Text className="text-sm font-black text-gray-950">Market</Text>
                  </View>
                  <Text className="text-xs leading-4 text-gray-600">Member businesses and offers.</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>

          <View className="mt-3 border-b border-gray-200 pb-3">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {FEED_FILTERS.map((filter) => {
                  const selected = activeFilter === filter;
                  return (
                    <TouchableOpacity
                      key={filter}
                      onPress={() => handleFilterPress(filter)}
                      className="rounded-full border px-4 py-2"
                      style={{
                        backgroundColor: selected ? SOCIAL_THEME.primary : '#FFFFFF',
                        borderColor: selected ? SOCIAL_THEME.primary : SOCIAL_THEME.border,
                      }}
                    >
                      <Text className={`text-sm font-semibold ${selected ? 'text-white' : 'text-gray-700'}`}>
                        {filter}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View className="mt-4 gap-3">
            {visiblePosts.length === 0 ? (
              <View className="rounded-xl border border-dashed border-stone-300 bg-white p-5">
                <Text className="text-base font-black text-gray-900">No {activeFilter.toLowerCase()} yet</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  {searchQuery
                    ? 'Try another search or clear the search box.'
                    : 'Start with a normal post, question, shoutout, event, request, or offer.'}
                </Text>
              </View>
            ) : null}

            {visiblePosts.map((post) => {
              const colors = tagColor(post.tag);
              const selected = selectedPostId === post.id;
              const commentDraft = commentDrafts[post.id] || '';
              const isCommenting = commentingPostId === post.id;
              return (
                <TouchableOpacity
                  key={post.id}
                  onPress={() => setSelectedPostId(post.id)}
                  className="rounded-xl border bg-white p-3"
                  style={{ borderColor: selected ? SOCIAL_THEME.primary : SOCIAL_THEME.border }}
                  activeOpacity={0.75}
                >
                  <View className="flex-row gap-3">
                    <View className="w-9 items-center">
                      <TouchableOpacity
                        onPress={(event) => {
                          event.stopPropagation();
                          supportPost(post);
                        }}
                        className="h-8 w-8 items-center justify-center rounded-lg border"
                        style={{ backgroundColor: SOCIAL_THEME.primarySoft, borderColor: SOCIAL_THEME.primaryBorder }}
                      >
                        <Text className="text-lg font-black" style={{ color: SOCIAL_THEME.primary }}>
                          ⌃
                        </Text>
                      </TouchableOpacity>
                      <Text className="my-1 text-xs font-black" style={{ color: SOCIAL_THEME.primary }}>
                        {post.support}
                      </Text>
                      <View className="h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                        <Text className="text-lg font-black text-stone-400">⌄</Text>
                      </View>
                    </View>

                    <View className="min-w-0 flex-1">
                      <View className="mb-2 flex-row items-start justify-between gap-2">
                        <View className="min-w-0 flex-1">
                          <Text className="text-xs font-semibold text-stone-500">
                            {post.group} · {post.author} · {post.time}
                          </Text>
                        </View>
                        <View className="rounded-full px-3 py-1" style={{ backgroundColor: colors.bg }}>
                          <Text className="text-xs font-bold" style={{ color: colors.fg }}>
                            {post.tag}
                          </Text>
                        </View>
                      </View>

                      <Text className="text-lg font-black leading-6 text-gray-900">{post.title}</Text>
                      <Text className="mt-2 text-sm leading-5 text-gray-600">{post.body}</Text>

                      {isOrganizedPost(post) ? (
                        <View
                          className="mt-3 flex-row items-center gap-2 rounded-xl border px-3 py-2"
                          style={{ backgroundColor: SOCIAL_THEME.primarySoft, borderColor: SOCIAL_THEME.primaryBorder }}
                        >
                          <Sparkles size={14} color={SOCIAL_THEME.primary} />
                          <Text className="flex-1 text-xs font-semibold leading-4" style={{ color: '#9A3412' }}>
                            Auto-linked with related posts.
                          </Text>
                        </View>
                      ) : null}

                      <View className="mt-4 flex-row items-center justify-between border-t border-stone-100 pt-3">
                        <View className="flex-row gap-4">
                          <View className="flex-row items-center gap-1">
                            <MessageCircle size={15} color="#78716C" />
                            <Text className="text-xs font-semibold text-stone-600">{post.replies}</Text>
                          </View>
                          {post.pledges ? (
                            <View className="flex-row items-center gap-1">
                              <CheckCircle2 size={15} color="#15803D" />
                              <Text className="text-xs font-semibold text-stone-600">{post.pledges}</Text>
                            </View>
                          ) : null}
                          <TouchableOpacity
                            onPress={(event) => {
                              event.stopPropagation();
                              void sharePost(post);
                            }}
                            className="flex-row items-center gap-1"
                          >
                            <Share2 size={15} color="#78716C" />
                            <Text className="text-xs font-semibold text-stone-600">Share</Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          onPress={(event) => {
                            event.stopPropagation();
                            setSelectedPostId(post.id);
                            runAiAction(isOrganizedPost(post) ? 'Draft next step' : 'Summarize thread', post);
                          }}
                          className="h-8 w-8 items-center justify-center rounded-lg"
                          style={{ backgroundColor: SOCIAL_THEME.primarySoft }}
                        >
                          <Lightbulb size={15} color={SOCIAL_THEME.primary} />
                        </TouchableOpacity>
                      </View>

                      <View className="mt-3 gap-2 rounded-xl bg-stone-50 p-3">
                        {post.comments.map((comment) => (
                          <View key={comment.id || `${post.id}-${comment.author}`} className="flex-row gap-2">
                            <Text className="text-xs font-black text-stone-800">{comment.author}</Text>
                            <Text className="flex-1 text-xs leading-4 text-stone-600">{comment.body}</Text>
                          </View>
                        ))}

                        {isCommenting ? (
                          <View className="mt-1 flex-row items-end gap-2">
                            <TextInput
                              value={commentDraft}
                              onChangeText={(text) =>
                                setCommentDrafts((current) => ({ ...current, [post.id]: text }))
                              }
                              placeholder="Write a comment..."
                              placeholderTextColor={SOCIAL_THEME.muted}
                              multiline
                              className="min-h-10 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-gray-900"
                              style={{ maxHeight: 86, textAlignVertical: 'top' }}
                            />
                            <TouchableOpacity
                              onPress={() => submitComment(post)}
                              className="h-10 w-10 items-center justify-center rounded-xl"
                              style={{ backgroundColor: SOCIAL_THEME.primary }}
                            >
                              <Send size={15} color="white" />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View className="mt-1 flex-row gap-2">
                            <TouchableOpacity
                              onPress={() => setCommentingPostId(post.id)}
                              className="flex-1 rounded-xl bg-white px-3 py-2"
                            >
                              <Text className="text-xs font-bold text-stone-700">Reply</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={openMessages}
                              className="rounded-xl border border-stone-200 bg-white px-3 py-2"
                            >
                              <Text className="text-xs font-bold text-stone-700">Message</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={shareConversationInvite}
            className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-4"
            activeOpacity={0.75}
          >
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-stone-100">
                <Plus size={20} color="#57534E" />
              </View>
              <View className="flex-1">
                <Text className="font-bold text-gray-900">Invite someone into Cahootz</Text>
                <Text className="mt-1 text-sm text-gray-600">Share the commons before asking them to make an account.</Text>
              </View>
              <Share2 size={18} color="#78716C" />
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={composerPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setComposerPickerOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/35">
          <View className="max-h-[70%] rounded-t-2xl bg-white">
            <View className="border-b border-gray-200 px-5 pb-4 pt-5">
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-black uppercase text-gray-500">Post destination</Text>
                  <Text className="text-2xl font-black text-gray-950">Choose a commons</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setComposerPickerOpen(false)}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-gray-100"
                  accessibilityLabel="Close commons picker"
                >
                  <X size={20} color={SOCIAL_THEME.ink} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 26 }}>
              <View className="gap-2">
                {postableCommons.map((commons) => {
                  const selected = commons.id === selectedComposerCoopId;
                  return (
                    <TouchableOpacity
                      key={commons.id}
                      onPress={() => {
                        setSelectedComposerCoopId(commons.id);
                        setComposerPickerOpen(false);
                        setComposerNotice(null);
                      }}
                      className="flex-row items-center gap-3 rounded-xl border p-3"
                      style={{
                        backgroundColor: selected ? SOCIAL_THEME.primarySoft : '#FFFFFF',
                        borderColor: selected ? SOCIAL_THEME.primary : SOCIAL_THEME.border,
                      }}
                      activeOpacity={0.75}
                    >
                      <View
                        className="h-11 w-11 items-center justify-center rounded-xl"
                        style={{ backgroundColor: selected ? SOCIAL_THEME.primary : '#111827' }}
                      >
                        <Text className="font-black text-white">{commons.name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-black text-gray-950" numberOfLines={1}>
                          {commons.name}
                        </Text>
                        <Text className="mt-0.5 text-xs leading-4 text-gray-500" numberOfLines={2}>
                          {commons.description || 'Member commons'}
                        </Text>
                      </View>
                      {selected ? <CheckCircle2 size={19} color={SOCIAL_THEME.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
        <View className="flex-1 flex-row bg-black/35">
          <View className="w-4/5 bg-white pt-14">
            <View className="border-b border-stone-200 px-5 pb-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: SOCIAL_THEME.primary }}>
                    <Text className="font-black text-white">C</Text>
                  </View>
                  <View>
                    <Text className="text-lg font-black text-gray-900">Cahootz</Text>
                    <Text className="text-xs font-semibold text-gray-500">Feeds, alerts, wallet, spaces</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setDrawerOpen(false)}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-stone-100"
                  accessibilityLabel="Close menu"
                >
                  <X size={20} color="#44403C" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
              <Text className="mb-2 text-xs font-black uppercase tracking-wide text-stone-400">Commons</Text>
              <View className="mb-5 overflow-hidden rounded-2xl border border-stone-200 bg-white">
                {commonsDrawerItems.map((item) => (
                  item.id === 'discover-commons' ? (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => goToDrawerItem('/commons')}
                      className="flex-row items-center gap-3 border-b border-stone-100 px-4 py-4"
                    >
                      <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: SOCIAL_THEME.primarySoft }}>
                        <Text className="font-black" style={{ color: SOCIAL_THEME.primary }}>{item.icon}</Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-black text-gray-900">{item.label}</Text>
                        <Text className="text-xs font-semibold text-gray-500">{item.description}</Text>
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <View key={item.id} className="border-b border-stone-100 px-4 py-4">
                      <View className="flex-row items-center gap-3">
                        <View className="h-10 w-10 items-center justify-center rounded-xl bg-stone-900">
                          <Text className="font-black text-white">{item.icon}</Text>
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="font-black text-gray-900">{item.label}</Text>
                          <Text className="text-xs font-semibold text-gray-500">{item.description}</Text>
                        </View>
                      </View>
                      <View className="mt-3 flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => goToDrawerItem(`/${item.id}/posts`)}
                          className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-xl"
                          style={{ backgroundColor: SOCIAL_THEME.primary }}
                          activeOpacity={0.82}
                        >
                          <MessageCircle size={15} color="#FFFFFF" />
                          <Text className="text-xs font-black text-white">Posts</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => goToDrawerItem(`/commons/${item.id}`)}
                          className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white"
                          activeOpacity={0.75}
                        >
                          <BookOpen size={15} color={SOCIAL_THEME.primary} />
                          <Text className="text-xs font-black text-gray-800">Wall</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                ))}
                <TouchableOpacity
                  onPress={openSuggestCommons}
                  className="flex-row items-center gap-3 border-t border-stone-100 px-4 py-4"
                  activeOpacity={0.75}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: SOCIAL_THEME.primarySoft }}>
                    <Plus size={20} color={SOCIAL_THEME.primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="font-black text-gray-900">Suggest a commons</Text>
                    <Text className="text-xs font-semibold text-gray-500">Tell us what group should open next</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <Text className="mb-2 text-xs font-black uppercase tracking-wide text-stone-400">Spaces</Text>
              <View className="mb-5 overflow-hidden rounded-2xl border border-stone-200 bg-white">
                {DRAWER_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TouchableOpacity
                      key={item.label}
                      onPress={() => goToDrawerItem(item.action)}
                      className="flex-row items-center gap-3 border-b border-stone-100 px-4 py-4"
                    >
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-stone-100">
                        <Icon size={20} color={SOCIAL_THEME.primary} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-black text-gray-900">{item.label}</Text>
                        <Text className="text-xs font-semibold text-gray-500">{item.description}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text className="mb-2 text-xs font-black uppercase tracking-wide text-stone-400">Account</Text>
              <View className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                <TouchableOpacity
                  onPress={() => goToDrawerItem('/(tabs)/wallet')}
                  className="flex-row items-center gap-3 border-b border-stone-100 px-4 py-4"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-stone-100">
                    <Wallet size={20} color={SOCIAL_THEME.primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="font-black text-gray-900">Wallet</Text>
                    <Text className="text-xs font-semibold text-gray-500">Rewards, cards, payments</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setDrawerOpen(false);
                    if (hasAccountSession) {
                      router.push('/(authenticated)/profile' as any);
                    } else {
                      onSignInPress?.();
                    }
                  }}
                  className="flex-row items-center gap-3 border-b border-stone-100 px-4 py-4"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-stone-100">
                    <Settings size={20} color="#57534E" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="font-black text-gray-900">Settings</Text>
                    <Text className="text-xs font-semibold text-gray-500">Profile and preferences</Text>
                  </View>
                </TouchableOpacity>
                {hasAccountSession ? (
                  <TouchableOpacity onPress={() => void logout()} className="flex-row items-center gap-3 px-4 py-4">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-red-50">
                      <LogOut size={20} color="#DC2626" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="font-black text-gray-900">Sign out</Text>
                      <Text className="text-xs font-semibold text-gray-500">Signed in as {accountName}</Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={onSignInPress} className="flex-row items-center gap-3 px-4 py-4">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                      <UserCircle size={20} color="#047857" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="font-black text-gray-900">Sign in</Text>
                      <Text className="text-xs font-semibold text-gray-500">Post, comment, message, and save</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </View>
          <TouchableOpacity className="flex-1" onPress={() => setDrawerOpen(false)} activeOpacity={1} />
        </View>
      </Modal>

      <Modal
        visible={suggestCommonsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSuggestCommonsOpen(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/35"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View className="max-h-[88%] rounded-t-2xl bg-white">
            <View className="border-b border-gray-200 px-5 pt-5 pb-4">
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-black uppercase text-gray-500">Commons</Text>
                  <Text className="text-2xl font-black text-gray-950">Suggest a commons</Text>
                  <Text className="mt-1 text-sm leading-5 text-gray-600">
                    Tell Cahootz what community, neighborhood, identity, craft, or market should have a space next.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSuggestCommonsOpen(false)}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-gray-100"
                  accessibilityLabel="Close suggest commons"
                >
                  <X size={20} color={SOCIAL_THEME.ink} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
              <View className="rounded-xl border border-gray-200 bg-white p-4">
                <Text className="font-black text-gray-950">How commons work</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  Everyone starts in {commonsProfile.name}. Later, people can join more focused commons that match who they are, where
                  they live, what they build, or what they want to organize economically.
                </Text>
              </View>

              <View className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
                <Text className="font-black text-gray-950">Basic rules</Text>
                <View className="mt-3 gap-2">
                  {COMMONS_RULES.map((rule, index) => (
                    <View key={rule} className="flex-row gap-2">
                      <View
                        className="mt-0.5 h-5 w-5 items-center justify-center rounded-full"
                        style={{ backgroundColor: SOCIAL_THEME.primarySoft }}
                      >
                        <Text className="text-xs font-black" style={{ color: SOCIAL_THEME.primary }}>
                          {index + 1}
                        </Text>
                      </View>
                      <Text className="flex-1 text-sm leading-5 text-gray-600">{rule}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View className="mt-4 gap-3">
                <TextInput
                  value={suggestedCommonsName}
                  onChangeText={(text) => {
                    setSuggestedCommonsName(text);
                    setSuggestionMessage('');
                    setSuggestionStatus('idle');
                  }}
                  placeholder="Commons name, like Artists, South LA, Black founders..."
                  placeholderTextColor={SOCIAL_THEME.muted}
                  className="h-12 rounded-xl border border-gray-200 px-4 text-base text-gray-900"
                  style={{ backgroundColor: SOCIAL_THEME.paper }}
                />
                <TextInput
                  value={suggestedCommonsReason}
                  onChangeText={(text) => {
                    setSuggestedCommonsReason(text);
                    setSuggestionMessage('');
                    setSuggestionStatus('idle');
                  }}
                  placeholder="Why should this commons exist?"
                  placeholderTextColor={SOCIAL_THEME.muted}
                  multiline
                  className="min-h-24 rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                  style={{ backgroundColor: SOCIAL_THEME.paper, textAlignVertical: 'top' }}
                />
                {!user?.email ? (
                  <TextInput
                    value={suggestedCommonsEmail}
                    onChangeText={(text) => {
                      setSuggestedCommonsEmail(text);
                      setSuggestionMessage('');
                      setSuggestionStatus('idle');
                    }}
                    placeholder="Email for follow-up"
                    placeholderTextColor={SOCIAL_THEME.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    className="h-12 rounded-xl border border-gray-200 px-4 text-base text-gray-900"
                    style={{ backgroundColor: SOCIAL_THEME.paper }}
                  />
                ) : null}
              </View>

              {suggestionMessage ? (
                <Text
                  className="mt-3 text-sm font-semibold"
                  style={{ color: suggestionStatus === 'error' ? '#DC2626' : '#047857' }}
                >
                  {suggestionMessage}
                </Text>
              ) : null}

              <View className="mt-4 flex-row gap-2">
                <TouchableOpacity
                  onPress={() => setSuggestCommonsOpen(false)}
                  className="h-12 flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white"
                  activeOpacity={0.75}
                >
                  <Text className="font-bold text-gray-700">Not now</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={submitCommonsSuggestion}
                  disabled={suggestionStatus === 'submitting'}
                  className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl"
                  style={{ backgroundColor: SOCIAL_THEME.primary }}
                  activeOpacity={0.82}
                >
                  {suggestionStatus === 'submitting' ? <ActivityIndicator size="small" color="white" /> : null}
                  <Text className="font-black text-white">
                    {suggestionStatus === 'submitting' ? 'Sending...' : 'Suggest'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={accountPromptOpen} transparent animationType="slide" onRequestClose={() => setAccountPromptOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/35"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View className="rounded-t-2xl bg-white p-5">
            <View className="mb-4 flex-row items-start gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: SOCIAL_THEME.primarySoft }}>
                <Users size={21} color={SOCIAL_THEME.primary} />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-black text-gray-900">Create your Commons account</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  Keep browsing without one. To post, comment, or message, verify your email first.
                </Text>
              </View>
            </View>

            <View className="gap-3">
              <TextInput
                value={accountEmail}
                onChangeText={(text) => {
                  setAccountEmail(text);
                  setAuthError('');
                }}
                placeholder="Email address"
                placeholderTextColor={SOCIAL_THEME.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                className="h-12 rounded-xl border border-stone-200 bg-stone-50 px-4 text-base text-gray-900"
              />
              {codeSent ? (
                <TextInput
                  value={accountCode}
                  onChangeText={(text) => {
                    setAccountCode(text);
                    setAuthError('');
                  }}
                  placeholder="6 digit code"
                  placeholderTextColor={SOCIAL_THEME.muted}
                  keyboardType="number-pad"
                  className="h-12 rounded-xl border border-stone-200 bg-stone-50 px-4 text-base text-gray-900"
                />
              ) : null}
            </View>

            {authError ? <Text className="mt-3 text-sm font-semibold text-red-600">{authError}</Text> : null}

            <View className="mt-4 flex-row gap-2">
              <Button
                variant="outline"
                onPress={() => setAccountPromptOpen(false)}
                className="h-12 flex-1 rounded-xl border-stone-200"
              >
                <Text className="font-semibold text-stone-700">Not now</Text>
              </Button>
              <Button
                onPress={codeSent ? verifyCode : requestCode}
                disabled={isAuthBusy}
                className="h-12 flex-1 rounded-xl"
                style={{ backgroundColor: SOCIAL_THEME.primary }}
              >
                {isAuthBusy ? <ActivityIndicator size="small" color="white" /> : null}
                <Text className="font-black text-white">{codeSent ? 'Verify' : 'Send code'}</Text>
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

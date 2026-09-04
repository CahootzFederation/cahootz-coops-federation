// Hallmark - pre-emit critique: P4 H4 E4 S4 R4 V4
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Scale,
  Send,
  Sparkles,
  Store,
  Trash2,
  UserCircle,
  Users,
  Wallet,
  X,
} from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { api, type CommonsDirectoryItem, type CommonsPost, type CommonsPostMedia, type CommonsProfile } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import {
  COMPOSER_MEDIA_TILE_SIZE,
  FEED_MEDIA_TILE_SIZE,
  CommonsMediaTile,
} from '@/components/commons-media-viewer';

type PendingAction = (sessionToken: string) => Promise<void>;
type ComposerNotice = { type: 'success' | 'error' | 'info'; body: string } | null;
type SuggestionStatus = 'idle' | 'submitting' | 'success' | 'error';
type ComposerMedia = Omit<CommonsPostMedia, 'pathname' | 'url' | 'id'> & { uri: string };

type CommonsAiEntryProps = {
  feedCoopId?: string;
  onMessagesPress?: () => void;
  onSignInPress?: () => void;
  topBanner?: ReactNode;
};

const SOCIAL_THEME = {
  paper: '#F6F7F8',
  primary: '#FF6B00',
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

const MAX_MEDIA_ATTACHMENTS = 4;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_POST_MEDIA_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const COMMONS_RULES = [
  'A commons is a social space for a real group, place, identity, craft, or shared economic interest.',
  'Members can talk normally, share wins, post needs, support businesses, and turn useful threads into action.',
  'Every commons should create value for its members. No scams, harassment, hate, extraction, or charity-only spaces.',
] as const;

const DRAWER_SECTIONS = [
  { label: 'Wallet', icon: Wallet, action: '/(tabs)/wallet' },
  { label: 'Commons Stores & Shops', icon: Store, action: '/(tabs)/store' },
  { label: 'Proposals & Governance', icon: Scale, action: '/(tabs)/proposals' },
  { label: 'Messages & Direct Chat', icon: MessageCircle, action: '/(tabs)/messages' },
];

function mimeFromFileName(fileName: string | null | undefined, mediaType: 'image' | 'video') {
  const lower = fileName?.toLowerCase() || '';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
}

export default function CommonsAiEntry({ feedCoopId = 'all', onMessagesPress, onSignInPress, topBanner }: CommonsAiEntryProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const { isAuthenticated, login, logout, sessionToken, user } = useAuth();
  const [draft, setDraft] = useState('');
  const [feedPosts, setFeedPosts] = useState<CommonsPost[]>([]);
  const [commonsProfile, setCommonsProfile] = useState<CommonsProfile>(DEFAULT_COMMONS_PROFILE);
  const [memberCommons, setMemberCommons] = useState<CommonsDirectoryItem[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composerPickerOpen, setComposerPickerOpen] = useState(false);
  const [selectedComposerCoopId, setSelectedComposerCoopId] = useState(feedCoopId === 'all' ? 'cahootz' : feedCoopId);
  const [feedError, setFeedError] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [selectedMediaItems, setSelectedMediaItems] = useState<ComposerMedia[]>([]);
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
  const hasAccountSession = isAuthenticated && !!sessionToken;
  const accountName = user?.name?.trim() || user?.email?.split('@')[0] || 'member';
  const accountHandle = (user?.email?.split('@')[0] || accountName).toLowerCase().replace(/[^a-z0-9]/g, '');
  const isScopedFeed = feedCoopId !== 'all';
  const headerCommonsName = isScopedFeed ? commonsProfile.name : 'Commons';
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

      return activeCommonsForDrawer.map((commons) => ({
        id: commons.id,
        label: commons.name,
        description: commons.description,
        icon: commons.name.slice(0, 1).toUpperCase(),
        accessStatus: commons.accessStatus,
      }));
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

  const visiblePosts = useMemo(() => {
    return [...feedPosts].sort((a, b) => b.support - a.support || b.replies - a.replies);
  }, [feedPosts]);

  const requireAccount = async (action: PendingAction) => {
    if (hasAccountSession) {
      await action(sessionToken);
      return;
    }

    pendingActionRef.current = action;
    setAuthError('');
    setAccountPromptOpen(true);
  };

  const postDraft = () => {
    const trimmed = draft.trim();
    if (isPosting || isUploadingMedia) return;
    if (!trimmed && selectedMediaItems.length === 0) {
      setComposerNotice({ type: 'error', body: 'Write something or add a photo/video first.' });
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
        const uploadedMedia = selectedMediaItems.length
          ? await (async () => {
              setIsUploadingMedia(true);
              setComposerNotice({ type: 'info', body: `Uploading ${selectedMediaItems.length} attachment${selectedMediaItems.length === 1 ? '' : 's'}...` });
              return Promise.all(
                selectedMediaItems.map((media) =>
                  api.uploadCommonsPostMedia({
                    coopId: selectedComposerCommons.id,
                    uri: media.uri,
                    fileName: media.fileName,
                    mimeType: media.mimeType,
                    mediaType: media.mediaType,
                    width: media.width,
                    height: media.height,
                    durationMs: media.durationMs,
                    sizeBytes: media.sizeBytes,
                  })
                )
              );
            })()
          : [];
        const result = await api.createCommonsPost({
          content: trimmed,
          coopId: selectedComposerCommons.id,
          media: uploadedMedia,
        }, token);
        const belongsInCurrentFeed = feedCoopId === 'all' || result.post.coopId === feedCoopId;
        if (belongsInCurrentFeed) {
          setFeedPosts((current) => [result.post, ...current]);
        }
        setDraft('');
        clearSelectedMedia();
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
        setIsUploadingMedia(false);
        setIsPosting(false);
      }
    });
  };

  const pickPostMedia = async () => {
    try {
      const remainingSlots = MAX_MEDIA_ATTACHMENTS - selectedMediaItems.length;
      if (remainingSlots <= 0) {
        setComposerNotice({ type: 'error', body: `You can attach up to ${MAX_MEDIA_ATTACHMENTS} media items.` });
        return;
      }

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setComposerNotice({ type: 'error', body: 'Allow photo library access to attach media.' });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        quality: 0.85,
        videoMaxDuration: 120,
      });

      if (result.canceled || !result.assets[0]) return;

      const acceptedMedia: ComposerMedia[] = [];
      for (const asset of result.assets.slice(0, remainingSlots)) {
        const resolvedMediaType = asset.type === 'video' ? 'video' : 'image';
        const media: ComposerMedia = {
          uri: asset.uri,
          mediaType: resolvedMediaType,
          mimeType: asset.mimeType || mimeFromFileName(asset.fileName, resolvedMediaType),
          fileName: asset.fileName || null,
          width: asset.width || null,
          height: asset.height || null,
          durationMs: asset.duration || null,
          sizeBytes: asset.fileSize || null,
        };
        const validationError = validateComposerMedia(media);

        if (validationError) {
          setComposerNotice({ type: 'error', body: validationError });
          continue;
        }

        acceptedMedia.push(media);
      }

      if (acceptedMedia.length === 0) {
        return;
      }

      addComposerMedia(acceptedMedia);
    } catch (error) {
      console.error('Failed to pick post media:', error);
      setComposerNotice({ type: 'error', body: 'Could not attach that media.' });
    }
  };

  const composerNoticeColor = () => {
    if (!composerNotice) return SOCIAL_THEME.muted;
    if (composerNotice.type === 'error') return '#DC2626';
    if (composerNotice.type === 'success') return '#047857';
    return SOCIAL_THEME.muted;
  };

  const revokeComposerMediaUri = (media: ComposerMedia) => {
    if (Platform.OS === 'web' && media.uri.startsWith('blob:') && typeof URL !== 'undefined') {
      URL.revokeObjectURL(media.uri);
    }
  };

  const removeSelectedMedia = (index: number) => {
    setSelectedMediaItems((current) => {
      const media = current[index];
      if (media) revokeComposerMediaUri(media);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const clearSelectedMedia = () => {
    selectedMediaItems.forEach(revokeComposerMediaUri);
    setSelectedMediaItems([]);
  };

  const addComposerMedia = (mediaItems: ComposerMedia[]) => {
    if (mediaItems.length === 0) return;

    setSelectedMediaItems((current) => {
      const remainingSlots = MAX_MEDIA_ATTACHMENTS - current.length;
      const accepted = mediaItems.slice(0, remainingSlots);
      const rejected = mediaItems.slice(remainingSlots);
      rejected.forEach(revokeComposerMediaUri);

      if (rejected.length > 0) {
        setComposerNotice({ type: 'error', body: `You can attach up to ${MAX_MEDIA_ATTACHMENTS} media items.` });
      } else {
        setComposerNotice(null);
      }

      return [...current, ...accepted];
    });
  };

  const validateComposerMedia = (media: ComposerMedia) => {
    if (!ALLOWED_POST_MEDIA_MIMES.has(media.mimeType)) {
      return 'Use JPG, PNG, WebP, MP4, MOV, or WebM files.';
    }

    const maxSize = media.mediaType === 'video' ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
    if (media.sizeBytes && media.sizeBytes > maxSize) {
      const maxMb = Math.round(maxSize / 1024 / 1024);
      return `${media.mediaType === 'video' ? 'Video' : 'Image'} must be under ${maxMb}MB.`;
    }

    return null;
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

  const openPostDetail = (post: CommonsPost) => {
    router.push({
      pathname: '/[coopId]/posts/[postId]',
      params: {
        coopId: post.coopId || feedCoopId || 'cahootz',
        postId: post.id,
      },
    } as any);
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

  const goToDrawerItem = (href: string | null) => {
    if (!href) {
      setDrawerOpen(false);
      return;
    }

    setDrawerOpen(false);
    router.push(href as any);
  };

  const openMessages = () => {
    if (onMessagesPress) {
      onMessagesPress();
      return;
    }

    router.push('/(tabs)/messages' as any);
  };

  const finishProfileBanner = topBanner ?? (
    hasAccountSession && !user?.profileOnboardingCompletedAt ? (
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => router.push('/profile-onboarding' as any)}
        className="mb-5 overflow-hidden rounded-[28px]"
        style={{ backgroundColor: SOCIAL_THEME.primary }}
        activeOpacity={0.86}
      >
        <View className="flex-row items-center gap-3 px-4 py-4">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-white/20">
            <Sparkles color="#FFFFFF" size={18} strokeWidth={2.8} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-black leading-5 text-white">Finish your profile setup</Text>
            <Text className="mt-0.5 text-xs leading-4 text-white">
              Unlock AI matchmaking & commons voting power
            </Text>
          </View>
          <View className="rounded-full bg-white px-3.5 py-2">
            <Text className="text-xs font-black" style={{ color: SOCIAL_THEME.primary }}>
              Complete
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    ) : null
  );

  const renderComposer = () => {
    if (scopedFeedLocked) return null;

    return (
      <View className="border-t border-gray-200 bg-white px-4 pb-3 pt-3">
        {selectedMediaItems.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            <View className="flex-row gap-2">
              {selectedMediaItems.map((media, index) => (
                <View
                  key={`${media.uri}-${index}`}
                  className="overflow-hidden rounded-xl border border-gray-100 bg-white"
                  style={{ width: COMPOSER_MEDIA_TILE_SIZE, height: COMPOSER_MEDIA_TILE_SIZE }}
                >
                  <CommonsMediaTile media={media} size={COMPOSER_MEDIA_TILE_SIZE} />
                  {media.mediaType === 'video' ? (
                    <View className="absolute bottom-1 left-1 rounded-md bg-black/65 px-1.5 py-0.5">
                      <Text className="text-[10px] font-black text-white">Video</Text>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => removeSelectedMedia(index)}
                    className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-white/95"
                    accessibilityLabel="Remove attached media"
                  >
                    <Trash2 size={13} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}

        {composerNotice ? (
          <Text className="mb-2 text-xs font-semibold" style={{ color: composerNoticeColor() }}>
            {composerNotice.body}
          </Text>
        ) : null}

        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => setComposerPickerOpen(true)}
            className="h-10 w-10 items-center justify-center rounded-full bg-slate-400"
            activeOpacity={0.8}
            accessibilityLabel={`Posting to ${selectedComposerCommons?.shortName || selectedComposerCommons?.name || 'Commons'}. Tap to switch.`}
          >
            <Text className="text-base font-black text-white">
              {accountName.slice(0, 1).toUpperCase()}
            </Text>
          </TouchableOpacity>
          <View className="min-w-0 flex-1 flex-row items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
            <TextInput
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                if (composerNotice) setComposerNotice(null);
              }}
              placeholder="Share what's happening..."
              placeholderTextColor={SOCIAL_THEME.muted}
              multiline
              className="max-h-20 min-h-8 flex-1 text-left text-sm text-gray-900"
              style={{ textAlignVertical: 'top' }}
            />
            <TouchableOpacity
              onPress={() => void pickPostMedia()}
              className="h-8 w-8 items-center justify-center rounded-full bg-gray-100"
              activeOpacity={0.75}
              accessibilityLabel="Attach photo or video"
            >
              <ImageIcon size={16} color="#475569" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={postDraft}
              disabled={isPosting || isUploadingMedia}
              className="h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: SOCIAL_THEME.primary }}
              activeOpacity={0.82}
              accessibilityLabel="Post"
            >
              {isPosting || isUploadingMedia ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Send size={16} color="#FFFFFF" fill="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
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
        contentContainerStyle={{ paddingBottom: scopedFeedLocked ? 28 : 148 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="border-b border-gray-200 bg-white px-3 pb-2" style={{ paddingTop: insets.top + 12 }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => setDrawerOpen(true)}
              className="h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Open menu"
            >
              <Menu size={18} color="#1F2937" strokeWidth={2.6} />
            </TouchableOpacity>
            <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: SOCIAL_THEME.primary }}>
              <LayoutGrid size={17} color="#FFFFFF" strokeWidth={2.6} />
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text className="min-w-0 text-base font-black text-gray-950" numberOfLines={1}>
                  {headerCommonsName}
                </Text>
                <View className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5">
                  <Text className="text-[10px] font-black text-emerald-600">Member</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setDrawerOpen(true)}
                className="mt-0.5 flex-row items-center"
                activeOpacity={0.75}
                accessibilityLabel="Switch commons"
              >
                <Text className="text-xs font-semibold text-slate-600">Switch commons</Text>
                <ChevronDown size={13} color="#475569" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={openMessages}
              className="relative h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Open direct messages"
            >
              <MessageCircle size={16} color="#334155" />
              <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ backgroundColor: SOCIAL_THEME.primary }} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/notifications' as any)}
              className="relative h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Open alerts"
            >
              <Bell size={16} color="#334155" />
              <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ backgroundColor: SOCIAL_THEME.primary }} />
            </TouchableOpacity>
          </View>
        </View>

        <View className="px-4 py-3">
          {finishProfileBanner}

          {feedError ? (
            <View className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
              <Text className="text-sm font-semibold text-red-700">{feedError}</Text>
            </View>
          ) : null}

          {scopedFeedLocked ? (
            <View className="mb-4 rounded-2xl border p-4" style={{ backgroundColor: SOCIAL_THEME.primarySoft, borderColor: SOCIAL_THEME.primaryBorder }}>
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

          <View className="gap-5">
            {visiblePosts.length === 0 ? (
              <View className="rounded-[28px] border border-dashed border-gray-300 bg-white p-5">
                <Text className="text-base font-black text-gray-900">No posts yet</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  Start with a normal post, question, shoutout, event, request, or offer.
                </Text>
              </View>
            ) : null}

            {visiblePosts.map((post) => {
              const colors = tagColor(post.tag);
              const authorHandle = `@${post.author.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'member'}`;
              const firstComment = post.comments[0];
              return (
                <TouchableOpacity
                  key={post.id}
                  onPress={() => openPostDetail(post)}
                  className="overflow-hidden rounded-[28px] border bg-white"
                  style={{ borderColor: SOCIAL_THEME.border }}
                  activeOpacity={0.75}
                >
                  <View className="p-4">
                    <View className="flex-row items-start gap-2.5">
                      <View className="h-11 w-11 items-center justify-center rounded-full bg-slate-200">
                        <Text className="text-base font-black text-slate-600">
                          {post.author.slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <View className="flex-row flex-wrap items-center gap-1.5">
                          <Text className="text-sm font-black text-gray-950">{post.author}</Text>
                          <Text className="text-xs font-semibold text-slate-500">{authorHandle}</Text>
                          <Text className="text-xs font-semibold text-slate-400">·</Text>
                          <Text className="text-xs font-semibold text-slate-500">{post.time}</Text>
                        </View>
                        <View className="mt-1.5 self-start rounded-md px-2 py-0.5" style={{ backgroundColor: colors.bg }}>
                          <Text className="text-[10px] font-black" style={{ color: colors.fg }}>
                            {post.group || post.tag}
                          </Text>
                        </View>
                      </View>
                      <MoreHorizontal size={18} color="#475569" />
                    </View>

                    {post.title && post.title !== post.body ? (
                      <Text className="mt-3 text-sm font-black leading-5 text-gray-950">{post.title}</Text>
                    ) : null}
                    {post.body ? (
                      <Text className="mt-3 text-sm leading-5 text-gray-800">{post.body}</Text>
                    ) : null}
                  </View>

                  {post.media.length > 0 ? (
                    <View className="border-y border-gray-100 bg-gray-50">
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View className="flex-row gap-2 p-2">
                          {post.media.map((media) => (
                            <View key={media.id || media.url} className="overflow-hidden rounded-2xl bg-gray-200">
                              <CommonsMediaTile media={media} size={post.media.length === 1 ? 286 : FEED_MEDIA_TILE_SIZE} />
                              {post.pledges ? (
                                <View className="absolute bottom-3 right-3 flex-row items-center gap-1 rounded-full bg-slate-900/85 px-3 py-2">
                                  <Bookmark size={15} color="#FFFFFF" />
                                  <Text className="text-sm font-black text-white">{post.pledges}</Text>
                                </View>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  ) : null}

                  <View className="p-4 pt-3">
                    <View className="flex-row items-center justify-between gap-2">
                      <TouchableOpacity
                        onPress={(event) => {
                          event.stopPropagation();
                          supportPost(post);
                        }}
                        className="flex-row items-center gap-1.5"
                      >
                        <Heart size={19} color={SOCIAL_THEME.primary} fill={SOCIAL_THEME.primary} />
                        <Text className="text-sm font-black text-slate-800">{post.support}</Text>
                      </TouchableOpacity>
                      <View className="flex-row items-center gap-1.5">
                        <MessageCircle size={19} color="#334155" />
                        <Text className="text-sm font-semibold text-slate-700">{post.replies}</Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Repeat2 size={18} color="#334155" />
                        <Text className="text-sm font-semibold text-slate-700">{Math.max(0, Math.round(post.replies / 2))}</Text>
                      </View>
                      <Bookmark size={19} color="#334155" />
                    </View>

                    {firstComment ? (
                      <View className="mt-3 rounded-full bg-gray-50 px-3 py-2">
                        <Text className="text-xs text-slate-700" numberOfLines={2}>
                          <Text className="font-black text-gray-950">@{firstComment.author.toLowerCase().replace(/[^a-z0-9]+/g, '')}: </Text>
                          {firstComment.body}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {renderComposer()}

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
            <View className="border-b border-stone-200 px-4 pb-3">
              <View className="flex-row items-center justify-between">
                <TouchableOpacity
                  onPress={() => {
                    setDrawerOpen(false);
                    if (hasAccountSession) {
                      router.push('/(tabs)/wallet' as any);
                    } else {
                      onSignInPress?.();
                    }
                  }}
                  className="min-w-0 flex-1 flex-row items-center gap-2.5"
                  activeOpacity={0.75}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-slate-400">
                    <Text className="text-sm font-black text-white">{accountName.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-black text-gray-900" numberOfLines={1}>
                      {hasAccountSession ? accountName : 'Sign in'}
                    </Text>
                    <Text className="text-xs font-semibold text-gray-500" numberOfLines={1}>
                      {hasAccountSession ? `@${accountHandle} · Member` : 'Tap to sign in'}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDrawerOpen(false)}
                  className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100"
                  accessibilityLabel="Close menu"
                >
                  <X size={16} color="#44403C" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-[11px] font-black uppercase tracking-wide text-stone-400">Switch commons</Text>
                <TouchableOpacity onPress={() => goToDrawerItem('/commons')} activeOpacity={0.75}>
                  <Text className="text-[11px] font-black" style={{ color: SOCIAL_THEME.primary }}>Active Co-ops</Text>
                </TouchableOpacity>
              </View>
              <View className="mb-3 overflow-hidden rounded-2xl border border-stone-200 bg-white">
                {commonsDrawerItems.map((item) => {
                  const isActive = item.id === commonsProfile.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => goToDrawerItem(`/${item.id}/posts`)}
                      className="flex-row items-center gap-2.5 border-b border-stone-100 px-3 py-3"
                      style={isActive ? { backgroundColor: SOCIAL_THEME.primarySoft } : undefined}
                      activeOpacity={0.75}
                    >
                      <View
                        className="h-9 w-9 items-center justify-center rounded-xl"
                        style={{ backgroundColor: isActive ? SOCIAL_THEME.primary : '#F5F5F4' }}
                      >
                        <Text className="text-sm font-black" style={{ color: isActive ? '#FFFFFF' : '#57534E' }}>{item.icon}</Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-black text-gray-900" numberOfLines={1}>{item.label}</Text>
                        <Text
                          className="text-xs font-semibold"
                          style={{ color: item.accessStatus === 'ACTIVE' ? '#059669' : '#6B7280' }}
                        >
                          {item.accessStatus === 'ACTIVE' ? (isActive ? 'Active Member' : 'Member') : 'Pending'}
                        </Text>
                      </View>
                      {isActive ? (
                        <CheckCircle2 size={17} color={SOCIAL_THEME.primary} />
                      ) : (
                        <ChevronRight size={15} color="#A8A29E" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                onPress={() => goToDrawerItem('/commons')}
                className="flex-row items-center justify-center gap-1.5 py-1.5"
                activeOpacity={0.75}
              >
                <Compass size={14} color={SOCIAL_THEME.primary} />
                <Text className="text-xs font-black" style={{ color: SOCIAL_THEME.primary }}>Explore all Commons directory</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openSuggestCommons} activeOpacity={0.75}>
                <Text className="mb-4 mt-1 text-center text-[11px] font-semibold text-stone-400">
                  Don&apos;t see your community? Suggest a commons
                </Text>
              </TouchableOpacity>

              <Text className="mb-2 text-[11px] font-black uppercase tracking-wide text-stone-400">Sections</Text>
              <View className="mb-5 overflow-hidden rounded-2xl border border-stone-200 bg-white">
                {DRAWER_SECTIONS.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <TouchableOpacity
                      key={item.label}
                      onPress={() => goToDrawerItem(item.action)}
                      className={`flex-row items-center gap-2.5 px-3 py-3 ${
                        index < DRAWER_SECTIONS.length - 1 ? 'border-b border-stone-100' : ''
                      }`}
                      activeOpacity={0.75}
                    >
                      <View className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100">
                        <Icon size={17} color={SOCIAL_THEME.primary} />
                      </View>
                      <Text className="flex-1 text-sm font-black text-gray-900">{item.label}</Text>
                      <ChevronRight size={15} color="#D6D3D1" />
                    </TouchableOpacity>
                  );
                })}
              </View>

              {hasAccountSession ? (
                <TouchableOpacity
                  onPress={() => void logout()}
                  className="flex-row items-center justify-center gap-2 rounded-2xl bg-stone-100 py-3"
                  activeOpacity={0.8}
                >
                  <LogOut size={16} color="#DC2626" />
                  <Text className="text-sm font-black text-red-600">Sign Out (@{accountHandle})</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={onSignInPress}
                  className="flex-row items-center justify-center gap-2 rounded-2xl py-3"
                  style={{ backgroundColor: SOCIAL_THEME.primary }}
                  activeOpacity={0.85}
                >
                  <UserCircle size={16} color="#FFFFFF" />
                  <Text className="text-sm font-black text-white">Sign In</Text>
                </TouchableOpacity>
              )}

              <Text className="mt-4 text-center text-[11px] font-semibold text-stone-300">
                Cahootz v1.1 · Powered by Expo 54
              </Text>
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

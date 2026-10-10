import { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  CornerDownRight,
  Heart,
  ImagePlus,
  Pencil,
  Send,
  Share2,
  Trash2,
  UserCircle,
  X,
} from 'lucide-react-native';

import {
  CommonsMediaTile,
  CommonsMediaViewer,
  COMPOSER_MEDIA_TILE_SIZE,
  FEED_MEDIA_TILE_SIZE,
  type CommonsMediaPreview,
} from '@/components/commons-media-viewer';
import { Text } from '@/components/ui/text';
import { AiBadge } from '@/components/ai-badge';
import { MentionText } from '@/components/mention-text';
import { MentionComposerInput } from '@/components/mention-composer-input';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsPost, type CommonsProfile } from '@/lib/api';
import { ApiError, friendlyError } from '@/lib/friendly-error';
import { LoadError } from '@/components/load-error';
import { personDisplayHandle, personHandleFromName, personInitials } from '@/lib/social-profile';
import { SageDecisionTrails } from '@/components/sage-decision-trail';
import { ReactionBar } from '@/components/reaction-bar';
import { LIKE_EMOJI } from '@/lib/emoji-catalog';

const THEME = {
  paper: '#F6F7F8',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  ink: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
};

export default function CommonsPostDetailScreen() {
  const params = useLocalSearchParams<{ coopId?: string; postId?: string; commentId?: string; focus?: string }>();
  const coopId = params.coopId || 'cahootz';
  const postId = params.postId || '';
  // Set by alerts that point at one comment (e.g. "replied to your intro").
  const focusCommentId = params.commentId || '';
  const { user, sessionToken, isLoading: authLoading } = useAuth();

  const [post, setPost] = useState<CommonsPost | null>(null);
  const [circleIsMember, setCircleIsMember] = useState<boolean | null>(null);
  const [isJoiningCircle, setIsJoiningCircle] = useState(false);
  const [coop, setCoop] = useState<CommonsProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // The post is gone or hidden, so "Try again" can't help.
  const [postGone, setPostGone] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentMedia, setCommentMedia] = useState<CommonsMediaPreview[]>([]);
  const [isCommenting, setIsCommenting] = useState(false);
  const [viewerMedia, setViewerMedia] = useState<CommonsMediaPreview | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [reactingCommentId, setReactingCommentId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const commentsOffsetY = useRef(0);
  const scrolledToFocus = useRef(false);

  useEffect(() => {
    let mounted = true;

    // A direct navigation or browser reload mounts this route before the
    // persisted session has finished restoring. Waiting prevents an initial
    // unauthenticated request from flashing a false 403 (and, in development,
    // leaving Expo's error overlay over an otherwise recovered screen).
    if (authLoading) {
      return () => {
        mounted = false;
      };
    }

    if (!postId) {
      setPostGone(true);
      setError("We couldn't find this post.");
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    setIsLoading(true);
    setError('');
    setPostGone(false);
    api
      .getCommonsPost({ coopId, postId }, sessionToken)
      .then((result) => {
        if (!mounted) return;
        setPost(result.post);
        setCoop(result.coop);
        setCircleIsMember(result.circleIsMember ?? null);
      })
      .catch((caughtError) => {
        console.error('Failed to load commons post:', caughtError);
        if (!mounted) return;
        setPostGone(
          caughtError instanceof ApiError &&
            (caughtError.code === 'NOT_FOUND' || caughtError.code === 'FORBIDDEN'),
        );
        setError(friendlyError(caughtError, "We couldn't load this post."));
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [authLoading, coopId, postId, sessionToken, reloadKey]);

  const supportPost = async () => {
    if (!post) return;
    if (circleIsMember === false) {
      setError('Join this circle before liking posts.');
      return;
    }
    if (!sessionToken) {
      setError('Sign in to like posts.');
      return;
    }

    try {
      const result = await api.toggleCommonsSupport(post.id, sessionToken);
      setPost((current) =>
        current
          ? {
              ...current,
              support: Math.max(0, current.support + (result.supported ? 1 : -1)),
            }
          : current
      );
    } catch (caughtError) {
      console.error('Failed to support post:', caughtError);
      setError(friendlyError(caughtError, "We couldn't save your like."));
    }
  };

  const [isReactingToPost, setIsReactingToPost] = useState(false);
  const togglePostReaction = async (emoji: string) => {
    if (emoji === LIKE_EMOJI) {
      await supportPost();
      return;
    }
    if (!post || !sessionToken || isReactingToPost) return;
    setIsReactingToPost(true);
    try {
      const result = await api.togglePostReaction(post.id, emoji, sessionToken);
      setPost((current) =>
        current ? { ...current, support: result.support, reactions: result.reactions } : current
      );
    } catch (caughtError) {
      setError(friendlyError(caughtError, "We couldn't save your reaction."));
    } finally {
      setIsReactingToPost(false);
    }
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!post || isCommenting) return;
    if (circleIsMember === false) {
      setError('Join this circle before replying.');
      return;
    }
    if (!content && commentMedia.length === 0) return;
    if (!sessionToken) {
      setError('Sign in to comment.');
      return;
    }

    setIsCommenting(true);
    setError('');
    try {
      const uploadedMedia = await Promise.all(
        commentMedia.map((media) =>
          api.uploadCommonsCommentMedia({
            postId: post.id,
            uri: media.uri || media.url || '',
            fileName: media.fileName || null,
            mimeType: media.mimeType,
            mediaType: 'image',
            width: media.width ?? null,
            height: media.height ?? null,
            sizeBytes: media.sizeBytes ?? null,
          })
        )
      );
      const result = await api.createCommonsComment(
        {
          postId: post.id,
          content,
          media: uploadedMedia,
          ...(replyTo ? { replyToCommentId: replyTo.id } : {}),
        },
        sessionToken
      );
      setPost((current) =>
        current
          ? {
              ...current,
              replies: current.replies + 1,
              comments: [...current.comments, result.comment],
            }
          : current
      );
      setCommentDraft('');
      setCommentMedia([]);
      setReplyTo(null);
    } catch (caughtError) {
      console.error('Failed to comment:', caughtError);
      setError(friendlyError(caughtError, "We couldn't post your comment."));
    } finally {
      setIsCommenting(false);
    }
  };

  const joinCurrentCircle = async () => {
    if (!post?.circleId || isJoiningCircle) return;
    if (!sessionToken) {
      router.push({ pathname: '/', params: { entry: 'sign-in' } } as any);
      return;
    }
    setIsJoiningCircle(true);
    setError('');
    try {
      await api.joinPublicCircle(post.circleId, sessionToken);
      setCircleIsMember(true);
    } catch (caughtError) {
      setError(friendlyError(caughtError, "We couldn't add you to this circle."));
    } finally {
      setIsJoiningCircle(false);
    }
  };

  const toggleCommentReaction = async (commentId: string, emoji?: string) => {
    if (!sessionToken || reactingCommentId) return;
    setReactingCommentId(commentId);
    try {
      const result = await api.toggleCommentReaction(commentId, sessionToken, emoji);
      setPost((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      viewerReacted: result.viewerReacted ?? result.reacted,
                      reactionCount: result.reactionCount,
                      reactions: result.reactions ?? comment.reactions,
                    }
                  : comment
              ),
            }
          : current
      );
    } catch (caughtError) {
      setError(friendlyError(caughtError, "We couldn't save your reaction."));
    } finally {
      setReactingCommentId(null);
    }
  };

  const startReply = (comment: { id: string; author: string; authorHandle?: string }) => {
    setReplyTo({ id: comment.id, author: comment.author });
    // Bracketed so the composer shows it as one atomic mention chip.
    const mention = comment.authorHandle ? `[@${comment.authorHandle}] ` : '';
    setCommentDraft((current) => (mention && !current.startsWith(mention) ? `${mention}${current}` : current));
  };

  const startEditComment = (commentId: string, body: string) => {
    setEditingCommentId(commentId);
    setEditDraft(body);
  };

  const submitEditComment = async () => {
    const content = editDraft.trim();
    if (!content || !editingCommentId || !sessionToken) return;

    setBusyCommentId(editingCommentId);
    try {
      const result = await api.editComment({ commentId: editingCommentId, content }, sessionToken);
      setPost((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((comment) =>
                comment.id === editingCommentId ? result.comment : comment
              ),
            }
          : current
      );
      setEditingCommentId(null);
      setEditDraft('');
    } catch (caughtError) {
      Alert.alert("Couldn't save your changes", friendlyError(caughtError, "We couldn't save your changes to this comment."));
    } finally {
      setBusyCommentId(null);
    }
  };

  const deleteComment = (commentId: string) => {
    if (!sessionToken) return;

    Alert.alert('Delete comment?', 'This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyCommentId(commentId);
          try {
            await api.deleteComment(commentId, sessionToken);
            setPost((current) =>
              current
                ? {
                    ...current,
                    replies: Math.max(0, current.replies - 1),
                    comments: current.comments.filter((comment) => comment.id !== commentId),
                  }
                : current
            );
          } catch (caughtError) {
            Alert.alert("Couldn't delete the comment", friendlyError(caughtError, "We couldn't delete this comment."));
          } finally {
            setBusyCommentId(null);
          }
        },
      },
    ]);
  };

  const pickCommentMedia = async () => {
    if (commentMedia.length >= 4) {
      setError('You can add up to 4 images or GIFs to a comment.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access to add images or GIFs.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 4 - commentMedia.length),
      quality: 0.85,
    });

    if (result.canceled) return;

    const selectedMedia = result.assets.map((asset) => ({
      uri: asset.uri,
      pathname: asset.uri,
      url: asset.uri,
      mediaType: 'image' as const,
      mimeType: asset.mimeType || (asset.fileName?.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/jpeg'),
      fileName: asset.fileName || asset.uri.split('/').pop() || null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      sizeBytes: asset.fileSize ?? null,
    }));

    setCommentMedia((current) => [...current, ...selectedMedia].slice(0, 4));
    setError('');
  };

  const removeCommentMedia = (indexToRemove: number) => {
    setCommentMedia((current) => current.filter((_, index) => index !== indexToRemove));
  };

  const sharePost = async () => {
    if (!post) return;

    try {
      await Share.share({
        message: `${post.body}\n\n${post.group}`,
      });
    } catch (caughtError) {
      console.error('Failed to share post:', caughtError);
    }
  };

  const deletePost = () => {
    if (!post || isDeleting || !sessionToken) return;

    Alert.alert('Delete post?', 'This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setIsDeleting(true);
          try {
            await api.deleteCommonsPost(post.id, sessionToken);
            router.back();
          } catch (caughtError) {
            setIsDeleting(false);
            Alert.alert("Couldn't delete your post", friendlyError(caughtError, "We couldn't delete your post."));
          }
        },
      },
    ]);
  };

  const openPersonPage = (author: string, handle?: string) => {
    router.push({
      pathname: '/people/[handle]',
      params: {
        handle: handle || personHandleFromName(author),
        name: author,
      },
    } as any);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: THEME.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="border-b border-gray-200 bg-white px-4 pt-14 pb-3">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => router.back()}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={THEME.ink} />
          </TouchableOpacity>
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-black uppercase text-gray-500">{coop?.name || 'Commons'}</Text>
            <Text className="text-xl font-black text-gray-950" numberOfLines={1}>Post</Text>
          </View>
          <TouchableOpacity
            onPress={sharePost}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Share post"
          >
            <Share2 size={20} color={THEME.ink} />
          </TouchableOpacity>
          {post && user?.id && post.authorId === user.id ? (
            <TouchableOpacity
              onPress={deletePost}
              disabled={isDeleting}
              className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
              accessibilityLabel="Delete post"
            >
              {isDeleting ? <ActivityIndicator size="small" color="#DC2626" /> : <Trash2 size={20} color="#DC2626" />}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView ref={scrollRef} className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        {isLoading ? (
          <View className="mt-12 items-center gap-3">
            <ActivityIndicator color={THEME.primary} />
            <Text className="text-sm font-semibold text-gray-600">Loading post...</Text>
          </View>
        ) : null}

        {!isLoading && error && !post && !postGone ? (
          <LoadError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : !isLoading && error && !post ? (
          <View className="rounded-xl border border-red-200 bg-red-50 p-4">
            <Text className="font-black text-red-700">We couldn&apos;t open this post</Text>
            <Text className="mt-1 text-base text-red-700">{error}</Text>
          </View>
        ) : null}

        {post ? (
          <View className="rounded-xl border border-gray-200 bg-white p-4">
            <View className="flex-row items-center gap-3">
              <TouchableOpacity
                onPress={() => openPersonPage(post.author, post.authorHandle)}
                className="h-11 w-11 items-center justify-center rounded-full bg-slate-200"
                activeOpacity={0.75}
                accessibilityLabel={`Open ${post.author}'s personal page`}
              >
                <Text className="text-base font-black text-slate-600">{personInitials(post.author)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openPersonPage(post.author, post.authorHandle)}
                className="min-w-0 flex-1"
                activeOpacity={0.75}
                accessibilityLabel={`Open ${post.author}'s personal page`}
              >
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-sm font-black text-gray-950" numberOfLines={1}>{post.author}</Text>
                  {post.authorIsAi ? <AiBadge /> : null}
                  {post.supporterBadge ? <View className="flex-row items-center rounded-full px-2 py-0.5" style={{ backgroundColor: `${post.supporterBadge.color}18` }}><Award size={10} color={post.supporterBadge.color} /><Text className="ml-1 text-[9px] font-black" style={{ color: post.supporterBadge.color }}>{post.supporterBadge.shortName}</Text></View> : null}
                </View>
                <Text className="text-xs font-semibold text-stone-500" numberOfLines={1}>
                  {personDisplayHandle(post.authorHandle || post.author)} · {post.group} · {post.time}
                </Text>
              </TouchableOpacity>
              <UserCircle size={20} color={THEME.primary} />
            </View>
            {post.body ? (
              <MentionText
                content={post.body}
                className="mt-3"
                style={{ fontSize: 16, lineHeight: 24, color: '#374151' }}
              />
            ) : null}

            {post.media?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4">
                <View className="flex-row gap-2">
                  {post.media.map((media) => (
                    <TouchableOpacity
                      key={media.id || media.pathname || media.url}
                      onPress={() => setViewerMedia(media)}
                      className="overflow-hidden rounded-xl bg-gray-100"
                      style={{ width: FEED_MEDIA_TILE_SIZE, height: FEED_MEDIA_TILE_SIZE }}
                      activeOpacity={0.85}
                    >
                      <CommonsMediaTile media={media} size={FEED_MEDIA_TILE_SIZE} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            ) : null}

            <View className="mt-4 flex-row items-center gap-4">
              <Text className="text-xs font-semibold text-stone-600">
                <Text className="font-black" style={{ color: THEME.primary }}>{post.support}</Text>{' '}
                {post.support === 1 ? 'like' : 'likes'}
              </Text>
              <Text className="text-xs font-semibold text-stone-600">
                <Text className="font-black text-stone-800">{post.replies}</Text>{' '}
                {post.replies === 1 ? 'comment' : 'comments'}
              </Text>
            </View>

            {post.id ? (
              <View className="mt-3">
                <ReactionBar
                  reactions={post.reactions ?? []}
                  onToggle={(emoji) => void togglePostReaction(emoji)}
                  disabled={!sessionToken || circleIsMember === false || isReactingToPost}
                  targetLabel="this post"
                />
              </View>
            ) : null}

            <View className="mt-4 flex-row border-y border-stone-100 py-2">
              <TouchableOpacity onPress={supportPost} disabled={circleIsMember === false} className="flex-1 flex-row items-center justify-center gap-2 py-2" style={{ opacity: circleIsMember === false ? 0.4 : 1 }}>
                <CheckCircle2 size={16} color={THEME.primary} />
                <Text className="text-sm font-bold text-stone-700">Like</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={sharePost} className="flex-1 flex-row items-center justify-center gap-2 py-2">
                <Share2 size={16} color="#78716C" />
                <Text className="text-sm font-bold text-stone-700">Share</Text>
              </TouchableOpacity>
            </View>

            {error ? <Text className="mt-3 text-sm font-semibold text-red-600">{error}</Text> : null}

            <SageDecisionTrails filter={{ postId: post.id }} sessionToken={sessionToken} refreshKey={post.comments.length} />

            <View className="mt-4" onLayout={(event) => { commentsOffsetY.current = event.nativeEvent.layout.y; }}>
              <Text className="text-base font-black text-gray-950">Comments</Text>
              <View className="mt-3 gap-3">
                {post.comments.length === 0 ? (
                  <Text className="text-sm text-gray-500">No comments yet.</Text>
                ) : null}
                {post.comments.map((comment) => {
                  const isFocused = !!focusCommentId && comment.id === focusCommentId;
                  return (
                  <View
                    key={comment.id || `${comment.author}-${comment.body}`}
                    testID={comment.id ? `comment-${comment.id}` : undefined}
                    className="rounded-xl bg-stone-50 p-3"
                    style={isFocused ? { borderWidth: 2, borderColor: THEME.primary, backgroundColor: THEME.primarySoft } : undefined}
                    accessibilityLabel={isFocused ? 'Highlighted comment' : undefined}
                    onLayout={
                      isFocused
                        ? (event) => {
                            if (scrolledToFocus.current) return;
                            scrolledToFocus.current = true;
                            const y = commentsOffsetY.current + event.nativeEvent.layout.y;
                            scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
                          }
                        : undefined
                    }
                  >
                    {isFocused && comment.authorId === user?.id ? (
                      <Text className="mb-1 text-[10px] font-black uppercase" style={{ color: THEME.primary }}>{params.focus === 'intro' ? 'Your intro' : 'Your comment'}</Text>
                    ) : null}
                    <View className="flex-row items-start justify-between gap-2">
                      <View className="flex-row items-center gap-1.5">
                        <TouchableOpacity
                          onPress={() => openPersonPage(comment.author, comment.authorHandle)}
                          accessibilityRole="link"
                          accessibilityLabel={`Open ${comment.author}'s personal page`}
                        >
                          <Text className="text-xs font-black text-stone-800">{comment.author}</Text>
                        </TouchableOpacity>
                        {comment.authorIsAi ? <AiBadge /> : null}
                        {comment.supporterBadge ? <View className="flex-row items-center rounded-full px-2 py-0.5" style={{ backgroundColor: `${comment.supporterBadge.color}18` }}><Award size={9} color={comment.supporterBadge.color} /><Text className="ml-1 text-[8px] font-black" style={{ color: comment.supporterBadge.color }}>{comment.supporterBadge.shortName}</Text></View> : null}
                      </View>
                      {comment.authorId && comment.authorId === user?.id ? (
                        <View className="flex-row items-center gap-3">
                          <TouchableOpacity
                            onPress={() => startEditComment(comment.id, comment.body)}
                            accessibilityLabel="Edit comment"
                          >
                            <Pencil size={13} color={THEME.muted} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteComment(comment.id)} accessibilityLabel="Delete comment">
                            {busyCommentId === comment.id ? (
                              <ActivityIndicator size="small" color="#DC2626" />
                            ) : (
                              <Trash2 size={13} color="#DC2626" />
                            )}
                          </TouchableOpacity>
                        </View>
                      ) : comment.id && circleIsMember !== false && sessionToken ? (
                        <TouchableOpacity
                          onPress={() => startReply(comment)}
                          className="flex-row items-center gap-1"
                          accessibilityRole="button"
                          accessibilityLabel={`Reply to ${comment.author}`}
                        >
                          <CornerDownRight size={13} color={THEME.muted} />
                          <Text className="text-[11px] font-bold text-stone-500">Reply</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {editingCommentId === comment.id ? (
                      <View className="mt-1 flex-row items-center gap-2">
                        <MentionComposerInput
                          value={editDraft}
                          onChangeText={setEditDraft}
                          coopId={coopId}
                          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900"
                          multiline
                        />
                        <TouchableOpacity
                          onPress={submitEditComment}
                          disabled={busyCommentId === comment.id}
                          accessibilityLabel="Save comment edit"
                        >
                          {busyCommentId === comment.id ? (
                            <ActivityIndicator size="small" color={THEME.primary} />
                          ) : (
                            <Send size={16} color={THEME.primary} />
                          )}
                        </TouchableOpacity>
                      </View>
                    ) : comment.body ? (
                      <MentionText
                        content={comment.body}
                        className="mt-1"
                        style={{ fontSize: 14, lineHeight: 20, color: '#44403C' }}
                      />
                    ) : null}
                    {comment.media?.length ? (
                      <View className="mt-2 flex-row flex-wrap gap-2">
                        {comment.media.map((media) => (
                          <TouchableOpacity
                            key={media.id || media.pathname || media.url}
                            onPress={() => setViewerMedia(media)}
                            className="overflow-hidden rounded-xl bg-gray-100"
                            style={{ width: COMPOSER_MEDIA_TILE_SIZE, height: COMPOSER_MEDIA_TILE_SIZE }}
                            activeOpacity={0.85}
                          >
                            <CommonsMediaTile media={media} size={COMPOSER_MEDIA_TILE_SIZE} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    {comment.id ? (
                      <View className="mt-2">
                        <ReactionBar
                          reactions={comment.reactions ?? []}
                          onToggle={(emoji) => void toggleCommentReaction(comment.id, emoji)}
                          disabled={!sessionToken || circleIsMember === false || reactingCommentId === comment.id}
                          targetLabel={`${comment.author}'s comment`}
                        >
                          <TouchableOpacity
                            onPress={() => void toggleCommentReaction(comment.id)}
                            disabled={!sessionToken || circleIsMember === false || reactingCommentId === comment.id}
                            className="flex-row items-center gap-1 rounded-full px-2 py-1"
                            style={{
                              backgroundColor: comment.viewerReacted ? THEME.primarySoft : 'transparent',
                              opacity: !sessionToken || circleIsMember === false ? 0.5 : 1,
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected: !!comment.viewerReacted }}
                            accessibilityLabel={`${comment.viewerReacted ? 'Remove your like from' : 'Like'} ${comment.author}'s comment, ${comment.reactionCount ?? 0} ${(comment.reactionCount ?? 0) === 1 ? 'like' : 'likes'}`}
                          >
                            <Heart
                              size={13}
                              color={comment.viewerReacted ? THEME.primary : THEME.muted}
                              fill={comment.viewerReacted ? THEME.primary : 'transparent'}
                            />
                            <Text
                              className="text-[11px] font-bold"
                              style={{ color: comment.viewerReacted ? THEME.primary : '#78716C' }}
                            >
                              {comment.reactionCount ?? 0}
                            </Text>
                          </TouchableOpacity>
                        </ReactionBar>
                      </View>
                    ) : null}
                  </View>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {post && circleIsMember === false ? (
        <View className="border-t border-gray-200 bg-white px-4 py-4">
          <Text className="text-sm font-black text-gray-950">Join this circle to participate</Text>
          <Text className="mt-1 text-xs text-gray-600">You can read its posts now. Join to reply, post, and like.</Text>
          <TouchableOpacity onPress={() => void joinCurrentCircle()} disabled={isJoiningCircle} className="mt-3 self-start rounded-full px-4 py-2" style={{ backgroundColor: THEME.primary, opacity: isJoiningCircle ? 0.6 : 1 }}>
            <Text className="text-xs font-black text-white">{isJoiningCircle ? 'Joining…' : 'Join circle'}</Text>
          </TouchableOpacity>
        </View>
      ) : post ? (
        <View className="border-t border-gray-200 bg-white px-4 py-3">
          {replyTo ? (
            <View className="mb-2 flex-row items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
              <Text className="text-xs font-semibold text-stone-600" numberOfLines={1}>
                Replying to {replyTo.author}
              </Text>
              <TouchableOpacity onPress={() => setReplyTo(null)} accessibilityLabel="Cancel reply">
                <X size={14} color={THEME.muted} />
              </TouchableOpacity>
            </View>
          ) : null}
          {commentMedia.length ? (
            <View className="mb-3 flex-row flex-wrap gap-2">
              {commentMedia.map((media, index) => (
                <View
                  key={`${media.uri || media.url}-${index}`}
                  className="overflow-hidden rounded-xl bg-gray-100"
                  style={{ width: COMPOSER_MEDIA_TILE_SIZE, height: COMPOSER_MEDIA_TILE_SIZE }}
                >
                  <CommonsMediaTile media={media} size={COMPOSER_MEDIA_TILE_SIZE} />
                  <TouchableOpacity
                    onPress={() => removeCommentMedia(index)}
                    className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-black/70"
                    accessibilityLabel="Remove comment media"
                  >
                    <X size={15} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
          <View className="flex-row items-end gap-2">
            <TouchableOpacity
              onPress={pickCommentMedia}
              disabled={isCommenting || commentMedia.length >= 4}
              className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
              accessibilityLabel="Add image or GIF"
            >
              <ImagePlus size={18} color={commentMedia.length >= 4 ? '#9CA3AF' : THEME.ink} />
            </TouchableOpacity>
            <MentionComposerInput
              value={commentDraft}
              onChangeText={(text) => {
                setCommentDraft(text);
                if (error) setError('');
              }}
              coopId={coopId}
              placeholder="Write a comment..."
              placeholderTextColor={THEME.muted}
              multiline
              className="min-h-11 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
              style={{ maxHeight: 96, textAlignVertical: 'top', backgroundColor: THEME.paper }}
            />
            <TouchableOpacity
              onPress={submitComment}
              disabled={isCommenting || (!commentDraft.trim() && commentMedia.length === 0)}
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={{ backgroundColor: commentDraft.trim() || commentMedia.length ? THEME.primary : '#FDBA74' }}
              accessibilityLabel="Send comment"
            >
              {isCommenting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Send size={17} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <CommonsMediaViewer media={viewerMedia} onClose={() => setViewerMedia(null)} />
    </KeyboardAvoidingView>
  );
}

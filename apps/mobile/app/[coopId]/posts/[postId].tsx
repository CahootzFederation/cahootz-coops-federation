import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle2,
  Send,
  Share2,
} from 'lucide-react-native';

import {
  CommonsMediaTile,
  CommonsMediaViewer,
  FEED_MEDIA_TILE_SIZE,
  type CommonsMediaPreview,
} from '@/components/commons-media-viewer';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsPost, type CommonsProfile } from '@/lib/api';

const THEME = {
  paper: '#F6F7F8',
  primary: '#F97316',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  ink: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
};

export default function CommonsPostDetailScreen() {
  const params = useLocalSearchParams<{ coopId?: string; postId?: string }>();
  const coopId = params.coopId || 'cahootz';
  const postId = params.postId || '';
  const { user } = useAuth();
  const sessionToken = user?.sessionToken || null;

  const [post, setPost] = useState<CommonsPost | null>(null);
  const [coop, setCoop] = useState<CommonsProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [isCommenting, setIsCommenting] = useState(false);
  const [viewerMedia, setViewerMedia] = useState<CommonsMediaPreview | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!postId) {
      setError('Post not found.');
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    setIsLoading(true);
    setError('');
    api
      .getCommonsPost({ coopId, postId }, sessionToken)
      .then((result) => {
        if (!mounted) return;
        setPost(result.post);
        setCoop(result.coop);
      })
      .catch((caughtError) => {
        console.error('Failed to load commons post:', caughtError);
        if (mounted) setError(caughtError instanceof Error ? caughtError.message : 'Could not load this post.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [coopId, postId, sessionToken]);

  const supportPost = async () => {
    if (!post) return;
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
      setError(caughtError instanceof Error ? caughtError.message : 'Could not update like.');
    }
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!post || isCommenting) return;
    if (!content) return;
    if (!sessionToken) {
      setError('Sign in to comment.');
      return;
    }

    setIsCommenting(true);
    setError('');
    try {
      const result = await api.createCommonsComment({ postId: post.id, content }, sessionToken);
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
    } catch (caughtError) {
      console.error('Failed to comment:', caughtError);
      setError(caughtError instanceof Error ? caughtError.message : 'Could not add comment.');
    } finally {
      setIsCommenting(false);
    }
  };

  const sharePost = async () => {
    if (!post) return;

    try {
      await Share.share({
        title: post.title,
        message: `${post.title}\n\n${post.body}\n\n${post.group}`,
      });
    } catch (caughtError) {
      console.error('Failed to share post:', caughtError);
    }
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
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        {isLoading ? (
          <View className="mt-12 items-center gap-3">
            <ActivityIndicator color={THEME.primary} />
            <Text className="text-sm font-semibold text-gray-600">Loading post...</Text>
          </View>
        ) : null}

        {!isLoading && error && !post ? (
          <View className="rounded-xl border border-red-200 bg-red-50 p-4">
            <Text className="font-black text-red-700">Could not open post</Text>
            <Text className="mt-1 text-sm text-red-700">{error}</Text>
          </View>
        ) : null}

        {post ? (
          <View className="rounded-xl border border-gray-200 bg-white p-4">
            <Text className="text-xs font-semibold text-stone-500">
              {post.group} · {post.author} · {post.time}
            </Text>
            <Text className="mt-3 text-2xl font-black leading-8 text-gray-950">{post.title}</Text>
            {post.body ? <Text className="mt-3 text-base leading-6 text-gray-700">{post.body}</Text> : null}

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

            <View className="mt-4 flex-row border-y border-stone-100 py-2">
              <TouchableOpacity onPress={supportPost} className="flex-1 flex-row items-center justify-center gap-2 py-2">
                <CheckCircle2 size={16} color={THEME.primary} />
                <Text className="text-sm font-bold text-stone-700">Like</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={sharePost} className="flex-1 flex-row items-center justify-center gap-2 py-2">
                <Share2 size={16} color="#78716C" />
                <Text className="text-sm font-bold text-stone-700">Share</Text>
              </TouchableOpacity>
            </View>

            {error ? <Text className="mt-3 text-sm font-semibold text-red-600">{error}</Text> : null}

            <View className="mt-4">
              <Text className="text-base font-black text-gray-950">Comments</Text>
              <View className="mt-3 gap-3">
                {post.comments.length === 0 ? (
                  <Text className="text-sm text-gray-500">No comments yet.</Text>
                ) : null}
                {post.comments.map((comment) => (
                  <View key={comment.id || `${comment.author}-${comment.body}`} className="rounded-xl bg-stone-50 p-3">
                    <Text className="text-xs font-black text-stone-800">{comment.author}</Text>
                    <Text className="mt-1 text-sm leading-5 text-stone-700">{comment.body}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {post ? (
        <View className="border-t border-gray-200 bg-white px-4 py-3">
          <View className="flex-row items-end gap-2">
            <TextInput
              value={commentDraft}
              onChangeText={(text) => {
                setCommentDraft(text);
                if (error) setError('');
              }}
              placeholder="Write a comment..."
              placeholderTextColor={THEME.muted}
              multiline
              className="min-h-11 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
              style={{ maxHeight: 96, textAlignVertical: 'top', backgroundColor: THEME.paper }}
            />
            <TouchableOpacity
              onPress={submitComment}
              disabled={isCommenting || !commentDraft.trim()}
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={{ backgroundColor: commentDraft.trim() ? THEME.primary : '#FDBA74' }}
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

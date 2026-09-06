import React from 'react';
import { ActivityIndicator, Alert, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { Heart, MessageCircle, Pencil, Send, Trash2 } from 'lucide-react-native';

import { CommonsMediaTile, FEED_MEDIA_TILE_SIZE } from '@/components/commons-media-viewer';
import { Text } from '@/components/ui/text';
import { api, type CommonsPostMedia, type PersonalPageFeedPost } from '@/lib/api';
import { postTypeLabel, shouldShowPostType } from '@/lib/post-types';

const THEME = {
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  ink: '#111827',
};

type Props = {
  post: PersonalPageFeedPost;
  sessionToken: string | null;
  currentUserId?: string;
  onChange: (post: PersonalPageFeedPost) => void;
  header?: React.ReactNode;
  onDeletePost?: () => void;
  isDeletingPost?: boolean;
  onMediaPress?: (media: CommonsPostMedia) => void;
};

export function PersonalPagePostCard({
  post,
  sessionToken,
  currentUserId,
  onChange,
  header,
  onDeletePost,
  isDeletingPost,
  onMediaPress,
}: Props) {
  const [isLiking, setIsLiking] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [commentDraft, setCommentDraft] = React.useState('');
  const [isCommenting, setIsCommenting] = React.useState(false);
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null);
  const [editDraft, setEditDraft] = React.useState('');
  const [busyCommentId, setBusyCommentId] = React.useState<string | null>(null);

  const toggleLike = async () => {
    if (!sessionToken || isLiking) return;
    setIsLiking(true);
    try {
      const result = await api.togglePersonalPageSupport(post.id, sessionToken);
      onChange({ ...post, support: Math.max(0, post.support + (result.supported ? 1 : -1)) });
    } catch (error) {
      console.error('Failed to like page post:', error);
    } finally {
      setIsLiking(false);
    }
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!content || !sessionToken || isCommenting) return;

    setIsCommenting(true);
    try {
      const result = await api.createPersonalPageComment({ postId: post.id, content }, sessionToken);
      onChange({ ...post, replies: post.replies + 1, comments: [...post.comments, result.comment] });
      setCommentDraft('');
    } catch (error) {
      Alert.alert('Could not add comment', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsCommenting(false);
    }
  };

  const startEdit = (commentId: string, body: string) => {
    setEditingCommentId(commentId);
    setEditDraft(body);
  };

  const submitEdit = async () => {
    const content = editDraft.trim();
    if (!content || !editingCommentId || !sessionToken) return;

    setBusyCommentId(editingCommentId);
    try {
      const result = await api.editPersonalPageComment({ commentId: editingCommentId, content }, sessionToken);
      onChange({
        ...post,
        comments: post.comments.map((comment) => (comment.id === editingCommentId ? result.comment : comment)),
      });
      setEditingCommentId(null);
      setEditDraft('');
    } catch (error) {
      Alert.alert('Could not edit comment', error instanceof Error ? error.message : 'Please try again.');
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
            await api.deletePersonalPageComment(commentId, sessionToken);
            onChange({
              ...post,
              replies: Math.max(0, post.replies - 1),
              comments: post.comments.filter((comment) => comment.id !== commentId),
            });
          } catch (error) {
            Alert.alert('Could not delete comment', error instanceof Error ? error.message : 'Please try again.');
          } finally {
            setBusyCommentId(null);
          }
        },
      },
    ]);
  };

  return (
    <View className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: THEME.border }}>
      <View className="p-4">
        {header}
        <View className="flex-row items-center justify-between gap-3">
          {shouldShowPostType(post.tag) ? (
            <View className="self-start rounded-full px-2.5 py-1" style={{ backgroundColor: THEME.primarySoft }}>
              <Text className="text-[10px] font-black" style={{ color: THEME.primary }}>
                {postTypeLabel(post.tag)}
              </Text>
            </View>
          ) : (
            <Text className="text-xs font-black text-gray-400">Personal Page</Text>
          )}
          <View className="flex-row items-center gap-2">
            <Text className="text-xs font-semibold text-gray-400">{post.time}</Text>
            {onDeletePost ? (
              <TouchableOpacity onPress={onDeletePost} disabled={isDeletingPost} accessibilityLabel="Delete post">
                {isDeletingPost ? (
                  <ActivityIndicator size="small" color="#DC2626" />
                ) : (
                  <Trash2 size={15} color="#DC2626" />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        {post.body ? <Text className="mt-3 text-sm leading-5 text-gray-700">{post.body}</Text> : null}
      </View>

      {post.media?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="border-y border-gray-100 bg-gray-50">
          <View className="flex-row gap-2 p-2">
            {post.media.map((media, index) => (
              <TouchableOpacity
                key={`${media.url}-${index}`}
                onPress={() => onMediaPress?.(media)}
                disabled={!onMediaPress}
                activeOpacity={0.85}
                className="overflow-hidden rounded-2xl bg-gray-200"
              >
                <CommonsMediaTile media={media} size={post.media.length === 1 ? 286 : FEED_MEDIA_TILE_SIZE} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View className="flex-row border-t border-gray-100 px-4 py-3">
        <TouchableOpacity
          onPress={() => void toggleLike()}
          disabled={isLiking}
          className="flex-1 flex-row items-center justify-center gap-2"
        >
          <Heart size={15} color={THEME.muted} />
          <Text className="text-xs font-black text-gray-600">{post.support}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setExpanded((current) => !current)}
          className="flex-1 flex-row items-center justify-center gap-2"
        >
          <MessageCircle size={15} color={THEME.muted} />
          <Text className="text-xs font-black text-gray-600">{post.replies}</Text>
        </TouchableOpacity>
      </View>

      {expanded ? (
        <View className="border-t border-gray-100 bg-gray-50 p-3">
          {post.comments.length === 0 ? (
            <Text className="px-1 text-xs font-semibold text-gray-500">No comments yet.</Text>
          ) : null}
          <View className="gap-2">
            {post.comments.map((comment) => (
              <View key={comment.id} className="rounded-xl bg-white p-3">
                {editingCommentId === comment.id ? (
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={editDraft}
                      onChangeText={setEditDraft}
                      className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm text-gray-900"
                      style={{ borderColor: THEME.border }}
                      multiline
                    />
                    <TouchableOpacity
                      onPress={() => void submitEdit()}
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
                ) : (
                  <>
                    <View className="flex-row items-start justify-between gap-2">
                      <Text className="text-xs font-black text-gray-800">{comment.author}</Text>
                      {comment.authorId && comment.authorId === currentUserId ? (
                        <View className="flex-row items-center gap-2">
                          <TouchableOpacity onPress={() => startEdit(comment.id, comment.body)} accessibilityLabel="Edit comment">
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
                      ) : null}
                    </View>
                    <Text className="mt-1 text-sm leading-5 text-gray-700">{comment.body}</Text>
                  </>
                )}
              </View>
            ))}
          </View>

          {sessionToken ? (
            <View className="mt-2 flex-row items-center gap-2">
              <TextInput
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder="Write a comment..."
                placeholderTextColor={THEME.muted}
                className="min-w-0 flex-1 rounded-full border bg-white px-3 py-2 text-sm text-gray-900"
                style={{ borderColor: THEME.border }}
              />
              <TouchableOpacity
                onPress={() => void submitComment()}
                disabled={isCommenting || !commentDraft.trim()}
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: commentDraft.trim() ? THEME.primary : '#FDBA74' }}
                accessibilityLabel="Send comment"
              >
                {isCommenting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Send size={15} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

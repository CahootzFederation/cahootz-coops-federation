import React from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Alert, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Image as ImageIcon, Send, Trash2, UserCircle } from 'lucide-react-native';

import {
  COMPOSER_MEDIA_TILE_SIZE,
  CommonsMediaTile,
  CommonsMediaViewer,
  type CommonsMediaPreview,
} from '@/components/commons-media-viewer';
import { PersonalPagePostCard } from '@/components/personal-page-post-card';
import { PostTypeSelector } from '@/components/post-type-selector';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type PersonalPageFeedPost, type PersonalPageProfile } from '@/lib/api';
import { DEFAULT_POST_TYPE, postTypePlaceholder, type SelectedPostType } from '@/lib/post-types';
import { personDisplayHandle, personHandleFromName, personInitials } from '@/lib/social-profile';

const PAGE_THEME = {
  paper: '#F6F7F8',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  ink: '#111827',
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function PersonalPageScreen() {
  const { user, isLoading, isAuthenticated, sessionToken } = useAuth();
  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Member';
  const publicHandle = user?.handle || personHandleFromName(displayName);
  const [posts, setPosts] = React.useState<PersonalPageFeedPost[]>([]);
  const [profile, setProfile] = React.useState<PersonalPageProfile | null>(null);
  const [following, setFollowing] = React.useState<{ id: string; name: string; handle: string }[]>([]);
  const [draft, setDraft] = React.useState('');
  const [selectedType, setSelectedType] = React.useState<SelectedPostType>(DEFAULT_POST_TYPE);
  const [selectedMedia, setSelectedMedia] = React.useState<CommonsMediaPreview[]>([]);
  const [viewerMedia, setViewerMedia] = React.useState<CommonsMediaPreview | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [deletingPostId, setDeletingPostId] = React.useState<string | null>(null);
  const [nextPostsCursor, setNextPostsCursor] = React.useState<string | null>(null);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = React.useState(false);

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;

    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  React.useEffect(() => {
    if (!user?.email || !sessionToken) return;

    Promise.all([api.getPersonalPage(publicHandle, sessionToken), api.listFollowing(sessionToken)])
      .then(([page, followingResult]) => {
        setPosts(page.posts);
        setProfile(page.profile);
        setNextPostsCursor(page.nextCursor);
        setFollowing(followingResult.members);
      })
      .catch((error) => console.warn('Could not load personal page data:', error));
  }, [publicHandle, sessionToken, user?.email]);

  const loadMorePosts = async () => {
    if (!nextPostsCursor || isLoadingMorePosts || !sessionToken) return;

    setIsLoadingMorePosts(true);
    try {
      const page = await api.getPersonalPage(publicHandle, sessionToken, nextPostsCursor);
      setPosts((current) => [...current, ...page.posts]);
      setNextPostsCursor(page.nextCursor);
    } catch (error) {
      console.error('Failed to load more page posts:', error);
    } finally {
      setIsLoadingMorePosts(false);
    }
  };

  const handleScroll = (event: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 400) {
      void loadMorePosts();
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)' as any);
  };

  const pickMedia = async () => {
    if (selectedMedia.length >= 4) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 4 - selectedMedia.length,
      quality: 0.9,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });

    if (result.canceled) return;

    const next = result.assets.map((asset) => ({
      uri: asset.uri,
      mediaType: asset.type === 'video' ? 'video' as const : 'image' as const,
      mimeType: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      fileName: asset.fileName,
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration ?? null,
      sizeBytes: asset.fileSize ?? null,
    }));

    setSelectedMedia((current) => [...current, ...next].slice(0, 4));
  };

  const publishPost = async () => {
    const trimmed = draft.trim();
    if ((!trimmed && selectedMedia.length === 0) || isSaving) return;

    setIsSaving(true);
    try {
      const uploadedMedia = selectedMedia.length
        ? await Promise.all(
            selectedMedia.map((media) =>
              api.uploadCommonsPostMedia({
                coopId: 'personal-page',
                uri: media.uri || media.url || '',
                fileName: media.fileName,
                mimeType: media.mimeType,
                mediaType: media.mediaType,
                width: media.width,
                height: media.height,
                durationMs: media.durationMs,
                sizeBytes: media.sizeBytes,
              })
            )
          )
        : [];
      const result = await api.createPersonalPagePost(
        {
          content: trimmed,
          tag: selectedType,
          media: uploadedMedia,
        },
        sessionToken
      );
      setPosts((current) => [result.post, ...current]);
      setDraft('');
      setSelectedType(DEFAULT_POST_TYPE);
      setSelectedMedia([]);
    } finally {
      setIsSaving(false);
    }
  };

  const deletePost = (postId: string) => {
    if (deletingPostId) return;

    Alert.alert('Delete post?', 'This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingPostId(postId);
          try {
            await api.deletePersonalPagePost(postId, sessionToken);
            setPosts((current) => current.filter((post) => post.id !== postId));
          } catch (error) {
            Alert.alert('Could not delete post', error instanceof Error ? error.message : 'Please try again.');
          } finally {
            setDeletingPostId(null);
          }
        },
      },
    ]);
  };

  if (isLoading || !isAuthenticated || !sessionToken) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <ActivityIndicator size="small" color={PAGE_THEME.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: PAGE_THEME.paper }}>
      <View className="border-b bg-white px-3 pt-3 pb-2" style={{ borderColor: PAGE_THEME.border }}>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full border bg-white"
            style={{ borderColor: PAGE_THEME.border }}
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={18} color={PAGE_THEME.ink} strokeWidth={2.6} />
          </TouchableOpacity>
          <View className="min-w-0 flex-1">
            <Text className="text-[10px] font-black uppercase text-gray-500">Personal Page</Text>
            <Text className="text-base font-black text-gray-950" numberOfLines={1}>
              {personDisplayHandle(publicHandle)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: '/people/[handle]',
                params: {
                  handle: publicHandle,
                  name: displayName,
                },
              } as any)
            }
            className="h-9 w-9 items-center justify-center rounded-xl"
            style={{ backgroundColor: PAGE_THEME.primary }}
            accessibilityLabel="View public personal page"
          >
            <UserCircle size={17} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        scrollEventThrottle={200}
      >
        <View className="px-4 py-3">
          <View className="rounded-[28px] border bg-white p-4" style={{ borderColor: PAGE_THEME.border }}>
            <View className="flex-row items-center gap-3">
              <View className="h-14 w-14 items-center justify-center rounded-2xl bg-slate-200">
                <Text className="text-lg font-black text-slate-700">{personInitials(displayName)}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xl font-black text-gray-950" numberOfLines={1}>{displayName}</Text>
                <Text className="mt-0.5 text-sm font-semibold text-gray-500">{personDisplayHandle(publicHandle)}</Text>
              </View>
              <View className="rounded-full bg-gray-100 px-3 py-1.5">
                <Text className="text-xs font-black text-gray-700">{posts.length} posts</Text>
              </View>
            </View>
            {profile ? (
              <View className="mt-3 flex-row gap-4">
                <Text className="text-xs font-bold text-gray-600">
                  <Text className="font-black text-gray-950">{profile.followerCount}</Text> followers
                </Text>
                <Text className="text-xs font-bold text-gray-600">
                  <Text className="font-black text-gray-950">{profile.followingCount}</Text> following
                </Text>
              </View>
            ) : null}
          </View>

          <View className="mt-3 rounded-[28px] border bg-white p-4" style={{ borderColor: PAGE_THEME.border }}>
            {selectedMedia.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                <View className="flex-row gap-2">
                  {selectedMedia.map((media, index) => (
                    <View
                      key={`${media.uri}-${index}`}
                      className="overflow-hidden rounded-xl border border-gray-100 bg-white"
                      style={{ width: COMPOSER_MEDIA_TILE_SIZE, height: COMPOSER_MEDIA_TILE_SIZE }}
                    >
                      <CommonsMediaTile media={media} size={COMPOSER_MEDIA_TILE_SIZE} />
                      <TouchableOpacity
                        onPress={() => setSelectedMedia((current) => current.filter((_, itemIndex) => itemIndex !== index))}
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

            <View className="mb-2 flex-row items-center justify-between">
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-200">
                  <Text className="text-xs font-black text-slate-700">{personInitials(displayName)}</Text>
                </View>
                <Text className="min-w-0 text-xs font-black text-slate-600" numberOfLines={1}>
                  Posting to My Personal Page
                </Text>
              </View>
              <PostTypeSelector value={selectedType} onChange={setSelectedType} />
            </View>

            <View className="flex-row items-start gap-2">
              <View className="min-w-0 flex-1 rounded-2xl border bg-gray-50 px-3 py-2" style={{ borderColor: PAGE_THEME.border }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={postTypePlaceholder(selectedType)}
                  placeholderTextColor={PAGE_THEME.muted}
                  multiline
                  className="max-h-24 min-h-10 text-sm text-gray-900"
                  style={{ textAlignVertical: 'top' }}
                />
                <View className="mt-2 flex-row items-center justify-end gap-2">
                  <TouchableOpacity
                    onPress={() => void pickMedia()}
                    className="h-8 w-8 items-center justify-center rounded-full bg-gray-100"
                    activeOpacity={0.75}
                    accessibilityLabel="Attach photo or video"
                  >
                    <ImageIcon size={16} color="#475569" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void publishPost()}
                    disabled={isSaving || (!draft.trim() && selectedMedia.length === 0)}
                    className="h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: PAGE_THEME.primary,
                      opacity: isSaving || (!draft.trim() && selectedMedia.length === 0) ? 0.55 : 1,
                    }}
                    activeOpacity={0.82}
                    accessibilityLabel="Post to personal page"
                  >
                    {isSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Send size={16} color="#FFFFFF" fill="#FFFFFF" />}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          <View className="mt-4 gap-4">
            {posts.length === 0 ? (
              <View className="rounded-[28px] border border-dashed border-gray-300 bg-white p-5">
                <Text className="text-base font-black text-gray-950">No page posts yet</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  Post to your page so people can check out what you are building, offering, or talking about.
                </Text>
              </View>
            ) : null}

            {posts.map((post) => (
              <PersonalPagePostCard
                key={post.id}
                post={post}
                sessionToken={sessionToken}
                currentUserId={user?.id}
                onChange={(updated) =>
                  setPosts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
                }
                onDeletePost={() => deletePost(post.id)}
                isDeletingPost={deletingPostId === post.id}
                onMediaPress={setViewerMedia}
                header={
                  <View className="mb-3 flex-row items-center gap-2.5">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-slate-200">
                      <Text className="text-sm font-black text-slate-600">{personInitials(displayName)}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-black text-gray-950">{displayName}</Text>
                      <Text className="text-xs font-semibold text-slate-500">
                        {personDisplayHandle(publicHandle)} · {post.time || formatDate(post.createdAt)}
                      </Text>
                    </View>
                  </View>
                }
              />
            ))}
            {isLoadingMorePosts ? (
              <View className="items-center py-4">
                <ActivityIndicator size="small" color={PAGE_THEME.primary} />
              </View>
            ) : null}
          </View>

          {following.length > 0 ? (
            <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: PAGE_THEME.border }}>
              <Text className="text-sm font-black text-gray-950">Following</Text>
              {following.slice(0, 8).map((member) => (
                <TouchableOpacity
                  key={member.id}
                  onPress={() =>
                    router.push({
                      pathname: '/people/[handle]',
                      params: { handle: member.handle, name: member.name },
                    } as any)
                  }
                >
                  <Text className="py-1 text-sm font-semibold text-gray-700">{member.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <CommonsMediaViewer media={viewerMedia} onClose={() => setViewerMedia(null)} />
    </SafeAreaView>
  );
}

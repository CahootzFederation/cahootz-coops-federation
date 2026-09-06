import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Heart,
  MessageCircle,
  UserCircle,
} from 'lucide-react-native';

import {
  CommonsMediaTile,
  FEED_MEDIA_TILE_SIZE,
} from '@/components/commons-media-viewer';
import { PersonalPagePostCard } from '@/components/personal-page-post-card';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsPost, type PersonalPageFeedPost, type PersonalPageProfile } from '@/lib/api';
import { postTypeLabel, shouldShowPostType } from '@/lib/post-types';
import { personDisplayHandle, personHandleFromName, personInitials, postBelongsToHandle } from '@/lib/social-profile';

const THEME = {
  paper: '#F6F7F8',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  ink: '#111827',
  muted: '#64748B',
};

export default function PublicPersonPageScreen() {
  const params = useLocalSearchParams<{ handle?: string; name?: string }>();
  const routeHandle = personHandleFromName(params.handle);
  const routeName = typeof params.name === 'string' ? params.name : '';
  const { isAuthenticated, user } = useAuth();
  const sessionToken = user?.sessionToken || null;

  const [posts, setPosts] = useState<CommonsPost[]>([]);
  const [pagePosts, setPagePosts] = useState<PersonalPageFeedPost[]>([]);
  const [profile, setProfile] = useState<PersonalPageProfile | null>(null);
  const [followsPerson, setFollowsPerson] = useState(false);
  const [isFollowBusy, setIsFollowBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    setIsLoading(true);
    setError('');
    Promise.all([
      api.getPersonalPage(routeHandle, sessionToken),
      api.listCommonsFeed('all', sessionToken),
    ])
      .then(([page, result]) => {
        if (!mounted) return;
        setProfile(page.profile);
        setFollowsPerson(page.profile.viewerIsFollowing);
        setPagePosts(page.posts);
        setPosts(result.posts.filter((post) => postBelongsToHandle(post, routeHandle)));
      })
      .catch((caughtError) => {
        console.error('Could not load personal page:', caughtError);
        if (mounted) setError(caughtError instanceof Error ? caughtError.message : 'Could not load this page.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [routeHandle, sessionToken]);

  const profileName = useMemo(() => {
    return profile?.name || routeName || pagePosts[0]?.author || posts[0]?.author || routeHandle;
  }, [pagePosts, posts, profile?.name, routeHandle, routeName]);

  const isOwnPage = user?.handle ? user.handle === routeHandle : false;
  const totalPostCount = pagePosts.length + posts.length;
  const supportCount = posts.reduce((total, post) => total + post.support, 0);
  const replyCount = posts.reduce((total, post) => total + post.replies, 0);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)' as any);
  };

  const handleFollow = async () => {
    if (!isAuthenticated || !sessionToken) {
      router.push({ pathname: '/', params: { entry: 'sign-in' } } as any);
      return;
    }
    if (!profile || isFollowBusy) return;

    setIsFollowBusy(true);
    try {
      const result = await api.toggleFollowUser(profile.id, sessionToken);
      setFollowsPerson(result.following);
      setProfile((current) =>
        current
          ? {
              ...current,
              followerCount: Math.max(0, current.followerCount + (result.following ? 1 : -1)),
            }
          : current
      );
    } catch (caughtError) {
      console.error('Failed to update follow:', caughtError);
    } finally {
      setIsFollowBusy(false);
    }
  };

  const openPost = (post: CommonsPost) => {
    router.push({
      pathname: '/[coopId]/posts/[postId]',
      params: {
        coopId: post.coopId || 'cahootz',
        postId: post.id,
      },
    } as any);
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <View className="border-b bg-white px-3 pt-3 pb-2" style={{ borderColor: THEME.border }}>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full border bg-white"
            style={{ borderColor: THEME.border }}
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={18} color={THEME.ink} strokeWidth={2.6} />
          </TouchableOpacity>
          <View className="min-w-0 flex-1">
            <Text className="text-[10px] font-black uppercase text-gray-500">Personal Page</Text>
            <Text className="text-base font-black text-gray-950" numberOfLines={1}>
              {personDisplayHandle(routeHandle)}
            </Text>
          </View>
          <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: THEME.primary }}>
            <UserCircle size={17} color="#FFFFFF" />
          </View>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-5 py-4">
          <View className="rounded-2xl border bg-white p-5" style={{ borderColor: THEME.border }}>
            <View className="flex-row items-start gap-4">
              <View className="h-16 w-16 items-center justify-center rounded-2xl bg-slate-200">
                <Text className="text-xl font-black text-slate-700">{personInitials(profileName)}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-2xl font-black text-gray-950" numberOfLines={1}>
                  {profileName}
                </Text>
                <Text className="mt-1 text-sm font-semibold text-gray-500">{personDisplayHandle(routeHandle)}</Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <Metric label="Posts" value={String(totalPostCount)} />
                  <Metric label="Followers" value={String(profile?.followerCount ?? 0)} />
                  <Metric label="Following" value={String(profile?.followingCount ?? 0)} />
                  <Metric label="Likes" value={String(supportCount)} />
                  <Metric label="Replies" value={String(replyCount)} />
                </View>
              </View>
            </View>

            {isOwnPage ? (
              <TouchableOpacity
                onPress={() => router.push('/(authenticated)/personal-page' as any)}
                className="mt-4 rounded-2xl py-3"
                style={{ backgroundColor: THEME.primarySoft }}
                activeOpacity={0.82}
              >
                <Text className="text-center text-sm font-black" style={{ color: THEME.primary }}>
                  Edit Home Base
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => void handleFollow()}
                disabled={isFollowBusy}
                className="mt-4 rounded-2xl border py-3"
                style={{
                  borderColor: followsPerson ? THEME.primary : THEME.border,
                  backgroundColor: followsPerson ? THEME.primarySoft : THEME.primary,
                  opacity: isFollowBusy ? 0.6 : 1,
                }}
                activeOpacity={0.82}
              >
                {isFollowBusy ? (
                  <ActivityIndicator size="small" color={followsPerson ? THEME.primary : '#FFFFFF'} />
                ) : (
                  <Text className="text-center text-sm font-black" style={{ color: followsPerson ? THEME.primary : '#FFFFFF' }}>
                    {followsPerson ? 'Following' : 'Follow'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {error ? (
            <View className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
              <Text className="text-sm font-black text-red-700">{error}</Text>
            </View>
          ) : null}

          <View className="mt-4 gap-3">
            {isLoading ? (
              <View className="items-center rounded-2xl border bg-white p-6" style={{ borderColor: THEME.border }}>
                <ActivityIndicator size="small" color={THEME.primary} />
                <Text className="mt-2 text-sm font-semibold text-gray-500">Loading page...</Text>
              </View>
            ) : null}

            {!isLoading && pagePosts.length === 0 && posts.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-gray-300 bg-white p-5">
                <FileText size={18} color={THEME.primary} />
                <Text className="mt-3 text-base font-black text-gray-950">No public posts yet</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  When this person posts to their page or into a commons, those posts will collect here.
                </Text>
              </View>
            ) : null}

            {pagePosts.map((post) => (
              <PersonalPagePostCard
                key={post.id}
                post={post}
                sessionToken={sessionToken}
                currentUserId={user?.id}
                onChange={(updated) =>
                  setPagePosts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
                }
              />
            ))}

            {posts.map((post) => (
              <TouchableOpacity
                key={post.id}
                onPress={() => openPost(post)}
                className="overflow-hidden rounded-2xl border bg-white"
                style={{ borderColor: THEME.border }}
                activeOpacity={0.78}
              >
                <View className="p-4">
                  <View className="flex-row items-center justify-between gap-3">
                    {shouldShowPostType(post.tag) ? (
                      <View className="self-start rounded-full px-2.5 py-1" style={{ backgroundColor: THEME.primarySoft }}>
                        <Text className="text-[10px] font-black" style={{ color: THEME.primary }}>
                          {postTypeLabel(post.tag)}
                        </Text>
                      </View>
                    ) : (
                      <Text className="text-xs font-black text-gray-400">Commons</Text>
                    )}
                    <Text className="text-xs font-semibold text-gray-400">{post.time}</Text>
                  </View>
                  {post.title && post.title !== post.body ? (
                    <Text className="mt-3 text-base font-black leading-5 text-gray-950">{post.title}</Text>
                  ) : null}
                  {post.body ? <Text className="mt-2 text-sm leading-5 text-gray-700">{post.body}</Text> : null}
                  <Text className="mt-3 text-xs font-black text-gray-400">{post.group}</Text>
                </View>

                {post.media.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="border-y border-gray-100 bg-gray-50">
                    <View className="flex-row gap-2 p-2">
                      {post.media.map((media) => (
                        <View key={media.id || media.url} className="overflow-hidden rounded-2xl bg-gray-200">
                          <CommonsMediaTile media={media} size={post.media.length === 1 ? 286 : FEED_MEDIA_TILE_SIZE} />
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                ) : null}

                <View className="flex-row border-t border-gray-100 px-4 py-3">
                  <View className="flex-1 flex-row items-center justify-center gap-2">
                    <Heart size={15} color={THEME.muted} />
                    <Text className="text-xs font-black text-gray-600">{post.support}</Text>
                  </View>
                  <View className="flex-1 flex-row items-center justify-center gap-2">
                    <MessageCircle size={15} color={THEME.muted} />
                    <Text className="text-xs font-black text-gray-600">{post.replies}</Text>
                  </View>
                  <View className="flex-1 flex-row items-center justify-center gap-2">
                    <CheckCircle2 size={15} color={THEME.muted} />
                    <Text className="text-xs font-black text-gray-600">{post.classification || 'post'}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="rounded-full bg-gray-100 px-3 py-1.5">
      <Text className="text-xs font-black text-gray-900">
        {value} <Text className="text-xs font-bold text-gray-500">{label}</Text>
      </Text>
    </View>
  );
}

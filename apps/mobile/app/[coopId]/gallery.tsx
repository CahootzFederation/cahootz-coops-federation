import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Image as ImageIcon, Play } from 'lucide-react-native';

import { CommonsMediaViewer } from '@/components/commons-media-viewer';
import { LoadError } from '@/components/load-error';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsGalleryItem } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

const COLUMNS = 3;
const GAP = 2;
const MAX_GRID_WIDTH = 720;

// Every photo and video posted publicly in a commons (its General feed and
// public circles), as a tappable grid.
export default function CommonsGalleryScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || 'cahootz';
  const { sessionToken, isLoading: authLoading } = useAuth();
  const { width } = useWindowDimensions();
  const gridWidth = Math.min(width, MAX_GRID_WIDTH);
  const tileSize = Math.floor((gridWidth - GAP * (COLUMNS - 1)) / COLUMNS);

  const [commonsName, setCommonsName] = useState<string | null>(null);
  const [items, setItems] = useState<CommonsGalleryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<CommonsGalleryItem | null>(null);

  useEffect(() => {
    // Wait for the saved session to load; asking without it is refused.
    if (authLoading) return;
    let mounted = true;
    setIsLoading(true);
    setError(null);
    api
      .listCommonsMedia(coopId, sessionToken)
      .then((result) => {
        if (!mounted) return;
        setCommonsName(result.commonsName);
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((caughtError) => {
        console.error('Failed to load commons gallery:', caughtError);
        if (mounted) setError(friendlyError(caughtError, "We couldn't load this commons' photos and videos."));
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [coopId, sessionToken, authLoading, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const result = await api.listCommonsMedia(coopId, sessionToken, nextCursor);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(result.nextCursor);
    } catch (caughtError) {
      console.error('Failed to load more commons media:', caughtError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [coopId, sessionToken, nextCursor, isLoadingMore]);

  const openPost = (item: CommonsGalleryItem) => {
    setSelected(null);
    router.push({ pathname: '/[coopId]/posts/[postId]', params: { coopId, postId: item.postId } } as any);
  };

  const renderTile = ({ item, index }: { item: CommonsGalleryItem; index: number }) => (
    <TouchableOpacity
      onPress={() => setSelected(item)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.mediaType === 'video' ? 'video' : 'photo'} from ${item.author}: ${item.postTitle}`}
      style={{
        width: tileSize,
        height: tileSize,
        marginRight: index % COLUMNS === COLUMNS - 1 ? 0 : GAP,
        marginBottom: GAP,
      }}
    >
      {item.mediaType === 'video' ? (
        <View className="flex-1 items-center justify-center bg-gray-900">
          <Play size={28} color="#FFFFFF" fill="#FFFFFF" />
        </View>
      ) : (
        <ExpoImage
          source={{ uri: item.url }}
          contentFit="cover"
          style={{ width: tileSize, height: tileSize, backgroundColor: '#E5E7EB' }}
        />
      )}
    </TouchableOpacity>
  );

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-gray-200 bg-white px-4 pt-14 pb-3">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => router.back()}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color="#111827" />
          </TouchableOpacity>
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-black uppercase text-gray-500" numberOfLines={1}>
              {commonsName || 'Commons'}
            </Text>
            <Text className="text-xl font-black text-gray-950">Gallery</Text>
          </View>
        </View>
      </View>

      {isLoading && items.length === 0 ? (
        <View className="items-center py-10">
          <ActivityIndicator size="small" color="#FF6B00" />
        </View>
      ) : error ? (
        <View className="px-5 pt-6">
          <LoadError message={error} onRetry={() => setReloadKey((key) => key + 1)} retrying={isLoading} />
        </View>
      ) : items.length === 0 ? (
        <View className="items-center px-8 py-16">
          <ImageIcon size={36} color="#9CA3AF" />
          <Text className="mt-3 text-center text-base font-bold text-gray-900">No photos or videos yet</Text>
          <Text className="mt-1 text-center text-sm text-gray-500">
            Photos and videos posted in General and public circles will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          testID="commons-gallery-grid"
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderTile}
          numColumns={COLUMNS}
          style={{ alignSelf: 'center', width: gridWidth }}
          contentContainerStyle={{ paddingBottom: 32 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? (
              <View className="items-center py-4">
                <ActivityIndicator size="small" color="#FF6B00" />
              </View>
            ) : null
          }
        />
      )}

      <CommonsMediaViewer
        media={selected}
        onClose={() => setSelected(null)}
        footer={
          selected ? (
            <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-black/60 px-4 py-3">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-bold text-white" numberOfLines={1}>
                  {selected.author}
                </Text>
                <Text className="text-xs text-white/80" numberOfLines={1}>
                  {selected.circleName ? `${selected.circleName} · ` : 'General · '}
                  {selected.postTitle}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => openPost(selected)}
                className="rounded-xl bg-white px-4 py-2"
                accessibilityRole="button"
                accessibilityLabel="View post"
              >
                <Text className="text-sm font-black text-gray-950">View post</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </View>
  );
}

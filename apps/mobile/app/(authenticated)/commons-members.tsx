import type { CommonsMember } from '@/lib/api';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ChevronRight, Search, Users } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { IconAvatar } from '@/components/icon-avatar';
import { LoadError } from '@/components/load-error';
import { PersonLink } from '@/components/person-link';
import { keyboardInsetScrollProps } from '@/lib/keyboard';

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  inkSoft: '#1F2937',
  white: '#FFFFFF',
};

const PAGE_SIZE = 50;

/** Everyone who is an active member of a Commons, by name. Sage isn't listed. */
export default function CommonsMembersScreen() {
  const { coopId, coopName } = useLocalSearchParams<{
    coopId: string;
    coopName?: string;
  }>();
  const { sessionToken } = useAuth();
  const [members, setMembers] = React.useState<CommonsMember[]>([]);
  const [totalCount, setTotalCount] = React.useState<number | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = React.useCallback(() => {
    if (!coopId || !sessionToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listCommonsMembers(coopId, sessionToken, PAGE_SIZE, {
        sort: 'name',
        search: debouncedSearch,
      })
      .then((result) => {
        if (cancelled) return;
        setMembers(result.members);
        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(friendlyError(err, "We couldn't load the members."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coopId, sessionToken, debouncedSearch]);

  React.useEffect(() => load(), [load]);

  const loadMore = () => {
    if (!coopId || !sessionToken || !hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    api
      .listCommonsMembers(coopId, sessionToken, PAGE_SIZE, {
        sort: 'name',
        search: debouncedSearch,
        offset: members.length,
      })
      .then((result) => {
        setMembers((current) => {
          const seen = new Set(current.map((member) => member.id));
          return [
            ...current,
            ...result.members.filter((member) => !seen.has(member.id)),
          ];
        });
        setHasMore(result.hasMore);
      })
      .catch((err) => console.warn('Could not load more members:', err))
      .finally(() => setLoadingMore(false));
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({
      pathname: '/commons/[coopId]',
      params: { coopId },
    } as any);
  };

  const countLabel =
    totalCount === null
      ? ''
      : debouncedSearch
        ? `${totalCount} ${totalCount === 1 ? 'match' : 'matches'}`
        : `${totalCount} ${totalCount === 1 ? 'member' : 'members'}`;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <View
        className="border-b bg-white px-4 pb-3 pt-3"
        style={{ borderColor: THEME.border }}
      >
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={handleBack}
            className="h-10 w-10 items-center justify-center rounded-full border bg-white"
            style={{ borderColor: THEME.border }}
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={18} color={THEME.inkSoft} strokeWidth={2.6} />
          </TouchableOpacity>
          <View className="min-w-0 flex-1">
            <Text
              className="text-[10px] font-black uppercase tracking-wide text-gray-500"
              numberOfLines={1}
            >
              {coopName || 'Commons'}
            </Text>
            <Text className="text-lg font-black text-gray-950" numberOfLines={1}>
              Members
            </Text>
          </View>
          <View
            className="h-10 w-10 items-center justify-center rounded-2xl"
            style={{ backgroundColor: THEME.primary }}
          >
            <Users size={18} color={THEME.white} />
          </View>
        </View>

        <View
          className="mt-3 flex-row items-center gap-2 rounded-xl border bg-gray-50 px-3"
          style={{ borderColor: THEME.border }}
        >
          <Search size={16} color={THEME.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or handle"
            placeholderTextColor={THEME.muted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search members"
            className="flex-1 py-2.5 text-base text-gray-900"
          />
        </View>
      </View>

      {error && members.length === 0 ? (
        <View className="p-4">
          <LoadError message={error} retrying={loading} onRetry={load} />
        </View>
      ) : (
        <FlatList
          {...keyboardInsetScrollProps}
          data={members}
          keyExtractor={(member) => member.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            countLabel ? (
              <Text className="mb-1 text-sm font-bold text-gray-500">
                {countLabel}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={THEME.primary} />
            ) : (
              <Text className="text-sm leading-5 text-gray-600">
                {debouncedSearch
                  ? `No members match "${debouncedSearch}".`
                  : 'No members yet.'}
              </Text>
            )
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={THEME.primary} /> : null
          }
          renderItem={({ item: member }) => (
            <PersonLink
              name={member.name}
              handle={member.handle}
              className="flex-row items-center gap-3 rounded-xl border bg-white p-3"
              style={{ borderColor: THEME.border }}
            >
              <IconAvatar fallbackText={member.name} size={40} radius={20} />
              <View className="min-w-0 flex-1">
                <Text className="font-black text-gray-900" numberOfLines={1}>
                  {member.name}
                </Text>
                <Text
                  className="text-xs font-semibold text-gray-500"
                  numberOfLines={1}
                >
                  @{member.handle}
                </Text>
              </View>
              {member.isSteward ? (
                <View
                  className="rounded-full px-2 py-1"
                  style={{ backgroundColor: THEME.primarySoft }}
                >
                  <Text
                    className="text-xs font-black"
                    style={{ color: THEME.primary }}
                  >
                    Steward
                  </Text>
                </View>
              ) : null}
              <ChevronRight size={16} color={THEME.muted} />
            </PersonLink>
          )}
        />
      )}
    </SafeAreaView>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, ChevronRight, Home, Lock, Search, Users } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api, type CommonsDirectoryItem } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { LoadError } from '@/components/load-error';
import { useAuth } from '@/contexts/auth-context';
import { IconAvatar } from '@/components/icon-avatar';
import { CommonsInvitationsCard } from '@/components/commons-invitations-card';

const THEME = {
  paper: '#F6F7F8',
  ink: '#111827',
  muted: '#6B7280',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  greenSoft: '#ECFDF5',
  green: '#047857',
  blueSoft: '#EFF6FF',
  blue: '#1D4ED8',
  redSoft: '#FEF2F2',
  red: '#B91C1C',
  border: '#E5E7EB',
};

function statusTone(status: CommonsDirectoryItem['accessStatus'], commons?: CommonsDirectoryItem) {
  if (status === 'ACTIVE') {
    return { label: commons?.isSteward ? 'Steward' : 'Member', bg: THEME.greenSoft, fg: THEME.green };
  }
  if (status === 'PENDING') return { label: 'Pending', bg: THEME.blueSoft, fg: THEME.blue };
  if (status === 'REJECTED') return { label: 'Closed', bg: THEME.redSoft, fg: THEME.red };
  return { label: 'Locked', bg: THEME.primarySoft, fg: THEME.primary };
}

function CommonsCard({ commons }: { commons: CommonsDirectoryItem }) {
  const tone = statusTone(commons.accessStatus, commons);
  const canBrowseCircles = commons.isMember || !commons.isLocked;

  const openCommons = () => {
    if (canBrowseCircles) {
      router.replace({ pathname: '/(tabs)', params: { coopId: commons.id } } as any);
      return;
    }
    router.push(`/commons/${commons.id}` as any);
  };

  return (
    <TouchableOpacity
      onPress={openCommons}
      className="rounded-2xl border bg-white p-4"
      style={{ borderColor: commons.isMember ? THEME.primary : THEME.border }}
      activeOpacity={0.76}
      accessibilityRole="button"
      accessibilityLabel={canBrowseCircles ? `Open ${commons.name} circles` : `View ${commons.name} details`}
    >
      <View className="flex-row items-start gap-3">
        {commons.isLocked ? (
          <View
            className="h-12 w-12 items-center justify-center rounded-2xl"
            style={{ backgroundColor: '#111827' }}
          >
            <Lock size={20} color="#FFFFFF" />
          </View>
        ) : (
          <IconAvatar
            emoji={commons.iconEmoji}
            color={commons.iconColor || THEME.primary}
            fallbackText={commons.name}
            size={48}
          />
        )}
        <View className="min-w-0 flex-1">
          <View className="mb-1 flex-row items-start justify-between gap-2">
            <Text className="min-w-0 flex-1 text-lg font-black text-gray-950">{commons.name}</Text>
            <View className="rounded-full px-2 py-1" style={{ backgroundColor: tone.bg }}>
              <Text className="text-xs font-black" style={{ color: tone.fg }}>{tone.label}</Text>
            </View>
          </View>
          {commons.tagline ? <Text className="text-sm font-bold" style={{ color: THEME.primary }}>{commons.tagline}</Text> : null}
          <Text className="mt-2 text-sm leading-5 text-gray-600" numberOfLines={3}>
            {commons.description}
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row items-center justify-between border-t border-gray-100 pt-3">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-bold" style={{ color: commons.canApply ? THEME.primary : THEME.muted }}>
            {canBrowseCircles
              ? commons.isMember
                ? 'View circles'
                : 'Browse circles'
              : commons.canApply
                ? 'View and apply'
                : 'View status'}
          </Text>
          {commons.isMember && (commons.circleCount || 0) > 0 ? (
            <View className="flex-row items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: THEME.primarySoft }}>
              <Users size={11} color={THEME.primary} />
              <Text className="text-xs font-black" style={{ color: THEME.primary }}>
                {commons.circleCount} {commons.circleCount === 1 ? 'circle' : 'circles'}
              </Text>
            </View>
          ) : null}
        </View>
        <ChevronRight size={18} color={commons.canApply || commons.isMember ? THEME.primary : THEME.muted} />
      </View>
    </TouchableOpacity>
  );
}

export default function CommonsDirectoryScreen() {
  const { sessionToken, user } = useAuth();
  const [commons, setCommons] = useState<CommonsDirectoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        if (!mounted) return;
        setCommons(result.coops);
        setError('');
      })
      .catch((err) => {
        console.error('Failed to load commons directory:', err);
        if (mounted) setError(friendlyError(err, "We couldn't load the list of commons."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [sessionToken, reloadKey]);

  const filteredCommons = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return commons;
    return commons.filter((item) =>
      [item.name, item.shortName, item.tagline, item.description, item.mission, item.eligibility]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(text)
    );
  }, [commons, query]);

  const yourCommons = filteredCommons.filter((item) => item.isMember);
  const availableCommons = filteredCommons.filter((item) => !item.isMember);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pb-4 pt-2">
          <View className="mb-4 flex-row items-center justify-between">
            <TouchableOpacity
              onPress={() => router.back()}
              className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={20} color={THEME.ink} />
            </TouchableOpacity>
            <View className="min-w-0 flex-1 px-3">
              <Text className="text-xs font-black uppercase text-gray-500">Commons</Text>
              <Text className="text-2xl font-black text-gray-950">Browse commons</Text>
            </View>
            <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: THEME.primary }}>
              <Users size={21} color="#FFFFFF" />
            </View>
          </View>

          <View className="flex-row items-center gap-2 rounded-xl bg-white px-3 py-2">
            <Search size={18} color={THEME.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search commons"
              placeholderTextColor={THEME.muted}
              className="h-10 flex-1 text-base text-gray-900"
              autoCapitalize="none"
            />
          </View>
        </View>

        <View className="px-4">
          {user ? (
            <View className="mb-5 gap-3">
              <CommonsInvitationsCard />
              <TouchableOpacity
                onPress={() => router.push('/(authenticated)/create-family' as any)}
                className="flex-row items-center gap-3 rounded-2xl border border-dashed bg-white p-4"
                style={{ borderColor: THEME.primaryBorder }}
                accessibilityRole="button"
                accessibilityLabel="Start a family"
              >
                <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: THEME.primarySoft }}>
                  <Home size={20} color={THEME.primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-black text-gray-950">Start a family</Text>
                  <Text className="text-sm leading-5 text-gray-600">
                    A private, invite-only space for your family.
                  </Text>
                </View>
                <ChevronRight size={18} color={THEME.primary} />
              </TouchableOpacity>
            </View>
          ) : null}

          {loading ? (
            <View className="rounded-2xl border border-gray-200 bg-white p-5">
              <ActivityIndicator color={THEME.primary} />
              <Text className="mt-3 text-center text-sm font-semibold text-gray-500">Loading commons...</Text>
            </View>
          ) : null}

          {error && !loading ? (
            <View className="mb-3">
              <LoadError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
            </View>
          ) : null}

          {yourCommons.length > 0 ? (
            <>
              <Text className="mb-2 text-xs font-black uppercase tracking-wide text-gray-500">Your commons</Text>
              <View className="mb-5 gap-3">
                {yourCommons.map((item) => <CommonsCard key={item.id} commons={item} />)}
              </View>
            </>
          ) : null}

          <Text className="mb-2 text-xs font-black uppercase tracking-wide text-gray-500">Other commons</Text>
          <View className="gap-3">
            {availableCommons.map((item) => <CommonsCard key={item.id} commons={item} />)}
            {!loading && !error && filteredCommons.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-gray-300 bg-white p-5">
                <Text className="text-base font-black text-gray-900">No commons found</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">Try a different search.</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

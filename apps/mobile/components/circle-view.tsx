import type { PrivateGroupSummary } from '@/lib/api';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { useRefreshOnReconnect } from '@/hooks/use-connectivity';
import { api } from '@/lib/api';
import { DESIGN } from '@/constants/design';
import { Input } from '@/components/ui/input';
import { circleColorFromKey } from '@/lib/circle-color';
import { secureStorage } from '@/lib/secure-storage';
import { track } from '@/lib/analytics';
import { CommonsHeader, useCommonsDirectory } from '@/components/commons-header';
import { CommonsInvitationsCard } from '@/components/commons-invitations-card';
import { LoadError } from '@/components/load-error';
import { friendlyError } from '@/lib/friendly-error';
import { MessageCircle, Settings2, LogIn } from 'lucide-react-native';

const THEME = { ...DESIGN, primary: DESIGN.actionText };

type CircleCard = PrivateGroupSummary | { general: true };

function isGeneral(card: CircleCard): card is { general: true } {
  return 'general' in card;
}

export default function CircleView({ coopId, onBackToStreet }: { coopId: string; onBackToStreet?: () => void }) {
  const { sessionToken } = useAuth();
  const directory = useCommonsDirectory(coopId);
  const { activeCommonsName } = directory;
  const [search, setSearch] = useState('');
  const [circles, setCircles] = useState<PrivateGroupSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Shown under the grid when joining a circle or a welcome lounge fails.
  const [actionError, setActionError] = useState<string | null>(null);
  useRefreshOnReconnect(() => {
    setReloadKey((key) => key + 1);
    directory.reload();
  });

  // Single fetch per focus - no polling. Live updates are planned via
  // websockets later; until then "chatting" counts can go stale while you
  // sit on this screen, which is an accepted tradeoff for now.
  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) {
        setCircles([]);
        setLoadError(null);
        setIsLoading(false);
        return;
      }

      let mounted = true;
      setIsLoading(true);
      api
        .listVisibleCircles(sessionToken, coopId)
        .then((result) => {
          if (!mounted) return;
          setCircles(result?.groups || []);
          setLoadError(null);
        })
        .catch((err) => {
          console.error('Failed to load circles:', err);
          if (!mounted) return;
          // Keep circles from an earlier successful load, but say the
          // refresh failed instead of quietly showing an empty grid.
          setLoadError(friendlyError(err, "We couldn't load your circles."));
        })
        .finally(() => {
          if (mounted) setIsLoading(false);
        });

      return () => {
        mounted = false;
      };
    }, [coopId, sessionToken, reloadKey]),
  );

  const retryLoad = () => {
    setActionError(null);
    setReloadKey((key) => key + 1);
  };

  const openCircle = (circleId?: string) => {
    // Opening a circle reads it; clear its badge now rather than on the next load.
    if (circleId) {
      setCircles((current) => current.map((c) => (c.id === circleId ? { ...c, unreadCount: 0 } : c)));
    }
    router.replace({ pathname: '/[coopId]/posts', params: { coopId, circleId } } as any);
  };

  const joinPublicCircle = async (groupId: string) => {
    if (!sessionToken) return;
    setActionError(null);
    try {
      await api.joinPublicCircle(groupId, sessionToken);
      openCircle(groupId);
    } catch (err) {
      console.error('Failed to join circle:', err);
      setActionError(friendlyError(err, "We couldn't add you to that circle."));
    }
  };

  const joinWelcomeTable = async () => {
    if (isAssigning) return;

    if (!sessionToken) {
      // No account yet - remember the intent so profile-onboarding.tsx can
      // auto-join a table the moment the new account finishes signing up,
      // rather than making them tap this card again after creating one.
      await secureStorage.setItem(secureStorage.keys.WELCOME_TABLE_INTENT, '1');
      router.push({ pathname: '/', params: { entry: 'sign-in' } } as any);
      return;
    }

    setIsAssigning(true);
    setActionError(null);
    try {
      const result = await api.assignWelcomeTable(sessionToken, coopId);
      track('welcome_lounge_joined', { source: 'circle_view' });
      openCircle(result.groupId);
    } catch (err) {
      console.error('Failed to join welcome lounge:', err);
      setActionError(friendlyError(err, "We couldn't add you to a welcome lounge."));
    } finally {
      setIsAssigning(false);
    }
  };

  const openManageCircles = () => {
    router.push({ pathname: '/(authenticated)/spaces', params: { coopId } } as any);
  };

  const myWelcomeTable = circles.find((c) => c.kind === 'WELCOME_TABLE' && c.isMember);
  const memberCircles = circles.filter((c) => c.isMember && c.kind !== 'WELCOME_TABLE');
  const publicCircles = circles.filter((c) => !c.isMember && c.privacy === 'public');

  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const sections: { title: string; cards: CircleCard[] }[] = [
    { title: 'Your circles', cards: [{ general: true as const }, ...memberCircles, ...(myWelcomeTable ? [myWelcomeTable] : [])] },
    { title: 'Discover circles', cards: publicCircles },
  ].map((section) => ({ ...section, cards: section.cards.filter((card) => matches(isGeneral(card) ? 'General' : card.name)) }));

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <CommonsHeader
        coopId={coopId}
        directory={directory}
        switcherSubtitle="Choose a Commons to see its circles."
        right={sessionToken ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Manage circles"
            onPress={openManageCircles}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: THEME.primarySoft }}
          >
            <Settings2 size={18} color={THEME.primary} />
          </TouchableOpacity>
        ) : undefined}
      />

      <ScrollView
        testID="circle-view-scroll"
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 pt-2">
          {onBackToStreet ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to the street"
              onPress={onBackToStreet}
              className="mb-2 min-h-11 flex-row items-center self-start"
            >
              <Text className="text-sm font-bold" style={{ color: THEME.primary }}>‹ Back to the street</Text>
            </TouchableOpacity>
          ) : null}
          <Text className="text-2xl font-bold text-gray-950">Welcome In</Text>
          <Text className="mt-1 text-base font-semibold text-gray-500">
            Find your circle in {activeCommonsName}
          </Text>
        </View>

        {sessionToken ? (
          <View className="px-5 pt-4">
            <Input accessibilityLabel="Find a circle" placeholder="Find a circle" value={search} onChangeText={setSearch} style={{ minHeight: DESIGN.controlHeight, backgroundColor: DESIGN.paper }} />
            <CommonsInvitationsCard />
          </View>
        ) : null}

        {isLoading && circles.length === 0 && !loadError ? (
          <View className="items-center py-10">
            <ActivityIndicator size="small" color={THEME.primary} />
          </View>
        ) : loadError && circles.length === 0 ? (
          <View className="px-5 pt-6">
            <LoadError message={loadError} onRetry={retryLoad} retrying={isLoading} />
          </View>
        ) : (
          <View className="gap-5 px-5 pt-6">
            {loadError ? (
              <LoadError message={loadError} onRetry={retryLoad} retrying={isLoading} />
            ) : null}
            {sections.map((section) => section.cards.length > 0 ? (
            <View key={section.title}>
              <Text accessibilityRole="header" className="mb-5 text-base font-bold" style={{ color: THEME.ink }}>{section.title}</Text>
              <View className="flex-row flex-wrap justify-between gap-y-6">
              {section.cards.map((card) =>
                isGeneral(card) ? (
                  <CircleCardView
                    key="general"
                    name="General"
                    colorKey="blue"
                    chattingCount={0}
                    hideStatus
                    onPress={() => openCircle(undefined)}
                  />
                ) : (
                  <CircleCardView
                    key={card.id}
                    name={card.name}
                    colorKey={card.colorKey}
                    iconEmoji={card.iconEmoji}
                    iconColor={card.iconColor}
                    chattingCount={card.chattingCount}
                    unreadCount={card.isMember ? card.unreadCount ?? 0 : 0}
                    joinLabel={!card.isMember}
                    onPress={() => (card.isMember ? openCircle(card.id) : joinPublicCircle(card.id))}
                  />
                ),
              )}
              </View>
            </View>
            ) : null)}
            {search.trim() && sections.every((section) => section.cards.length === 0) ? (
              <Text style={{ color: THEME.muted }}>No circles match your search.</Text>
            ) : null}
            {!myWelcomeTable && !search.trim() ? (
              <View className="flex-row">
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={sessionToken ? 'Join a welcome lounge' : 'Sign in'}
                  disabled={isAssigning}
                  onPress={sessionToken ? joinWelcomeTable : () => router.push({ pathname: '/', params: { entry: 'sign-in' } } as any)}
                  className="items-center"
                  style={{ width: '47%' }}
                  activeOpacity={0.8}
                >
                  <View
                    className="h-24 w-24 items-center justify-center rounded-full border-2 border-dashed"
                    style={{ borderColor: THEME.primary, backgroundColor: THEME.primarySoft }}
                  >
                    {isAssigning ? (
                      <ActivityIndicator size="small" color={THEME.primary} />
                    ) : sessionToken ? (
                      <MessageCircle size={30} color={THEME.primary} />
                    ) : (
                      <LogIn size={30} color={THEME.primary} />
                    )}
                  </View>
                  <Text className="mt-3 text-center text-base font-bold text-gray-900">
                    {sessionToken ? 'Join a welcome lounge' : 'Sign in'}
                  </Text>
                  <Text className="mt-0.5 text-center text-xs font-semibold text-gray-500">
                    {sessionToken ? 'Meet a small group of newcomers' : 'Log in to join your commons'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {actionError ? (
              <Text accessibilityRole="alert" className="text-base font-bold text-red-700">
                {actionError}
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CircleCardView({
  name,
  colorKey,
  iconEmoji,
  iconColor,
  chattingCount,
  unreadCount = 0,
  joinLabel,
  hideStatus,
  onPress,
}: {
  name: string;
  colorKey: string;
  iconEmoji?: string | null;
  iconColor?: string | null;
  chattingCount: number;
  unreadCount?: number;
  joinLabel?: boolean;
  hideStatus?: boolean;
  onPress: () => void;
}) {
  const palette = circleColorFromKey(colorKey);
  const background = iconColor || palette.background;
  const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `${name}, ${unreadCount} new` : undefined}
      onPress={onPress}
      className="items-center"
      style={{ width: '47%' }}
      activeOpacity={0.8}
    >
      <View
        className="h-24 w-24 items-center justify-center rounded-full"
        style={{
          backgroundColor: background,

        }}
      >
        {iconEmoji ? (
          // Text's base `text-base` class pins lineHeight to 24, which clips a
          // 40px emoji - give it a line box tall enough for the glyph.
          <Text style={{ fontSize: 40, lineHeight: 52, textAlign: 'center' }}>{iconEmoji}</Text>
        ) : (
          <Text
            className="text-3xl font-bold"
            style={{ color: iconColor ? '#FFFFFF' : palette.foreground }}
          >
            {name.slice(0, 1).toUpperCase()}
          </Text>
        )}
        {unreadCount > 0 ? (
          <View
            testID="circle-unread-badge"
            className="absolute -right-1 -top-1 h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1.5"
          >
            <Text className="text-xs font-black text-white">{unreadLabel}</Text>
          </View>
        ) : null}
      </View>
      <Text className="mt-3 text-center text-sm font-bold text-gray-900">
        {name}
      </Text>
      {hideStatus ? null : (
        <View className="mt-1 flex-row items-center gap-1.5">
          {!joinLabel && chattingCount > 0 ? (
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: '#16A34A' }} />
          ) : null}
          <Text
            className="text-center text-xs font-semibold"
            style={{ color: !joinLabel && chattingCount > 0 ? '#16A34A' : THEME.primary }}
          >
            {joinLabel ? 'Join' : chattingCount > 0 ? `${chattingCount} chatting` : 'Joined'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

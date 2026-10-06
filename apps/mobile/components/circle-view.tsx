import type { CommonsDirectoryItem, PrivateGroupSummary } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { circleColorFromKey } from '@/lib/circle-color';
import { secureStorage } from '@/lib/secure-storage';
import { track } from '@/lib/analytics';
import AppDrawer from '@/components/app-drawer';
import { CommonsInvitationsCard } from '@/components/commons-invitations-card';
import { LoadError } from '@/components/load-error';
import { friendlyError } from '@/lib/friendly-error';
import { IconAvatar } from '@/components/icon-avatar';
import { CheckCircle2, ChevronDown, Compass, Menu, MessageCircle, Settings2, LogIn, X } from 'lucide-react-native';

const THEME = {
  ink: '#111827',
  muted: '#6B7280',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
};

type CircleCard = PrivateGroupSummary | { general: true };

function isGeneral(card: CircleCard): card is { general: true } {
  return 'general' in card;
}

export default function CircleView({ coopId }: { coopId: string }) {
  const { sessionToken } = useAuth();
  const [circles, setCircles] = useState<PrivateGroupSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Shown under the grid when joining a circle or a welcome lounge fails.
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commons, setCommons] = useState<CommonsDirectoryItem[]>([]);
  const [commonsLoading, setCommonsLoading] = useState(true);
  const [commonsError, setCommonsError] = useState('');
  const [commonsReloadKey, setCommonsReloadKey] = useState(0);
  const [switcherOpen, setSwitcherOpen] = useState(false);

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

  useEffect(() => {
    let mounted = true;
    setCommonsLoading(true);
    setCommonsError('');

    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        if (mounted) setCommons(result.coops);
      })
      .catch((err) => {
        console.error('Failed to load commons directory:', err);
        if (mounted) setCommonsError(friendlyError(err, "We couldn't load your commons."));
      })
      .finally(() => {
        if (mounted) setCommonsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [commonsReloadKey, sessionToken]);

  const retryLoad = () => {
    setActionError(null);
    setReloadKey((key) => key + 1);
  };

  const openCircle = (circleId?: string) => {
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

  const switchCommons = (nextCoopId: string) => {
    setSwitcherOpen(false);
    if (nextCoopId === coopId) return;
    router.replace({ pathname: '/(tabs)', params: { coopId: nextCoopId } } as any);
  };

  const activeCommons = commons.find((item) => item.id === coopId);
  const activeCommonsName = activeCommons?.name || (coopId === 'cahootz' ? 'Cahootz' : 'Commons');
  const switchableCommons = commons.filter(
    (item) => item.id === coopId || item.isMember || !item.isLocked,
  );

  const myWelcomeTable = circles.find((c) => c.kind === 'WELCOME_TABLE' && c.isMember);
  const memberCircles = circles.filter((c) => c.isMember && c.kind !== 'WELCOME_TABLE');
  const publicCircles = circles.filter((c) => !c.isMember && c.privacy === 'public');

  const cards: CircleCard[] = [{ general: true }, ...memberCircles, ...publicCircles];

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} activeCommonsId={coopId} />
      <Modal
        visible={switcherOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/35">
          <TouchableOpacity
            className="absolute inset-0"
            onPress={() => setSwitcherOpen(false)}
            accessibilityLabel="Close commons switcher"
          />
          <View className="max-h-[78%] rounded-t-3xl bg-white px-5 pb-8 pt-5">
            <View className="mb-4 flex-row items-center justify-between">
              <View>
                <Text className="text-2xl font-black text-gray-950">Switch commons</Text>
                <Text className="mt-1 text-sm font-semibold text-gray-500">
                  Choose a Commons to see its circles.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSwitcherOpen(false)}
                className="h-11 w-11 items-center justify-center rounded-full bg-gray-100"
                accessibilityLabel="Close commons switcher"
              >
                <X size={18} color={THEME.ink} />
              </TouchableOpacity>
            </View>

            {commonsLoading ? (
              <View className="items-center py-8">
                <ActivityIndicator color={THEME.primary} />
              </View>
            ) : commonsError ? (
              <LoadError
                message={commonsError}
                onRetry={() => setCommonsReloadKey((key) => key + 1)}
              />
            ) : (
              <ScrollView className="flex-shrink" contentContainerStyle={{ gap: 8 }}>
                {switchableCommons.map((item) => {
                  const selected = item.id === coopId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => switchCommons(item.id)}
                      className="min-h-16 flex-row items-center gap-3 rounded-2xl border px-3 py-3"
                      style={{
                        borderColor: selected ? THEME.primary : THEME.border,
                        backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
                      }}
                      accessibilityLabel={`${selected ? 'Current commons' : 'View circles in'} ${item.name}`}
                    >
                      <IconAvatar
                        emoji={item.iconEmoji}
                        color={item.iconColor || THEME.primary}
                        fallbackText={item.name}
                        size={40}
                        radius={12}
                      />
                      <View className="min-w-0 flex-1">
                        <Text className="text-base font-black text-gray-950" numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text className="mt-0.5 text-xs font-semibold text-gray-500">
                          {item.isMember ? 'Member' : 'Public commons'}
                        </Text>
                      </View>
                      {selected ? <CheckCircle2 size={20} color={THEME.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={() => {
                setSwitcherOpen(false);
                router.push('/commons' as any);
              }}
              className="mt-4 min-h-11 flex-row items-center justify-center gap-2"
              accessibilityLabel="Explore all commons"
            >
              <Compass size={17} color={THEME.primary} />
              <Text className="text-sm font-black" style={{ color: THEME.primary }}>
                Explore all commons
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* The header stays put; everything below it scrolls. */}
      <View className="flex-row items-center justify-between bg-white px-5 pb-2 pt-4">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          onPress={() => setDrawerOpen(true)}
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: THEME.primarySoft }}
        >
          <Menu size={20} color={THEME.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSwitcherOpen(true)}
          className="min-w-0 flex-1 px-3"
          activeOpacity={0.72}
          accessibilityLabel={`Switch commons. Currently ${activeCommonsName}`}
        >
          <Text className="text-lg font-black text-gray-950" numberOfLines={1}>
            {activeCommonsName}
          </Text>
          <View className="mt-0.5 flex-row items-center">
            <Text className="text-xs font-bold" style={{ color: THEME.primary }}>
              Circle view
            </Text>
            <ChevronDown size={14} color={THEME.primary} />
          </View>
        </TouchableOpacity>
        {sessionToken ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Manage circles"
            onPress={openManageCircles}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: THEME.primarySoft }}
          >
            <Settings2 size={18} color={THEME.primary} />
          </TouchableOpacity>
        ) : (
          <View className="h-11 w-11" />
        )}
      </View>

      <ScrollView
        testID="circle-view-scroll"
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 pt-2">
          <Text className="text-3xl font-black text-gray-950">Welcome In</Text>
          <Text className="mt-1 text-base font-semibold text-gray-500">
            Choose a circle in {activeCommonsName}
          </Text>
        </View>

        {sessionToken ? (
          <View className="px-5 pt-4">
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
            <View className="flex-row flex-wrap justify-between gap-y-6">
              {cards.map((card) =>
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
                    joinLabel={!card.isMember}
                    onPress={() => (card.isMember ? openCircle(card.id) : joinPublicCircle(card.id))}
                  />
                ),
              )}
              {myWelcomeTable ? (
                <CircleCardView
                  name={myWelcomeTable.name}
                  colorKey={myWelcomeTable.colorKey}
                  chattingCount={myWelcomeTable.chattingCount}
                  onPress={() => openCircle(myWelcomeTable.id)}
                />
              ) : (
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
                    className="h-28 w-28 items-center justify-center rounded-full border-2 border-dashed"
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
                  <Text className="mt-3 text-center text-base font-black text-gray-900">
                    {sessionToken ? 'Join a welcome lounge' : 'Sign in'}
                  </Text>
                  <Text className="mt-0.5 text-center text-xs font-semibold text-gray-500">
                    {sessionToken ? 'Meet a small group of newcomers' : 'Log in to join your commons'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

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
  joinLabel,
  hideStatus,
  onPress,
}: {
  name: string;
  colorKey: string;
  iconEmoji?: string | null;
  iconColor?: string | null;
  chattingCount: number;
  joinLabel?: boolean;
  hideStatus?: boolean;
  onPress: () => void;
}) {
  const palette = circleColorFromKey(colorKey);
  const background = iconColor || palette.background;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      className="items-center"
      style={{ width: '47%' }}
      activeOpacity={0.8}
    >
      <View
        className="h-28 w-28 items-center justify-center rounded-full"
        style={{
          backgroundColor: background,
          shadowColor: '#0F172A',
          shadowOpacity: 0.08,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }}
      >
        {iconEmoji ? (
          // Text's base `text-base` class pins lineHeight to 24, which clips a
          // 40px emoji - give it a line box tall enough for the glyph.
          <Text style={{ fontSize: 40, lineHeight: 52, textAlign: 'center' }}>{iconEmoji}</Text>
        ) : (
          <Text
            className="text-3xl font-black"
            style={{ color: iconColor ? '#FFFFFF' : palette.foreground }}
          >
            {name.slice(0, 1).toUpperCase()}
          </Text>
        )}
      </View>
      <Text className="mt-3 text-center text-base font-black text-gray-900" numberOfLines={1}>
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
            {joinLabel ? 'Join' : chattingCount > 0 ? `${chattingCount} chatting` : 'Join now'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

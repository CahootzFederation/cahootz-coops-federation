import type { PrivateGroupSummary } from '@/lib/api';
import { useCallback, useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { circleColorFromKey } from '@/lib/circle-color';
import { secureStorage } from '@/lib/secure-storage';
import AppDrawer from '@/components/app-drawer';
import { Menu, MessageCircle, Settings2 } from 'lucide-react-native';

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
  const [welcomeTableError, setWelcomeTableError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Single fetch per focus - no polling. Live updates are planned via
  // websockets later; until then "chatting" counts can go stale while you
  // sit on this screen, which is an accepted tradeoff for now.
  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) {
        setCircles([]);
        setIsLoading(false);
        return;
      }

      let mounted = true;
      setIsLoading(true);
      api
        .listVisibleCircles(sessionToken, coopId)
        .then((result) => {
          if (mounted) setCircles(result?.groups || []);
        })
        .catch((err) => {
          console.error('Failed to load circles:', err);
          if (mounted) setCircles([]);
        })
        .finally(() => {
          if (mounted) setIsLoading(false);
        });

      return () => {
        mounted = false;
      };
    }, [coopId, sessionToken]),
  );

  const openCircle = (circleId?: string) => {
    router.push({ pathname: '/[coopId]/posts', params: { coopId, circleId } } as any);
  };

  const joinPublicCircle = async (groupId: string) => {
    if (!sessionToken) return;
    try {
      await api.joinPublicCircle(groupId, sessionToken);
      openCircle(groupId);
    } catch (err) {
      console.error('Failed to join circle:', err);
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
    setWelcomeTableError(null);
    try {
      const result = await api.assignWelcomeTable(sessionToken, coopId);
      openCircle(result.groupId);
    } catch (err) {
      console.error('Failed to join welcome lounge:', err);
      setWelcomeTableError(err instanceof Error ? err.message : 'Could not join a welcome lounge.');
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

  const cards: CircleCard[] = [{ general: true }, ...memberCircles, ...publicCircles];

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} activeCommonsId={coopId} />
      <View className="flex-row items-center justify-between px-5 pt-4">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          onPress={() => setDrawerOpen(true)}
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: THEME.primarySoft }}
        >
          <Menu size={20} color={THEME.primary} />
        </TouchableOpacity>
        <Text className="text-2xl font-black" style={{ color: THEME.primary }}>
          Cahootz
        </Text>
        {sessionToken ? (
          <TouchableOpacity
            accessibilityRole="button"
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

      <View className="px-5 pt-4">
        <Text className="text-3xl font-black text-gray-950">Welcome In</Text>
        <Text className="mt-1 text-base font-semibold text-gray-500">Hey check out a circle</Text>
      </View>

      {isLoading && circles.length === 0 ? (
        <View className="items-center py-10">
          <ActivityIndicator size="small" color={THEME.primary} />
        </View>
      ) : (
        <View className="gap-5 px-5 pt-6">
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
                disabled={isAssigning}
                onPress={joinWelcomeTable}
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
                  ) : (
                    <MessageCircle size={30} color={THEME.primary} />
                  )}
                </View>
                <Text className="mt-3 text-center text-base font-black text-gray-900">
                  Join a welcome lounge
                </Text>
                <Text className="mt-0.5 text-center text-xs font-semibold text-gray-500">
                  Meet a small group of newcomers
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {welcomeTableError ? (
            <Text className="text-sm font-bold text-red-600">{welcomeTableError}</Text>
          ) : null}
        </View>
      )}
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
          <Text style={{ fontSize: 40 }}>{iconEmoji}</Text>
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

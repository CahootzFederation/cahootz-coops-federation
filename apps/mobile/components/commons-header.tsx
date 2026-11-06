import type { CommonsDirectoryItem } from '@/lib/api';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, ChevronDown, Compass, Menu, Star, X } from 'lucide-react-native';

import AppDrawer from '@/components/app-drawer';
import { IconAvatar } from '@/components/icon-avatar';
import { LoadError } from '@/components/load-error';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

const THEME = { ...DESIGN, primary: DESIGN.actionText };

/** The member's Commons list, for the header's name and the switcher. */
export function useCommonsDirectory(coopId: string) {
  const { sessionToken, isLoading: authLoading } = useAuth();
  const [commons, setCommons] = useState<CommonsDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [defaultSavingId, setDefaultSavingId] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState('');

  useEffect(() => {
    // Wait for the saved session to load. Asking before then gets the
    // signed-out list, so the default star shows up late.
    if (authLoading) return;
    let mounted = true;
    setLoading(true);
    setError('');

    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        if (mounted) setCommons(result.coops);
      })
      .catch((err) => {
        console.error('Failed to load commons directory:', err);
        if (mounted) setError(friendlyError(err, "We couldn't load your commons."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [authLoading, reloadKey, sessionToken]);

  const makeDefaultCommons = async (nextCoopId: string) => {
    if (!sessionToken || defaultSavingId) return;
    setDefaultSavingId(nextCoopId);
    setDefaultError('');
    try {
      await api.setDefaultCommons(nextCoopId, sessionToken);
      setCommons((items) =>
        items
          .map((item) => ({ ...item, isDefault: item.id === nextCoopId }))
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
      );
    } catch (err) {
      console.error('Failed to save default commons:', err);
      setDefaultError(friendlyError(err, "We couldn't save your default Commons."));
    } finally {
      setDefaultSavingId(null);
    }
  };

  const activeCommons = commons.find((item) => item.id === coopId);
  return {
    commons,
    loading,
    error,
    reload: () => setReloadKey((key) => key + 1),
    activeCommons,
    activeCommonsName: activeCommons?.name || (coopId === 'cahootz' ? 'Cahootz' : 'Commons'),
    switchableCommons: commons.filter((item) => item.id === coopId || item.isMember || !item.isLocked),
    defaultSavingId,
    defaultError,
    makeDefaultCommons,
  };
}

export type CommonsDirectory = ReturnType<typeof useCommonsDirectory>;

/**
 * The Commons tab header: the menu, the current Commons' name with the
 * switcher, and one action on the right. Shared by the street and the
 * Circle Hall (the circles screen) so both keep the same labels.
 */
export function CommonsHeader({
  coopId,
  directory,
  right,
  switcherSubtitle = 'Choose a Commons to see its street.',
}: {
  coopId: string;
  directory: CommonsDirectory;
  right?: ReactNode;
  switcherSubtitle?: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const { activeCommons, activeCommonsName, switchableCommons, defaultSavingId, defaultError, makeDefaultCommons } =
    directory;

  const switchCommons = (nextCoopId: string) => {
    setSwitcherOpen(false);
    if (nextCoopId === coopId) return;
    router.replace({ pathname: '/(tabs)', params: { coopId: nextCoopId } } as any);
  };

  return (
    <>
      <AppDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} activeCommonsId={coopId} />
      <Modal visible={switcherOpen} transparent animationType="fade" onRequestClose={() => setSwitcherOpen(false)}>
        <View className="flex-1 justify-end bg-black/35">
          <TouchableOpacity
            className="absolute inset-0"
            onPress={() => setSwitcherOpen(false)}
            accessibilityLabel="Close commons switcher"
          />
          <View className="max-h-[78%] rounded-t-3xl bg-white px-5 pb-8 pt-5" accessibilityLabel="Commons switcher">
            <View className="mb-4 flex-row items-center justify-between">
              <View>
                <Text className="text-2xl font-bold text-gray-950">Switch commons</Text>
                <Text className="mt-1 text-sm font-semibold text-gray-500">{switcherSubtitle}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSwitcherOpen(false)}
                className="h-11 w-11 items-center justify-center rounded-full bg-gray-100"
                accessibilityLabel="Close commons switcher"
              >
                <X size={18} color={THEME.ink} />
              </TouchableOpacity>
            </View>

            {directory.loading ? (
              <View className="items-center py-8">
                <ActivityIndicator color={THEME.primary} />
              </View>
            ) : directory.error ? (
              <LoadError message={directory.error} onRetry={directory.reload} />
            ) : (
              <ScrollView className="flex-shrink" contentContainerStyle={{ gap: 8 }}>
                {defaultError ? <Text className="mb-1 text-sm font-semibold text-red-600">{defaultError}</Text> : null}
                {switchableCommons.map((item) => {
                  const selected = item.id === coopId;
                  return (
                    <View
                      key={item.id}
                      className="min-h-16 flex-row items-center rounded-2xl border pr-3"
                      style={{
                        borderColor: selected ? THEME.primary : THEME.border,
                        backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => switchCommons(item.id)}
                        className="min-w-0 flex-1 flex-row items-center gap-3 px-3 py-3"
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
                          <Text className="text-base font-bold text-gray-950" numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text className="mt-0.5 text-xs font-semibold text-gray-500">
                            {item.isMember ? 'Member' : 'Public commons'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      {item.isMember ? (
                        <TouchableOpacity
                          onPress={() => makeDefaultCommons(item.id)}
                          disabled={item.isDefault || defaultSavingId !== null}
                          className="h-11 w-11 items-center justify-center rounded-full"
                          style={{ backgroundColor: item.isDefault ? '#FEF3C7' : '#F5F5F4' }}
                          accessibilityRole="button"
                          accessibilityLabel={
                            item.isDefault ? `${item.name} is your default commons` : `Make ${item.name} your default commons`
                          }
                        >
                          {defaultSavingId === item.id ? (
                            <ActivityIndicator size="small" color={THEME.primary} />
                          ) : (
                            <Star
                              size={19}
                              color={item.isDefault ? '#D97706' : '#78716C'}
                              fill={item.isDefault ? '#FBBF24' : 'transparent'}
                            />
                          )}
                        </TouchableOpacity>
                      ) : null}
                      {selected ? <CheckCircle2 size={20} color={THEME.primary} /> : null}
                    </View>
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
              <Text className="text-sm font-bold" style={{ color: THEME.primary }}>
                Explore all commons
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
          <View className="flex-row items-center gap-1.5">
            <Text className="min-w-0 flex-shrink text-lg font-bold text-gray-950" numberOfLines={1}>
              {activeCommonsName}
            </Text>
            {activeCommons?.isDefault ? <Star size={15} color="#D97706" fill="#FBBF24" /> : null}
          </View>
          <View className="mt-0.5 flex-row items-center">
            <Text className="text-xs font-bold" style={{ color: THEME.primary }}>
              Switch commons
            </Text>
            <ChevronDown size={14} color={THEME.primary} />
          </View>
        </TouchableOpacity>
        {right ?? <View className="h-11 w-11" />}
      </View>
    </>
  );
}

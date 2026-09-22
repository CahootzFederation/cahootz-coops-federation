import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsDirectoryItem } from '@/lib/api';
import { PERSONAL_PAGE_DESTINATION_ID } from '@/lib/composer-destination';
import { IconAvatar } from '@/components/icon-avatar';
import {
  CheckCircle2,
  ChevronRight,
  Compass,
  Info,
  LogOut,
  MessageCircle,
  RotateCcw,
  Store,
  UserCircle,
  Wrench,
  X,
} from 'lucide-react-native';

const THEME = {
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
};

const DEFAULT_COMMONS_PROFILE = {
  id: 'cahootz',
  name: 'Cahootz Commons',
  shortName: 'Cahootz',
  description: 'A social commons for conversation, resources, and coordinated action.',
};

const DRAWER_SECTIONS = [
  { label: 'Personal Page', icon: UserCircle, action: '/(authenticated)/personal-page', requiresAuth: true },
  { label: 'Commons Stores & Shops', icon: Store, action: '/(tabs)/store' },
  { label: 'Messages & Direct Chat', icon: MessageCircle, action: '/(tabs)/messages' },
];

// Shared "hamburger" drawer - same navigation surface (switch commons, explore
// the directory, stores/messages, sign in/out) that the general feed
// (commons-ai-entry.tsx) has always had. Kept as its own component so Circle
// View can show it too without touching that feed component, which stays
// frozen per the "existing feed cards... remain unchanged" requirement.
export default function AppDrawer({
  visible,
  onClose,
  activeCommonsId = 'cahootz',
}: {
  visible: boolean;
  onClose: () => void;
  activeCommonsId?: string;
}) {
  const { isAuthenticated, sessionToken, user, logout, previewWelcomeScreen } = useAuth();
  const [memberCommons, setMemberCommons] = useState<CommonsDirectoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const hasAccountSession = isAuthenticated && !!sessionToken;
  const accountName = user?.name?.trim() || user?.email?.split('@')[0] || 'member';
  const accountHandle =
    user?.handle || (user?.email?.split('@')[0] || accountName).toLowerCase().replace(/[^a-z0-9]/g, '');

  useEffect(() => {
    if (!visible || !sessionToken) {
      if (!sessionToken) setMemberCommons([]);
      return;
    }
    setIsLoading(true);
    api
      .listCommonsDirectory(sessionToken)
      .then((result) => setMemberCommons(result.coops.filter((c) => c.accessStatus === 'ACTIVE')))
      .catch((error) => console.error('Failed to load member commons:', error))
      .finally(() => setIsLoading(false));
  }, [visible, sessionToken]);

  const activeCommonsForDrawer =
    memberCommons.length > 0
      ? memberCommons
      : [{ ...DEFAULT_COMMONS_PROFILE, accessStatus: 'ACTIVE' as const, isMember: true, isLocked: false, canApply: false }];

  const commonsItems = activeCommonsForDrawer.map((commons) => ({
    id: commons.id,
    label: commons.name,
    accessStatus: commons.accessStatus,
    icon: commons.name.slice(0, 1).toUpperCase(),
    iconEmoji: 'iconEmoji' in commons ? commons.iconEmoji : null,
    iconColor: 'iconColor' in commons ? commons.iconColor : null,
    action: `/${commons.id}/posts`,
  }));

  const drawerItems = hasAccountSession
    ? [
        {
          id: PERSONAL_PAGE_DESTINATION_ID,
          label: 'My Personal Page',
          accessStatus: 'ACTIVE' as const,
          icon: accountName.slice(0, 1).toUpperCase(),
          action: '/(authenticated)/personal-page',
        },
        ...commonsItems,
      ]
    : commonsItems;

  const visibleSections = DRAWER_SECTIONS.filter((item) => !item.requiresAuth || hasAccountSession);

  const goTo = (href: string) => {
    onClose();
    router.push(href as any);
  };

  const openSignIn = () => {
    onClose();
    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  };

  const handleSignOut = async () => {
    onClose();
    await logout();
    router.replace('/' as any);
  };

  const handlePreviewWelcomeScreen = async () => {
    setAdminPanelOpen(false);
    onClose();
    await previewWelcomeScreen();
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 flex-row bg-black/35">
        <View className="w-4/5 bg-white pt-14">
          <View className="border-b border-stone-200 px-4 pb-3">
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                onPress={() => (hasAccountSession ? goTo('/(authenticated)/personal-page') : openSignIn())}
                className="min-w-0 flex-1 flex-row items-center gap-2.5"
                activeOpacity={0.75}
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-slate-400">
                  <Text className="text-sm font-black text-white">{accountName.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-black text-gray-900" numberOfLines={1}>
                    {hasAccountSession ? accountName : 'Sign in'}
                  </Text>
                  <Text className="text-xs font-semibold text-gray-500" numberOfLines={1}>
                    {hasAccountSession ? `@${accountHandle} · Member` : 'Tap to sign in'}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100"
                accessibilityLabel="Close menu"
              >
                <X size={16} color="#44403C" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-[11px] font-black uppercase tracking-wide text-stone-400">Switch commons</Text>
              {isLoading ? <ActivityIndicator size="small" color={THEME.primary} /> : null}
            </View>
            <View className="mb-3 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {drawerItems.map((item) => {
                const isActive = item.id === activeCommonsId || (item.id === 'cahootz' && activeCommonsId === 'cahootz');
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => goTo(item.action)}
                    className="flex-row items-center gap-2.5 border-b border-stone-100 px-3 py-3"
                    style={isActive ? { backgroundColor: THEME.primarySoft } : undefined}
                    activeOpacity={0.75}
                  >
                    {'iconEmoji' in item ? (
                      <IconAvatar
                        emoji={item.iconEmoji}
                        color={item.iconColor || (isActive ? THEME.primary : '#F5F5F4')}
                        foregroundColor={item.iconColor ? undefined : isActive ? '#FFFFFF' : '#57534E'}
                        fallbackText={item.icon}
                        size={36}
                        radius={12}
                      />
                    ) : (
                      <View
                        className="h-9 w-9 items-center justify-center rounded-xl"
                        style={{ backgroundColor: isActive ? THEME.primary : '#F5F5F4' }}
                      >
                        <Text className="text-sm font-black" style={{ color: isActive ? '#FFFFFF' : '#57534E' }}>
                          {item.icon}
                        </Text>
                      </View>
                    )}
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-black text-gray-900" numberOfLines={1}>
                        {item.label}
                      </Text>
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: item.accessStatus === 'ACTIVE' ? '#059669' : '#6B7280' }}
                      >
                        {item.accessStatus === 'ACTIVE' ? (isActive ? 'Active Member' : 'Member') : 'Pending'}
                      </Text>
                    </View>
                    {item.id !== PERSONAL_PAGE_DESTINATION_ID ? (
                      <TouchableOpacity
                        onPress={() => goTo(`/commons/${item.id}`)}
                        className="h-8 w-8 items-center justify-center rounded-full bg-stone-100"
                        accessibilityLabel={`Open ${item.label} page`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Info size={15} color="#57534E" />
                      </TouchableOpacity>
                    ) : null}
                    {isActive ? (
                      <CheckCircle2 size={17} color={THEME.primary} />
                    ) : (
                      <ChevronRight size={15} color="#A8A29E" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              onPress={() => goTo('/commons')}
              className="flex-row items-center justify-center gap-1.5 py-1.5"
              activeOpacity={0.75}
            >
              <Compass size={14} color={THEME.primary} />
              <Text className="text-xs font-black" style={{ color: THEME.primary }}>
                Explore all Commons directory
              </Text>
            </TouchableOpacity>

            <Text className="mb-2 mt-4 text-[11px] font-black uppercase tracking-wide text-stone-400">Sections</Text>
            <View className="mb-5 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {visibleSections.map((item, index) => {
                const Icon = item.icon;
                return (
                  <TouchableOpacity
                    key={item.label}
                    onPress={() => goTo(item.action)}
                    className={`flex-row items-center gap-2.5 px-3 py-3 ${
                      index < visibleSections.length - 1 ? 'border-b border-stone-100' : ''
                    }`}
                    activeOpacity={0.75}
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100">
                      <Icon size={17} color={THEME.primary} />
                    </View>
                    <Text className="flex-1 text-sm font-black text-gray-900">{item.label}</Text>
                    <ChevronRight size={15} color="#D6D3D1" />
                  </TouchableOpacity>
                );
              })}
            </View>

            {hasAccountSession ? (
              <TouchableOpacity
                onPress={() => void handleSignOut()}
                className="flex-row items-center justify-center gap-2 rounded-2xl bg-stone-100 py-3"
                activeOpacity={0.8}
              >
                <LogOut size={16} color="#DC2626" />
                <Text className="text-sm font-black text-red-600">Sign Out (@{accountHandle})</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={openSignIn}
                className="flex-row items-center justify-center gap-2 rounded-2xl py-3"
                style={{ backgroundColor: THEME.primary }}
                activeOpacity={0.85}
              >
                <UserCircle size={16} color="#FFFFFF" />
                <Text className="text-sm font-black text-white">Sign In</Text>
              </TouchableOpacity>
            )}

            {__DEV__ && (
              <TouchableOpacity
                onPress={() => setAdminPanelOpen(true)}
                className="mt-2 flex-row items-center justify-center gap-2 rounded-2xl bg-stone-100 py-3"
                activeOpacity={0.8}
              >
                <Wrench size={16} color={THEME.primary} />
                <Text className="text-sm font-black text-gray-900">Admin Panel (Dev)</Text>
              </TouchableOpacity>
            )}

            <Text className="mt-4 text-center text-[11px] font-semibold text-stone-300">Cahootz v1.1</Text>
          </ScrollView>
        </View>
        <TouchableOpacity className="flex-1" onPress={onClose} />
      </View>
      </Modal>

      {__DEV__ && (
        <Modal
          visible={adminPanelOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setAdminPanelOpen(false)}
        >
          <View className="flex-1 flex-row bg-black/35">
            <View className="w-4/5 bg-white pt-14">
              <View className="border-b border-stone-200 px-4 pb-3">
                <View className="flex-row items-center justify-between">
                  <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                    <View className="h-10 w-10 items-center justify-center rounded-full bg-stone-800">
                      <Wrench size={17} color="#FFFFFF" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-black text-gray-900" numberOfLines={1}>
                        Admin Panel
                      </Text>
                      <Text className="text-xs font-semibold text-gray-500" numberOfLines={1}>
                        Dev-only tools, not shown in production
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setAdminPanelOpen(false)}
                    className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100"
                    accessibilityLabel="Close admin panel"
                  >
                    <X size={16} color="#44403C" />
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
                <Text className="mb-2 text-[11px] font-black uppercase tracking-wide text-stone-400">Dev tools</Text>
                <View className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                  <TouchableOpacity
                    onPress={() => void handlePreviewWelcomeScreen()}
                    className="flex-row items-center gap-2.5 px-3 py-3"
                    activeOpacity={0.75}
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100">
                      <RotateCcw size={17} color={THEME.primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-black text-gray-900">Preview Welcome Screen</Text>
                      <Text className="text-xs font-semibold text-gray-500">
                        Clears the &quot;seen&quot; flag and signs you out so the first-launch welcome tour shows
                        again.
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
            <TouchableOpacity
              className="flex-1"
              onPress={() => setAdminPanelOpen(false)}
              activeOpacity={1}
            />
          </View>
        </Modal>
      )}
    </>
  );
}

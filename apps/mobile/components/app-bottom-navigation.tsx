import { router, useSegments } from 'expo-router';
import { Bell, LayoutGrid, Scale, Store, UserCircle } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const destinations = [
  { label: 'Commons', href: '/(tabs)' as const, icon: LayoutGrid },
  { label: 'Shop', href: '/(tabs)/store' as const, icon: Store },
  { label: 'Alerts', href: '/(tabs)/notifications' as const, icon: Bell },
  { label: 'Proposals', href: '/(tabs)/proposals' as const, icon: Scale },
  { label: 'You', href: '/(tabs)/wallet' as const, icon: UserCircle },
];

export function AppBottomNavigation() {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { sessionToken, isAuthenticated } = useAuth();
  const unreadQuery = useQuery({
    queryKey: ['unread-notifications-badge', sessionToken],
    queryFn: () => api.getUnreadNotificationCount(sessionToken!),
    enabled: isAuthenticated && !!sessionToken,
    retry: false,
    refetchInterval: 30000,
  });
  const hasUnread = (unreadQuery.data?.count ?? 0) > 0;

  const screen: string = segments[segments.length - 1] || '';
  const active = screen === 'notifications' || screen === 'notification-settings'
    ? 'Alerts'
    : screen === 'proposals' || screen === 'proposal-detail'
      ? 'Proposals'
      : ['store', 'store-detail', 'cart', 'checkout'].includes(screen)
        ? 'Shop'
      : ['wallet', 'profile', 'personal-page', 'profile-onboarding', 'export-wallet', 'withdraw'].includes(screen)
        ? 'You'
        : screen === '(tabs)' || screen === 'index' || screen === ''
          ? 'Commons'
          : undefined;

  return (
    <View accessibilityRole="tablist" accessibilityLabel="Main navigation" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {destinations.map(({ label, href, icon: Icon }) => {
        const selected = active === label;
        const color = selected ? '#FF6B00' : '#64748B';
        const onPress = () => {
          // The feed (app/[coopId]/posts.tsx) is only ever reached by
          // pushing it on top of Circle View - tapping Commons from there
          // should return to that same Circle View instance, not push a
          // second one, so prefer popping the stack when that's available.
          if (label === 'Commons' && screen === 'posts' && router.canGoBack()) {
            router.back();
            return;
          }
          router.navigate(href);
        };
        return (
          <TouchableOpacity
            key={label}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={onPress}
            style={styles.item}
          >
            <View>
              <Icon size={24} color={color} />
              {label === 'Alerts' && hasUnread ? <View accessibilityLabel="Unread alerts" style={styles.dot} /> : null}
            </View>
            <Text style={[styles.label, { color }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexShrink: 0, backgroundColor: '#FFFFFF', borderTopColor: '#F0F2F5', borderTopWidth: 1, paddingTop: 7 },
  item: { flex: 1, minWidth: 0, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 4, gap: 3 },
  label: { fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  dot: { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
});

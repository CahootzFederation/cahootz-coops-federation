import { DESIGN } from '@/constants/design';
import { router, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';
import { Bell, LayoutGrid, PanelsTopLeft, UserCircle } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { OfflineBanner } from '@/components/offline-banner';

const destinations = [
  { label: 'Commons', href: '/(tabs)' as const, icon: LayoutGrid },
  { label: 'Board', href: '/(tabs)/board' as const, icon: PanelsTopLeft },
  { label: 'Alerts', href: '/(tabs)/notifications' as const, icon: Bell },
  { label: 'You', href: '/(tabs)/wallet' as const, icon: UserCircle },
];

export function AppBottomNavigation() {
  const segments = useSegments();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { sessionToken, isAuthenticated, isLoading, user } = useAuth();
  // Recheck on navigation so joining/creating a commons reveals the tabs.
  const membershipQuery = useQuery({
    queryKey: ['navigation-commons-membership', sessionToken, pathname],
    queryFn: () => api.listCommonsDirectory(sessionToken!),
    enabled: isAuthenticated && !!sessionToken,
    staleTime: 0,
  });
  const hasCommons = membershipQuery.data?.coops.some((commons) => commons.isMember) ?? false;
  const unreadQuery = useQuery({
    queryKey: ['unread-notifications-badge', sessionToken],
    queryFn: () => api.getUnreadNotificationCount(sessionToken!),
    enabled: isAuthenticated && !!sessionToken,
    retry: false,
    refetchInterval: 30000,
  });
  const hasUnread = (unreadQuery.data?.count ?? 0) > 0;

  const screen: string = segments[segments.length - 1] || '';
  const { entry, coopId } = useGlobalSearchParams<{
    entry?: string | string[];
    coopId?: string;
  }>();
  const active = screen === 'notifications' || screen === 'notification-settings'
    ? 'Alerts'
    : ['board', 'store', 'store-detail', 'product-detail', 'cart', 'checkout', 'commons-resources', 'orders', 'order-detail', 'my-store', 'my-stores', 'add-product', 'edit-product', 'apply-store', 'store-orders', 'store-payments', 'stripe-onboarding', 'apply-sc-verification'].includes(screen)
        ? 'Board'
      : ['wallet', 'profile', 'personal-page', 'export-wallet', 'withdraw', 'payment-methods', 'bank-accounts', 'history', 'scan-pay', 'quick-pay', 'receipt', 'accept-payment', 'sage-settings', 'feedback'].includes(screen)
        ? 'You'
        : 'Commons';

  // Onboarding, sign-in, and the commons application are focused, full-screen
  // flows: a stray tab tap there would throw away what the person typed.
  const hidden =
    isLoading ||
    !isAuthenticated ||
    !user?.onboardingCompletedAt ||
    !hasCommons ||
    screen === 'profile-onboarding' ||
    (!isAuthenticated && !coopId && (screen === 'index' || screen === '' || screen === '(tabs)')) ||
    (isSignInEntry(entry) && (screen === 'index' || screen === '' || screen === '(tabs)'));

  // The offline note sits just above the tabs, or at the very bottom without them.
  if (hidden) return <OfflineBanner bottomInset={insets.bottom} />;

  return (
    <>
      <OfflineBanner />
      <View accessibilityRole="tablist" accessibilityLabel="Main navigation" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {destinations
          // The board and its marketplace are members-only.
          .filter(({ label }) => isAuthenticated || label !== 'Board')
          .map(({ label, href, icon: Icon }) => {
          const selected = active === label;
          const color = selected ? DESIGN.actionText : DESIGN.muted;
          const onPress = () => {
            // Circle feeds are destinations inside the already-selected
            // Commons tab. Re-selecting that tab must not add Circle View to
            // the root stack or discard the circle someone is reading.
            if (label === 'Commons' && selected) {
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
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexShrink: 0, backgroundColor: '#FFFFFF', borderTopColor: '#F0F2F5', borderTopWidth: 1, paddingTop: 7 },
  item: { flex: 1, minWidth: 0, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 4, gap: 3 },
  label: { fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  dot: { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
});

function isSignInEntry(entry: string | string[] | undefined) {
  return Array.isArray(entry) ? entry.includes('sign-in') : entry === 'sign-in';
}

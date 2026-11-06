import { CommunityTheme } from '@/constants/theme';
import { DESIGN } from '@/constants/design';
import { router, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';
import { Bell, CircleUserRound, House, Signpost } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

// Icons match the Commons street: Commons is home (your street), the Board is
// the street's signpost, Alerts is the doorbell, and You is you.
const destinations = [
  { label: 'Commons', href: '/(tabs)' as const, icon: House },
  { label: 'Board', href: '/(tabs)/board' as const, icon: Signpost },
  { label: 'Alerts', href: '/(tabs)/notifications' as const, icon: Bell },
  { label: 'You', href: '/(tabs)/wallet' as const, icon: CircleUserRound },
];

const SELECTED_PILL = '#FBEDE6';

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
  if (isLoading || !isAuthenticated || !user?.onboardingCompletedAt || !hasCommons) return null;
  if (screen === 'profile-onboarding') return null;
  if (!isAuthenticated && !coopId && (screen === 'index' || screen === '' || screen === '(tabs)')) return null;
  if (isSignInEntry(entry) && (screen === 'index' || screen === '' || screen === '(tabs)')) return null;

  return (
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
          router.navigate(coopId ? { pathname: href, params: { coopId } } : href);
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
            <View style={[styles.pill, selected && styles.pillSelected]}>
              <Icon size={22} color={color} strokeWidth={selected ? 2.4 : 2} />
              {label === 'Alerts' && hasUnread ? <View accessibilityLabel="Unread alerts" style={styles.dot} /> : null}
            </View>
            <Text style={[styles.label, { color }, selected && styles.labelSelected]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // A soft, rounded bar that sits on the page like the street's bottom panel:
  // no hard divider line, just a gentle shadow and rounded top corners.
  bar: {
    flexDirection: 'row',
    flexShrink: 0,
    backgroundColor: CommunityTheme.sheet,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopColor: CommunityTheme.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 8,
    boxShadow: '0 -4px 16px rgba(17, 24, 39, 0.07)',
  },
  item: { flex: 1, minWidth: 0, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 2, gap: 3 },
  pill: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillSelected: { backgroundColor: SELECTED_PILL },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  labelSelected: { fontWeight: '800' },
  dot: { position: 'absolute', top: 3, right: 13, width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626', borderWidth: 1.5, borderColor: CommunityTheme.sheet },
});

function isSignInEntry(entry: string | string[] | undefined) {
  return Array.isArray(entry) ? entry.includes('sign-in') : entry === 'sign-in';
}

import { router, useSegments } from 'expo-router';
import { Bell, LayoutGrid, Scale, UserCircle } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/auth-context';

const destinations = [
  { label: 'Commons', href: '/(tabs)' as const, icon: LayoutGrid },
  { label: 'Alerts', href: '/(tabs)/notifications' as const, icon: Bell },
  { label: 'Proposals', href: '/(tabs)/proposals' as const, icon: Scale },
  { label: 'You', href: '/(tabs)/wallet' as const, icon: UserCircle },
];

export function AppBottomNavigation() {
  const { isAuthenticated } = useAuth();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  if (!isAuthenticated) return null;

  const screen: string = segments[segments.length - 1] || '';
  const active = screen === 'notifications' || screen === 'notification-settings'
    ? 'Alerts'
    : screen === 'proposals' || screen === 'proposal-detail'
      ? 'Proposals'
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
        return (
          <TouchableOpacity
            key={label}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={() => router.navigate(href)}
            style={styles.item}
          >
            <Icon size={24} color={color} />
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
});

import { StyleSheet, Text, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';

import { DESIGN } from '@/constants/design';
import { useConnectivity } from '@/hooks/use-connectivity';

/**
 * A plain note while the app can't reach Cahootz, so saved info (balances
 * included) is never mistaken for live data. Clears itself once the
 * connection is back (lib/connectivity.ts).
 */
export function OfflineBanner({ bottomInset = 0 }: { bottomInset?: number }) {
  const { online, showingSaved } = useConnectivity();
  if (online) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { paddingBottom: 8 + bottomInset }]}
    >
      <WifiOff size={16} color={DESIGN.ink} />
      <Text style={styles.text}>
        {showingSaved
          ? "You're offline. You're seeing what was saved on this phone, so it may be out of date."
          : "You're offline. We'll catch up when you're back online."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: DESIGN.primarySoft,
    borderTopColor: DESIGN.border,
    borderTopWidth: 1,
  },
  text: { flex: 1, fontSize: 13, lineHeight: 18, color: DESIGN.ink, fontWeight: '600' },
});

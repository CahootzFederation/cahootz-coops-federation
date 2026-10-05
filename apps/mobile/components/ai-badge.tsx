import { View } from 'react-native';
import { Sparkles } from 'lucide-react-native';

import { Text } from '@/components/ui/text';

/**
 * Shown next to the name on anything Sage (or another AI account) wrote, so
 * members never mistake its words for a person's. See components/sage-intro.tsx
 * for the longer explanation.
 */
export function AiBadge() {
  return (
    <View
      accessible
      accessibilityLabel="AI helper, not a person"
      className="flex-row items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5"
    >
      <Sparkles size={12} color="#C2410C" />
      <Text className="ml-1 text-xs font-bold" style={{ color: '#9A3412' }}>
        AI helper
      </Text>
    </View>
  );
}

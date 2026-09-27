import { useState } from 'react';
import { ActivityIndicator, Platform, TouchableOpacity, View } from 'react-native';
import { BellRing } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { acceptPushPrimer, dismissPushPrimer } from '@/lib/push-primer';

const PRIMARY = '#FF6B00';

/**
 * In-app ask shown before the OS notification prompt, at a moment where a
 * push is obviously useful. Only "Yes" triggers the OS prompt; "Not now"
 * snoozes the primer on this device (see lib/push-primer.ts).
 */
export function PushPermissionPrimer({
  sessionToken,
  coopId,
  onDone,
}: {
  sessionToken: string;
  coopId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    const registered = await acceptPushPrimer(sessionToken, coopId);
    setBusy(false);
    if (registered) {
      onDone();
      return;
    }
    setResult(
      Platform.OS === 'web'
        ? "Replies will show up in Alerts. Get the mobile app to have them sent to your phone too."
        : 'Notifications are off for now. You can turn them on anytime in Notification settings.'
    );
  };

  const decline = async () => {
    await dismissPushPrimer();
    onDone();
  };

  if (result) {
    return (
      <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4" accessibilityLiveRegion="polite">
        <Text className="text-sm leading-5 text-gray-700">{result}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={onDone} className="mt-3 self-start rounded-full bg-gray-100 px-4 py-2">
          <Text className="text-xs font-black text-gray-800">Got it</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      className="mb-4 rounded-2xl border p-4"
      style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}
      accessibilityLabel="Notification permission primer"
    >
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
          <BellRing size={18} color={PRIMARY} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-black text-gray-950">Want a heads-up when someone welcomes you?</Text>
          <Text className="mt-1 text-xs leading-5 text-gray-700">
            We&apos;ll send a notification when someone replies to your intro. Nothing else changes.
          </Text>
        </View>
      </View>
      <View className="mt-3 flex-row gap-2">
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => void accept()}
          disabled={busy}
          className="flex-row items-center rounded-full px-4 py-2"
          style={{ backgroundColor: PRIMARY, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text className="text-xs font-black text-white">Yes, notify me</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => void decline()}
          disabled={busy}
          className="rounded-full bg-white px-4 py-2"
        >
          <Text className="text-xs font-black text-gray-700">Not now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';

/**
 * Shown when a screen (or part of one) couldn't load. Says so in plain
 * words and offers a large "Try again" button, so a failed load never
 * looks like an empty list.
 *
 * Pass a message from `friendlyError(err, "We couldn't load ...")`.
 */
export function LoadError({
  message,
  onRetry,
  retrying = false,
  title,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  title?: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      className="items-center rounded-2xl border border-red-200 bg-red-50 px-5 py-6"
    >
      {title ? (
        <Text className="mb-1 text-center text-lg font-bold text-gray-900">{title}</Text>
      ) : null}
      <Text className="text-center text-base text-gray-800">{message}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Try again"
        accessibilityState={{ disabled: retrying, busy: retrying }}
        disabled={retrying}
        onPress={onRetry}
        activeOpacity={0.8}
        className="mt-4 flex-row items-center justify-center rounded-xl px-6"
        style={{ minHeight: 48, minWidth: 160, backgroundColor: '#FF6B00' }}
      >
        {retrying ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text className="text-base font-bold text-white">Try again</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

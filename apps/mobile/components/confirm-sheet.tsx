import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, TouchableOpacity, View } from 'react-native';

import { Text } from '@/components/ui/text';

/**
 * An in-app "are you sure?" step for actions that matter (votes, removing
 * someone, withdrawing). Unlike `Alert.alert`, it also works on web, so the
 * E2E suite can test it.
 *
 * Both buttons are at least 48pt tall. "Go back" never does anything but
 * close the sheet.
 */
export function ConfirmSheet({
  visible,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Go back',
  tone = 'primary',
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  /** A plain message from `friendlyError`, shown when the action failed. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmColor = tone === 'danger' ? '#B91C1C' : '#FF6B00';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <View
        className="flex-1 items-center justify-center px-5"
        style={{ backgroundColor: 'rgba(17, 24, 39, 0.55)' }}
      >
        <View
          accessibilityViewIsModal
          className="w-full rounded-2xl bg-white p-5"
          style={{ maxWidth: 440 }}
        >
          <Text accessibilityRole="header" className="text-xl font-black text-gray-950">
            {title}
          </Text>
          {children ? <View className="mt-3 gap-2">{children}</View> : null}
          {error ? (
            <Text accessibilityRole="alert" className="mt-3 text-sm font-semibold text-red-700">
              {error}
            </Text>
          ) : null}
          <View className="mt-5 gap-3">
            <TouchableOpacity
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: busy, busy }}
              className="flex-row items-center justify-center gap-2 rounded-xl px-4"
              style={{ minHeight: 48, backgroundColor: confirmColor, opacity: busy ? 0.7 : 1 }}
            >
              {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              <Text className="text-base font-black text-white">{confirmLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              className="items-center justify-center rounded-xl border border-gray-300 bg-white px-4"
              style={{ minHeight: 48, opacity: busy ? 0.5 : 1 }}
            >
              <Text className="text-base font-black text-gray-900">{cancelLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

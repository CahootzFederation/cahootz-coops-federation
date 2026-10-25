import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import * as Sentry from '@sentry/react-native';

import { DESIGN } from '@/constants/design';

/**
 * Shown in place of the app when a screen throws while rendering. Without a
 * boundary, React Native treats that error as fatal and the app quits; at
 * launch with no network, expo-updates can't recover and iOS closes it.
 * These errors skip Sentry's global handler, so report them here.
 */
export function AppErrorScreen({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'root' } });
  }, [error]);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Something went wrong
      </Text>
      <Text style={styles.body}>
        This screen hit a snag. Check that you're online, then try again.
      </Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
    padding: DESIGN.gutter,
    backgroundColor: DESIGN.paper,
  },
  title: { fontSize: 22, fontWeight: '700', color: DESIGN.ink },
  body: { fontSize: 16, lineHeight: 22, color: DESIGN.muted },
  button: {
    marginTop: 8,
    height: DESIGN.controlHeight,
    borderRadius: DESIGN.radius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DESIGN.primary,
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});

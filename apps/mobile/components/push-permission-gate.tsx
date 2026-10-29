import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { ConfirmSheet } from '@/components/confirm-sheet';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { askForPushFromGate, checkPushOnOpen, type PushGateStep } from '@/lib/push-gate';
import { getPushPermissionState } from '@/lib/push-notifications';

const COPY: Record<Exclude<PushGateStep, 'none'>, { title: string; body: string; confirm: string }> = {
  ask: {
    title: 'Turn on notifications',
    body: "Notifications are how you hear about messages, payments, and replies to your posts. Without them, you'll only see these when you open the app.",
    confirm: 'Turn on notifications',
  },
  settings: {
    title: 'Notifications are off',
    body: 'Your phone is blocking notifications from Cahootz, so you miss messages, payments, and replies. Tap Open Settings, then turn on Allow Notifications.',
    confirm: 'Open Settings',
  },
};

/**
 * Every time the app opens (launch, or back from the background) and the
 * phone doesn't allow notifications, ask again. Pushes are how members hear
 * about anything, so this is not a one-time ask.
 */
export function PushPermissionGate() {
  const { sessionToken, pushReady } = useAuth();
  const [step, setStep] = useState<PushGateStep>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (!sessionToken || checking.current) return;
    checking.current = true;
    try {
      setStep(await checkPushOnOpen(sessionToken));
      setError(null);
    } catch (caughtError) {
      // Never block the app over this; the next open checks again.
      console.warn('Could not check notification permission on open', caughtError);
    } finally {
      checking.current = false;
    }
  }, [sessionToken]);

  useEffect(() => {
    if (Platform.OS === 'web' || !pushReady || !sessionToken) {
      setStep('none');
      return;
    }
    void check();
    const subscription = AppState.addEventListener('change', (next) => {
      // Only a real return from the background counts as opening the app.
      // The system popup itself flips the app inactive -> active.
      if (appState.current === 'background' && next === 'active') void check();
      appState.current = next;
    });
    return () => subscription.remove();
  }, [pushReady, sessionToken, check]);

  if (step === 'none' || !sessionToken) return null;
  const copy = COPY[step];

  const confirm = async () => {
    if (step === 'settings') {
      setStep('none');
      // Coming back from Settings is a return from the background, so the
      // check above runs again and registers the phone if they allowed it.
      void Linking.openSettings().catch((caughtError) =>
        console.warn('Could not open Settings', caughtError),
      );
      return;
    }
    setBusy(true);
    const registered = await askForPushFromGate(sessionToken);
    setBusy(false);
    if (registered) {
      setStep('none');
      return;
    }
    // Said "Don't Allow": close for now; the next open offers Settings.
    if ((await getPushPermissionState()) !== 'granted') {
      setStep('none');
      return;
    }
    setError("Notifications are allowed, but we couldn't finish setting up this phone. Check your connection and try again.");
  };

  return (
    <ConfirmSheet
      visible
      title={copy.title}
      confirmLabel={copy.confirm}
      cancelLabel="Not now"
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => setStep('none')}
    >
      <Text className="text-base leading-6 text-gray-700">{copy.body}</Text>
    </ConfirmSheet>
  );
}

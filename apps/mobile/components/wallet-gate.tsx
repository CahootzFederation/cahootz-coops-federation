import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { LoadError } from '@/components/load-error';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Holds a screen back until a signed-in member has a wallet, creating one if
 * they don't. Signed-out visitors see the screen as-is.
 */
export function WalletGate({ children }: { children: ReactNode }) {
  const { user, sessionToken, isLoading, ensureWallet } = useAuth();
  const needsWallet = !isLoading && !!user && !!sessionToken && !user.walletAddress;
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needsWallet) return;
    let cancelled = false;
    setError('');
    ensureWallet().catch((err) => {
      if (!cancelled) setError(friendlyError(err, "We couldn't set up your wallet."));
    });
    return () => {
      cancelled = true;
    };
    // ensureWallet is recreated each render; rerun only when the need or a retry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsWallet, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (!needsWallet) return <>{children}</>;

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      {error ? (
        <LoadError title="Wallet setup failed" message={error} onRetry={retry} />
      ) : (
        <>
          <ActivityIndicator size="small" color="#FF6B00" />
          <Text className="mt-3 text-center text-sm font-semibold text-gray-500">
            Setting up your wallet...
          </Text>
        </>
      )}
    </View>
  );
}

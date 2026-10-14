import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import CircleView from '@/components/circle-view';
import OnboardingFlow from '@/components/onboarding-flow';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

export default function CommonsScreen() {
  const params = useLocalSearchParams<{ coopId?: string; entry?: string }>();
  const { user, sessionToken, isLoading } = useAuth();
  const requestedCoopId = params.coopId;
  const [resolvedCoopId, setResolvedCoopId] = useState<string | null>(
    requestedCoopId || (!isLoading && !sessionToken ? 'cahootz' : null),
  );

  useEffect(() => {
    if (requestedCoopId) {
      setResolvedCoopId(requestedCoopId);
      return;
    }
    if (isLoading) return;
    if (!sessionToken) {
      setResolvedCoopId('cahootz');
      return;
    }

    let mounted = true;
    setResolvedCoopId(null);
    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        if (!mounted) return;
        const defaultCoopId = result.coops.find((commons) => commons.isDefault && commons.isMember)?.id || 'cahootz';
        setResolvedCoopId(defaultCoopId);
        router.replace({ pathname: '/(tabs)', params: { coopId: defaultCoopId } } as any);
      })
      .catch((error) => {
        console.error('Failed to load default commons:', error);
        if (mounted) setResolvedCoopId('cahootz');
      });

    return () => {
      mounted = false;
    };
  }, [isLoading, requestedCoopId, sessionToken]);

  // "/" resolves here (not app/index.tsx) when navigating from inside the
  // tabs, so honour the same `entry=sign-in` link the root screen does.
  if (params.entry === 'sign-in' && !user) {
    return <OnboardingFlow initialStep="login" onBack={() => router.setParams({ entry: undefined } as any)} />;
  }

  if (!resolvedCoopId) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#FF6B00" />
      </View>
    );
  }

  // Circle View is the Commons tab's landing for everyone. Signed-in members
  // see their circles, chatting counts, and the welcome lounge; a signed-out
  // visitor sees just the General card (CircleView skips the authenticated
  // circles fetch when there's no session) - tapping it opens the same
  // general feed with its own sign-in prompt, exactly as before.
  return <CircleView coopId={resolvedCoopId} />;
}

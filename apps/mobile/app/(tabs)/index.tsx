import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import CircleView from '@/components/circle-view';
import OnboardingFlow from '@/components/onboarding-flow';
import OnboardingWelcome from '@/components/onboarding-welcome';
import { useAuth } from '@/contexts/auth-context';
import { secureStorage } from '@/lib/secure-storage';
import { api } from '@/lib/api';

export default function CommonsScreen() {
  const params = useLocalSearchParams<{ coopId?: string; entry?: string }>();
  const { user, sessionToken, isLoading } = useAuth();
  const requestedCoopId = params.coopId;
  const isFocused = useIsFocused();
  const [resolvedCoopId, setResolvedCoopId] = useState<string | null>(
    requestedCoopId || (!isLoading && !sessionToken ? 'cahootz' : null),
  );

  useEffect(() => {
    if (!isFocused) return;
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
      .then(async (result) => {
        if (!mounted) return;
        const destination = await secureStorage.getItem(secureStorage.keys.COMMONS_DESTINATION);
        if (!mounted) return;
        if (destination === 'family' || destination?.startsWith('commons:')) {
          await secureStorage.removeItem(secureStorage.keys.COMMONS_DESTINATION);
          router.replace((destination === 'family' ? '/(authenticated)/create-family' : `/commons/${destination.slice(8)}`) as any);
          return;
        }
        const invitation = await secureStorage.getItem(secureStorage.keys.PENDING_INVITATION);
        if (!mounted) return;
        if (invitation) {
          await secureStorage.removeItem(secureStorage.keys.PENDING_INVITATION);
          router.replace({ pathname: '/invite/[token]', params: { token: invitation } } as any);
          return;
        }
        const defaultCoopId = result.coops.find((commons) => commons.isDefault && commons.isMember)?.id
          || result.coops.find((commons) => commons.isMember)?.id;
        if (!defaultCoopId) {
          router.replace((!user?.onboardingCompletedAt
            ? { pathname: '/profile-onboarding', params: { step: 'commons' } }
            : { pathname: '/profile-onboarding', params: { step: 'commons', chooseCommons: '1' } }) as any);
          return;
        }
        setResolvedCoopId(defaultCoopId);
        router.replace({ pathname: '/(tabs)', params: { coopId: defaultCoopId } } as any);
      })
      .catch((error) => {
        console.error('Failed to load default commons:', error);
        if (mounted) router.replace('/commons' as any);
      });

    return () => {
      mounted = false;
    };
  }, [isFocused, isLoading, requestedCoopId, sessionToken, user?.onboardingCompletedAt]);

  // "/" resolves here (not app/index.tsx) when navigating from inside the
  // tabs, so honour the same `entry=sign-in` link the root screen does.
  if (!user && !requestedCoopId) {
    if (params.entry !== 'sign-in') return <OnboardingWelcome
      onContinue={() => router.push('/?entry=sign-in' as any)}
    />;
    return <OnboardingFlow initialStep="login" onBack={() => router.dismissTo('/' as any)} />;
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

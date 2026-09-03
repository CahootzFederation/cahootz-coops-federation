import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import CommonsAiEntry from '@/components/commons-ai-entry';
import OnboardingFlow from '@/components/onboarding-flow';
import { useAuth } from '@/contexts/auth-context';

type EntryMode = 'commons' | 'sign-in';

export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ entry?: string }>();
  const { isAuthenticated, sessionToken } = useAuth();
  const [entryMode, setEntryMode] = useState<EntryMode>('commons');

  // Debug environment variables only once on mount
  useEffect(() => {
    console.log("EXPO_PUBLIC_API_BASE_URL:", process.env.EXPO_PUBLIC_API_BASE_URL);
    console.log("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:", process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    console.log("EXPO_PUBLIC_COOP_ID:", process.env.EXPO_PUBLIC_COOP_ID);
  }, []);

  useEffect(() => {
    if (params.entry === 'sign-in') setEntryMode('sign-in');
  }, [params.entry]);

  if (entryMode === 'sign-in') {
    return <OnboardingFlow initialStep="login" />;
  }

  return (
    <CommonsAiEntry
      onMessagesPress={() => {
        if (isAuthenticated && sessionToken) {
          router.push('/(tabs)/messages' as any);
          return;
        }

        setEntryMode('sign-in');
      }}
      onSignInPress={() => setEntryMode('sign-in')}
    />
  );
}

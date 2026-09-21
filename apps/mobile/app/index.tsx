import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import CircleView from '@/components/circle-view';
import OnboardingFlow from '@/components/onboarding-flow';
import { useAuth } from '@/contexts/auth-context';
import { hasSeenAnonymousProfileIntro } from '@/lib/anonymous-id';

type EntryMode = 'commons' | 'sign-in';

export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ entry?: string; coopId?: string }>();
  const { forceWelcomeIntro, dismissForcedWelcomeIntro } = useAuth();
  const [entryMode, setEntryMode] = useState<EntryMode>('commons');
  // null while we haven't checked device storage yet, to avoid flashing the
  // feed for a first-time visitor before we know whether they've already
  // been through the Welcome Wizard (see app/profile-onboarding.tsx).
  const [showWelcomeWizard, setShowWelcomeWizard] = useState<boolean | null>(null);

  // Dev/QA "Preview Welcome Screen" admin action: force the wizard back
  // open, since previewWelcomeScreen() clears the "seen" flag on the
  // device but this screen's state (derived once per focus, below)
  // wouldn't otherwise re-read it mid-session. Reset the flag right away
  // so the action can be triggered again later.
  useEffect(() => {
    if (!forceWelcomeIntro) return;
    setShowWelcomeWizard(true);
    dismissForcedWelcomeIntro();
  }, [forceWelcomeIntro, dismissForcedWelcomeIntro]);

  // Debug environment variables only once on mount
  useEffect(() => {
    console.log("EXPO_PUBLIC_API_BASE_URL:", process.env.EXPO_PUBLIC_API_BASE_URL);
    console.log("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:", process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    console.log("EXPO_PUBLIC_COOP_ID:", process.env.EXPO_PUBLIC_COOP_ID);
  }, []);

  useEffect(() => {
    if (params.entry === 'sign-in') setEntryMode('sign-in');
  }, [params.entry]);

  // Runs before any login/signup check — first app launch shows the Welcome
  // Wizard regardless of auth state, tracked purely as a device-local flag.
  // useFocusEffect (not a plain mount effect) so re-navigating back to "/"
  // re-derives this from storage too, rather than trusting a stale value
  // from the first time this screen ever mounted.
  useFocusEffect(
    useCallback(() => {
      setShowWelcomeWizard(null);
      hasSeenAnonymousProfileIntro().then((seen) => setShowWelcomeWizard(!seen));
    }, [])
  );

  // The wizard itself lives at /profile-onboarding — the same page an
  // existing account lands on post-login if it hasn't finished onboarding
  // yet (see that file for both flows).
  useEffect(() => {
    if (showWelcomeWizard) {
      router.replace('/profile-onboarding' as any);
    }
  }, [showWelcomeWizard]);

  if (showWelcomeWizard === null || showWelcomeWizard) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="small" color="#FF6B00" />
      </View>
    );
  }

  if (entryMode === 'sign-in') {
    return <OnboardingFlow initialStep="login" onBack={() => setEntryMode('commons')} />;
  }

  // Same Circle View as the Commons tab - the root route ("/") is reached
  // via back-navigation, sign-out, and various redirects, not just cold
  // launch, so it needs to look and behave like the rest of the app rather
  // than dropping people onto a bare feed with no way back to Circle View.
  return <CircleView coopId={params.coopId || 'cahootz'} />;
}

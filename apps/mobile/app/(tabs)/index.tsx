import { router, useLocalSearchParams } from 'expo-router';

import CircleView from '@/components/circle-view';
import OnboardingFlow from '@/components/onboarding-flow';
import { useAuth } from '@/contexts/auth-context';

export default function CommonsScreen() {
  const params = useLocalSearchParams<{ coopId?: string; entry?: string }>();
  const { user } = useAuth();
  const coopId = params.coopId || 'cahootz';

  // "/" resolves here (not app/index.tsx) when navigating from inside the
  // tabs, so honour the same `entry=sign-in` link the root screen does.
  if (params.entry === 'sign-in' && !user) {
    return <OnboardingFlow initialStep="login" onBack={() => router.setParams({ entry: undefined } as any)} />;
  }

  // Circle View is the Commons tab's landing for everyone. Signed-in members
  // see their circles, chatting counts, and the welcome lounge; a signed-out
  // visitor sees just the General card (CircleView skips the authenticated
  // circles fetch when there's no session) - tapping it opens the same
  // general feed with its own sign-in prompt, exactly as before.
  return <CircleView coopId={coopId} />;
}

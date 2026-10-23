import { router, useLocalSearchParams } from 'expo-router';
import CircleView from '@/components/circle-view';
import OnboardingFlow from '@/components/onboarding-flow';
import OnboardingWelcome from '@/components/onboarding-welcome';

// Public welcome comes before verification and account-only setup.
export default function OnboardingScreen() {
  const { coopId, entry } = useLocalSearchParams<{ coopId?: string; entry?: string }>();
  if (coopId && entry !== 'sign-in') return <CircleView coopId={coopId} />;
  if (entry !== 'sign-in') return <OnboardingWelcome
    onContinue={() => router.push('/?entry=sign-in' as any)}
  />;
  return <OnboardingFlow initialStep="login" onBack={() => router.dismissTo('/' as any)} />;
}

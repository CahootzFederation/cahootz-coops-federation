import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/contexts/auth-context';
import CircleView from '@/components/circle-view';
import OnboardingFlow from '@/components/onboarding-flow';
import OnboardingWelcome from '@/components/onboarding-welcome';

// Public welcome comes before verification and account-only setup.
export default function OnboardingScreen() {
  const { coopId, entry } = useLocalSearchParams<{ coopId?: string; entry?: string }>();
  const { isLoading, user } = useAuth();
  // Wait for session restoration and the authenticated redirect before showing inputs.
  if (isLoading || user) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#FF6B00" />
      </View>
    );
  }
  if (coopId && entry !== 'sign-in') return <CircleView coopId={coopId} />;
  if (entry !== 'sign-in') return <OnboardingWelcome
    onContinue={() => router.push('/?entry=sign-in' as any)}
  />;
  return <OnboardingFlow initialStep="login" onBack={() => router.dismissTo('/' as any)} />;
}

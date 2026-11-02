import { useEffect } from 'react';
import { router, useSegments, useGlobalSearchParams } from 'expo-router';

import { useAuth } from '@/contexts/auth-context';
import { useNavigationReady } from '@/hooks/use-navigation-ready';
import { secureStorage } from '@/lib/secure-storage';

/**
 * Resumes a commons invitation link opened while signed out, for accounts
 * that skip the onboarding wizard (it already finished). New accounts resume
 * from the wizard's last step instead (app/profile-onboarding.tsx).
 */
export function PendingInvitationResume() {
  const { user, isLoading } = useAuth();
  const navigationReady = useNavigationReady();
  const segments = useSegments();
  const { entry } = useGlobalSearchParams<{ entry?: string | string[] }>();
  const signingIn = (Array.isArray(entry) ? entry[0] : entry) === 'sign-in';
  const inProfileOnboarding = segments[0] === 'profile-onboarding';

  useEffect(() => {
    if (isLoading || !navigationReady || !user?.onboardingCompletedAt || inProfileOnboarding || signingIn) return;

    let cancelled = false;
    secureStorage.getItem(secureStorage.keys.PENDING_INVITATION).then((token) => {
      if (!token || cancelled) return;
      void secureStorage.removeItem(secureStorage.keys.PENDING_INVITATION);
      router.push({ pathname: '/invite/[token]', params: { token } } as any);
    });

    return () => {
      cancelled = true;
    };
  }, [isLoading, navigationReady, user?.onboardingCompletedAt, inProfileOnboarding, signingIn]);

  return null;
}

import { useEffect } from 'react';
import { router, useSegments } from 'expo-router';

import { useAuth } from '@/contexts/auth-context';
import { secureStorage } from '@/lib/secure-storage';

/**
 * Resumes a commons invitation link opened while signed out, for accounts
 * that skip the onboarding wizard (it already finished). New accounts resume
 * from the wizard's last step instead (app/profile-onboarding.tsx).
 */
export function PendingInvitationResume() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const inProfileOnboarding = segments[0] === 'profile-onboarding';

  useEffect(() => {
    if (isLoading || !user?.profileOnboardingCompletedAt || inProfileOnboarding) return;

    let cancelled = false;
    secureStorage.getItem(secureStorage.keys.PENDING_INVITATION).then((token) => {
      if (!token || cancelled) return;
      void secureStorage.removeItem(secureStorage.keys.PENDING_INVITATION);
      router.push({ pathname: '/invite/[token]', params: { token } } as any);
    });

    return () => {
      cancelled = true;
    };
  }, [isLoading, user?.profileOnboardingCompletedAt, inProfileOnboarding]);

  return null;
}

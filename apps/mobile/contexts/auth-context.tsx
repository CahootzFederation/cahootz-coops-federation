import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter, useSegments } from 'expo-router';
import { secureStorage } from '@/lib/secure-storage';
import { setActiveCoopConfig, resetCoopConfig, type CoopConfig } from '@/lib/coop-config';
import { api, onSessionExpired } from '@/lib/api';
import { registerForNativePushNotifications } from '@/lib/push-notifications';
import { canAccessUpdateChannelDebug, clearUpdateChannelOverrideQuietly } from '@/lib/update-channel-debug';
import { clearAnonymousProfileIntroSeen } from '@/lib/anonymous-id';
import * as analytics from '@/lib/analytics';

interface User {
  id: string;
  email: string;
  handle: string;
  name: string | null;
  roles: string[];
  status: string;
  walletAddress: string | null;
  phone: string | null;
  createdAt: Date;
  selfDescription?: string | null;
  shortTermGoals?: string | null;
  longTermGoals?: string | null;
  skills?: string[];
  interests?: string[];
  resourcesOffered?: string[];
  resourcesNeeded?: string[];
  businessSummary?: string | null;
  locationSummary?: string | null;
  profileSignals?: unknown;
  profileOnboardingCompletedAt?: Date | null;
  sessionToken?: string;
  // Coop membership info (set after application approval)
  coop?: {
    id: string;
    name: string;
    shortName: string;
    apiUrl: string;
    webUrl: string;
    primaryColor?: string;
    accentColor?: string;
    logoUrl?: string;
  };
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionToken: string | null;
  login: (user: User) => Promise<void>;
  // Creates the signed-in member's wallet if they don't have one yet and
  // resolves to its address (null when signed out). Safe to call repeatedly.
  ensureWallet: () => Promise<string | null>;
  logout: () => Promise<void>;
  deferProfileOnboarding: () => Promise<void>;
  resetProfileOnboarding: () => Promise<void>;
  // Dev/QA only: true while the root layout should show the welcome tour
  // in place of the normal navigator, regardless of which screen/tab the
  // "Preview Welcome Screen" admin action was triggered from. A plain
  // router navigation to "/" doesn't reliably work here, since the tabs
  // group's own index route can resolve to the same path and no-op the
  // navigation — this bypasses routing entirely.
  forceWelcomeIntro: boolean;
  previewWelcomeScreen: () => Promise<void>;
  dismissForcedWelcomeIntro: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [profileOnboardingDeferredUserId, setProfileOnboardingDeferredUserId] = useState<string | null>(null);
  const [forceWelcomeIntro, setForceWelcomeIntro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const { coopId: coopIdParam } = useGlobalSearchParams<{ coopId?: string | string[] }>();
  const activeCoopId = Array.isArray(coopIdParam) ? coopIdParam[0] : coopIdParam;
  const pushRegistrationAttempt = useRef<string | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const inProfileOnboarding = segments[0] === 'profile-onboarding';
  const readyForPushRegistration = !!user && (
    !!user.profileOnboardingCompletedAt || profileOnboardingDeferredUserId === user.id
  );

  // Load session on mount
  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      pushRegistrationAttempt.current = null;
      return;
    }
    // Wait until onboarding is completed or skipped and its screen has closed.
    if (isLoading || !readyForPushRegistration || inProfileOnboarding) return;
    const registrationKey = `${sessionToken}:${user?.coop?.id || 'cahootz'}`;
    if (pushRegistrationAttempt.current === registrationKey) return;
    pushRegistrationAttempt.current = registrationKey;

    // Silently (re)register a device that already allowed notifications.
    // Asking for permission waits for a moment that explains why - the
    // primer shown after a newcomer posts their welcome lounge intro.
    registerForNativePushNotifications(sessionToken, user?.coop?.id || 'cahootz', {
      neverAsk: true,
    }).catch((error) => {
      console.warn('Native push registration skipped:', error);
    });
  }, [sessionToken, user?.coop?.id, isLoading, readyForPushRegistration, inProfileOnboarding]);

  useEffect(() => {
    if (isLoading || canAccessUpdateChannelDebug(user?.email)) return;

    void clearUpdateChannelOverrideQuietly();
  }, [isLoading, user?.email]);

  // Handle navigation based on auth state
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(authenticated)';
    const inProfileOnboarding = segments[0] === 'profile-onboarding';
    // Circle View (app/(tabs)/index.tsx) also lives at "/", so only the
    // root screen (app/index.tsx, no segments) should be redirected.
    // Otherwise every Commons switch (/?coopId=...) would be replaced by a
    // bare "/(tabs)" and silently fall back to the default Commons.
    const atRoot = pathname === '/' && segments[0] !== '(tabs)';

    if (!user && inAuthGroup) {
      // User is not logged in but in authenticated routes, redirect to onboarding
      router.replace('/');
      return;
    }

    const profileOnboardingDeferred = !!user && profileOnboardingDeferredUserId === user.id;

    if (user && !user.profileOnboardingCompletedAt && !profileOnboardingDeferred && !inProfileOnboarding) {
      router.replace('/profile-onboarding' as any);
      return;
    }

    if (user && atRoot) {
      router.replace(
        (activeCoopId ? { pathname: '/(tabs)', params: { coopId: activeCoopId } } : '/(tabs)') as any,
      );
      return;
    }

    if (user?.profileOnboardingCompletedAt && inProfileOnboarding) {
      router.replace('/(tabs)' as any);
    }
  }, [user, segments, isLoading, router, pathname, profileOnboardingDeferredUserId, activeCoopId]);

  const loadSession = async () => {
    try {
      const userData = await secureStorage.getItem(secureStorage.keys.USER);
      const deferredUserId = await secureStorage.getItem(secureStorage.keys.PROFILE_ONBOARDING_DEFERRED_USER);
      setProfileOnboardingDeferredUserId(deferredUserId);
      if (userData) {
        const parsedUser = JSON.parse(userData);
        // Convert createdAt string back to Date
        parsedUser.createdAt = new Date(parsedUser.createdAt);
        if (parsedUser.profileOnboardingCompletedAt) {
          parsedUser.profileOnboardingCompletedAt = new Date(parsedUser.profileOnboardingCompletedAt);
        }
        setUser(parsedUser);
        const storedSessionToken =
          parsedUser.sessionToken ||
          (await secureStorage.getItem(secureStorage.keys.SESSION_TOKEN));
        setSessionToken(storedSessionToken);

        // Set coop config if user has coop membership
        if (parsedUser.coop) {
          setActiveCoopConfig({
            id: parsedUser.coop.id,
            name: parsedUser.coop.name,
            shortName: parsedUser.coop.shortName,
            apiUrl: parsedUser.coop.apiUrl,
            webUrl: parsedUser.coop.webUrl,
            primaryColor: parsedUser.coop.primaryColor,
            accentColor: parsedUser.coop.accentColor,
            logoUrl: parsedUser.coop.logoUrl,
          });
        }
      }
    } catch (error) {
      console.error('Error loading session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Every signed-in member gets a wallet before the screens that need it
  // (sign-in, Proposals & Votes, You) show. The server call is idempotent;
  // concurrent callers share one request.
  const walletCreation = useRef<Promise<string> | null>(null);
  const createWalletFor = (userId: string, token: string) => {
    if (!walletCreation.current) {
      walletCreation.current = api
        .createWallet(userId, token)
        .then((result: { address: string }) => result.address)
        .finally(() => {
          walletCreation.current = null;
        });
    }
    return walletCreation.current;
  };

  const ensureWallet = async () => {
    const current = userRef.current;
    if (current?.walletAddress) return current.walletAddress;
    const token = current?.sessionToken || sessionToken;
    if (!current || !token) return null;
    const walletAddress = await createWalletFor(current.id, token);
    await login({ ...current, sessionToken: token, walletAddress });
    return walletAddress;
  };

  const login = async (incomingUser: User) => {
    let userData = incomingUser;
    if (!userData.walletAddress && userData.sessionToken) {
      try {
        const walletAddress = await createWalletFor(userData.id, userData.sessionToken);
        userData = { ...userData, walletAddress };
      } catch (error) {
        // Don't block sign-in; the Proposals and You screens retry.
        console.warn('Wallet creation at sign-in failed:', error);
      }
    }
    try {
      // Store user data securely
      await secureStorage.setItem(
        secureStorage.keys.USER,
        JSON.stringify(userData)
      );
      await secureStorage.setItem(
        secureStorage.keys.LOGIN_TIME,
        new Date().toISOString()
      );
      if (userData.sessionToken) {
        await secureStorage.setItem(
          secureStorage.keys.SESSION_TOKEN,
          userData.sessionToken
        );
      }
      if (userData.profileOnboardingCompletedAt) {
        await secureStorage.removeItem(secureStorage.keys.PROFILE_ONBOARDING_DEFERRED_USER);
        setProfileOnboardingDeferredUserId(null);
      }

      // Set coop config if user has coop membership
      if (userData.coop) {
        setActiveCoopConfig({
          id: userData.coop.id,
          name: userData.coop.name,
          shortName: userData.coop.shortName,
          apiUrl: userData.coop.apiUrl,
          webUrl: userData.coop.webUrl,
          primaryColor: userData.coop.primaryColor,
          accentColor: userData.coop.accentColor,
          logoUrl: userData.coop.logoUrl,
        });
      }

      // login() is also used to refresh the stored record for the same
      // account (e.g. after profile onboarding) - only a new id is a sign-in.
      const isNewSignIn = userRef.current?.id !== userData.id;
      setUser(userData);
      setSessionToken(userData.sessionToken || null);
      if (isNewSignIn) {
        analytics.identify(userData.id, { coopId: userData.coop?.id ?? 'cahootz' });
        analytics.track('signed_in');
      }
    } catch (error) {
      console.error('Error saving session:', error);
      throw new Error('Failed to save login session');
    }
  };

  const logout = () => performLogout('user');

  const performLogout = async (reason: 'user' | 'session_expired') => {
    try {
      console.log('Starting logout process...');
      if (userRef.current) analytics.track('signed_out', { reason });
      analytics.reset();
      await secureStorage.clear();
      console.log('Secure storage cleared');
      resetCoopConfig();
      console.log('Coop config reset');
      setUser(null);
      setSessionToken(null);
      setProfileOnboardingDeferredUserId(null);
      console.log('User state cleared, should redirect to /');
    } catch (error) {
      console.error('Error during logout:', error);
      throw new Error('Failed to logout');
    }
  };

  const deferProfileOnboarding = async () => {
    if (!user) return;

    await secureStorage.setItem(secureStorage.keys.PROFILE_ONBOARDING_DEFERRED_USER, user.id);
    setProfileOnboardingDeferredUserId(user.id);
  };

  // Dev/QA helper: forces the welcome/profile-onboarding screen to show again
  // for the current device, without touching the server-side record. Clears
  // the local "deferred" flag and the locally cached completion timestamp so
  // the navigation effect above redirects to /profile-onboarding on its own.
  const resetProfileOnboarding = async () => {
    if (!user) return;

    await secureStorage.removeItem(secureStorage.keys.PROFILE_ONBOARDING_DEFERRED_USER);
    setProfileOnboardingDeferredUserId(null);

    const updatedUser = { ...user, profileOnboardingCompletedAt: null };
    await secureStorage.setItem(secureStorage.keys.USER, JSON.stringify(updatedUser));
    setUser(updatedUser);
  };

  // Dev/QA helper: the Welcome Wizard only ever shows on a logged-out
  // device, so previewing it again means clearing its "seen" flag and
  // signing out. Setting forceWelcomeIntro makes app/index.tsx route back
  // into the wizard immediately, from whichever screen this was triggered
  // from — no router navigation involved here.
  const previewWelcomeScreen = async () => {
    await clearAnonymousProfileIntroSeen();
    if (user) {
      await logout();
    }
    setForceWelcomeIntro(true);
  };

  const dismissForcedWelcomeIntro = () => {
    setForceWelcomeIntro(false);
  };

  // Any API call that comes back 401 means the backend no longer honors this
  // session (expired or revoked) - force the app back to a logged-out state
  // instead of leaving stale authenticated screens up.
  useEffect(() => {
    return onSessionExpired(() => {
      if (!userRef.current) return; // already logged out

      performLogout('session_expired')
        .then(() => {
          Alert.alert('Session expired', 'Please sign in again to continue.');
        })
        .catch((error) => console.error('Error handling session expiry:', error));
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        sessionToken,
        login,
        ensureWallet,
        logout,
        deferProfileOnboarding,
        resetProfileOnboarding,
        forceWelcomeIntro,
        previewWelcomeScreen,
        dismissForcedWelcomeIntro,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

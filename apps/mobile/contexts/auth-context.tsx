import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { secureStorage } from '@/lib/secure-storage';
import { setActiveCoopConfig, resetCoopConfig, type CoopConfig } from '@/lib/coop-config';
import { onSessionExpired } from '@/lib/api';
import { registerForNativePushNotifications } from '@/lib/push-notifications';
import { canAccessUpdateChannelDebug, clearUpdateChannelOverrideQuietly } from '@/lib/update-channel-debug';

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
  logout: () => Promise<void>;
  deferProfileOnboarding: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [profileOnboardingDeferredUserId, setProfileOnboardingDeferredUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();

  // Load session on mount
  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (!user?.profileOnboardingCompletedAt || !sessionToken) return;

    registerForNativePushNotifications(sessionToken, user.coop?.id || 'cahootz').catch((error) => {
      console.warn('Native push registration skipped:', error);
    });
  }, [sessionToken, user?.profileOnboardingCompletedAt, user?.coop?.id]);

  useEffect(() => {
    if (isLoading || canAccessUpdateChannelDebug(user?.email)) return;

    void clearUpdateChannelOverrideQuietly();
  }, [isLoading, user?.email]);

  // Handle navigation based on auth state
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(authenticated)';
    const inProfileOnboarding = segments[0] === 'profile-onboarding';
    const atRoot = pathname === '/';

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
      router.replace('/(tabs)' as any);
      return;
    }

    if (user?.profileOnboardingCompletedAt && inProfileOnboarding) {
      router.replace('/(tabs)' as any);
    }
  }, [user, segments, isLoading, router, pathname, profileOnboardingDeferredUserId]);

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

  const login = async (userData: User) => {
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

      setUser(userData);
      setSessionToken(userData.sessionToken || null);
    } catch (error) {
      console.error('Error saving session:', error);
      throw new Error('Failed to save login session');
    }
  };

  const logout = async () => {
    try {
      console.log('Starting logout process...');
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

  const userRef = useRef(user);
  userRef.current = user;

  // Any API call that comes back 401 means the backend no longer honors this
  // session (expired or revoked) - force the app back to a logged-out state
  // instead of leaving stale authenticated screens up.
  useEffect(() => {
    return onSessionExpired(() => {
      if (!userRef.current) return; // already logged out

      logout()
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
        logout,
        deferProfileOnboarding,
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

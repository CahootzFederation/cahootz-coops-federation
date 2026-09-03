import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { secureStorage } from '@/lib/secure-storage';
import { setActiveCoopConfig, resetCoopConfig, type CoopConfig } from '@/lib/coop-config';

interface User {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  status: string;
  walletAddress: string | null;
  phone: string | null;
  createdAt: Date;
  selfDescription?: string | null;
  shortTermGoals?: string | null;
  longTermGoals?: string | null;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  // Load session on mount
  useEffect(() => {
    loadSession();
  }, []);

  // Handle navigation based on auth state
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(authenticated)';
    const inProfileOnboarding = segments[0] === 'profile-onboarding';
    const profileOnboardingComplete = !!user?.profileOnboardingCompletedAt;

    if (!user && inAuthGroup) {
      // User is not logged in but in authenticated routes, redirect to onboarding
      router.replace('/');
      return;
    }

    if (user && !profileOnboardingComplete && !inProfileOnboarding) {
      router.replace('/profile-onboarding' as any);
      return;
    }

    if (user && profileOnboardingComplete && inProfileOnboarding) {
      router.replace('/(tabs)' as any);
    }
  }, [user, segments, isLoading, router]);

  const loadSession = async () => {
    try {
      const userData = await secureStorage.getItem(secureStorage.keys.USER);
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
      console.log('User state cleared, should redirect to /');
    } catch (error) {
      console.error('Error during logout:', error);
      throw new Error('Failed to logout');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        sessionToken,
        login,
        logout,
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

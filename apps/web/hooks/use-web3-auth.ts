'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  hasProfile: boolean;
  activeCoopId: string | null;
  isAdmin: boolean;
  adminRole: string | null;
  isPlatformAdmin: boolean;
  error: string | null;
  address: string | null;
  userId: string | null;
  email: string | null;
  loginMethod: string | null;
}

export function useWeb3Auth() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  
  const [authState, setAuthState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    hasProfile: false,
    activeCoopId: null,
    isAdmin: false,
    adminRole: null,
    isPlatformAdmin: false,
    error: null,
    address: null,
    userId: null,
    email: null,
    loginMethod: null,
  });
  
  // Check if the user is already authenticated
  const checkAuth = useCallback(async () => {
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));
      
      const response = await fetch('/api/auth/session');
      const data = await response.json();
      
      if (data.isLoggedIn) {
        setAuthState({
          isLoading: false,
          isAuthenticated: true,
          hasProfile: data.hasProfile,
          activeCoopId: data.activeCoopId || null,
          isAdmin: data.isAdmin || false,
          adminRole: data.adminRole || null,
          isPlatformAdmin: data.isPlatformAdmin || false,
          error: null,
          address: data.address,
          userId: data.userId || null,
          email: data.email || null,
          loginMethod: data.loginMethod || null,
        });
      } else {
        setAuthState({
          isLoading: false,
          isAuthenticated: false,
          hasProfile: false,
          activeCoopId: null,
          isAdmin: false,
          adminRole: null,
          isPlatformAdmin: false,
          error: null,
          address: null,
          userId: null,
          email: null,
          loginMethod: null,
        });
      }
    } catch {
      setAuthState({
        isLoading: false,
        isAuthenticated: false,
        hasProfile: false,
        activeCoopId: null,
        isAdmin: false,
        adminRole: null,
        isPlatformAdmin: false,
        error: 'Failed to check authentication status',
        address: null,
        userId: null,
        email: null,
        loginMethod: null,
      });
    }
  }, []);
  
  // Login with wallet
  const login = useCallback(async (coopId?: string) => {
    const targetCoopId = coopId?.trim();

    if (!targetCoopId) {
      setAuthState((prev) => ({
        ...prev,
        error: 'Coop ID is required',
      }));
      return false;
    }

    if (!isConnected || !address) {
      setAuthState((prev) => ({
        ...prev,
        error: 'Wallet not connected',
      }));
      return;
    }
    
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));
      
      // Request a challenge
      const challengeResponse = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      
      if (!challengeResponse.ok) {
        throw new Error('Failed to get challenge');
      }
      
      const { message } = await challengeResponse.json();
      
      // Sign the challenge
      const signature = await signMessageAsync({ message });
      
      // Verify the signature with coopId
      const verifyResponse = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, message, coopId: targetCoopId }),
      });
      
      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json();
        throw new Error(errorData.error || 'Failed to verify signature');
      }
      
      const { hasProfile, activeCoopId, isAdmin, adminRole, isPlatformAdmin, userId, email, loginMethod } = await verifyResponse.json();

      setAuthState({
        isLoading: false,
        isAuthenticated: true,
        hasProfile,
        activeCoopId: activeCoopId || null,
        isAdmin: isAdmin || false,
        adminRole: adminRole || null,
        isPlatformAdmin: isPlatformAdmin || false,
        error: null,
        address,
        userId: userId || null,
        email: email || null,
        loginMethod: loginMethod || 'wallet',
      });
      
      // Redirect based on profile status
      const redirectCoopId = activeCoopId || targetCoopId;
      if (!hasProfile) {
        router.push(`/portal/${redirectCoopId}/create-profile`);
      } else {
        router.push(`/portal/${redirectCoopId}`);
      }
      
      return true;
    } catch (error: any) {
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
        isAuthenticated: false,
        hasProfile: false,
        activeCoopId: null,
        isAdmin: false,
        adminRole: null,
        isPlatformAdmin: false,
        error: error.message || 'Authentication failed',
        userId: null,
        email: null,
        loginMethod: null,
      }));
      return false;
    }
  }, [address, isConnected, router, signMessageAsync]);
  
  // Logout
  const logout = useCallback(async (coopId?: string) => {
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));
      const loginCoopId = coopId || authState.activeCoopId;

      // Call logout API
      await fetch('/api/auth/logout', { method: 'POST' });

      // Disconnect wallet
      disconnect();
      posthog.reset();

      setAuthState({
        isLoading: false,
        isAuthenticated: false,
        hasProfile: false,
        activeCoopId: null,
        isAdmin: false,
        adminRole: null,
        isPlatformAdmin: false,
        error: null,
        address: null,
        userId: null,
        email: null,
        loginMethod: null,
      });

      router.push(loginCoopId ? `/login?coopId=${loginCoopId}` : '/login');

      return true;
    } catch {
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
        activeCoopId: null,
        error: 'Failed to logout',
        userId: null,
        email: null,
        loginMethod: null,
      }));
      return false;
    }
  }, [authState.activeCoopId, disconnect, router]);
  
  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);
  
  return {
    ...authState,
    login,
    logout,
    checkAuth,
  };
}

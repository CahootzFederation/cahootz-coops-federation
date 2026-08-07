'use client';

import Link from "next/link";
import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useWeb3Auth } from "@/hooks/use-web3-auth";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";
import { PortalNav } from "@/components/portal/portal-nav";
import { CoopProvider } from "@/lib/coop-context";
import { TRPCProvider } from "@/lib/trpc/provider";
import { api } from "@/lib/trpc/client";

// Wallet Auth Component
function WalletAuth({ coopId }: { coopId: string }) {
  const router = useRouter();
  const { address, isAuthenticated, isLoading, logout, activeCoopId } = useWeb3Auth();

  // Verify coopId matches session
  useEffect(() => {
    if (isAuthenticated && activeCoopId && activeCoopId !== coopId) {
      console.warn(`⚠️ Session coopId (${activeCoopId}) doesn't match route coopId (${coopId})`);
      // Redirect to correct coop or logout
      router.push(`/portal/${activeCoopId}`);
    }
  }, [isAuthenticated, activeCoopId, coopId, router]);

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2">
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        <span className="text-sm text-slate-400">Loading...</span>
      </div>
    );
  }

  if (isAuthenticated && address) {
    return (
      <div className="flex items-center space-x-4">
        <p className="text-sm text-slate-300">
          {address.slice(0, 6)}...{address.slice(-4)}
        </p>
        <Button 
          variant="destructive" 
          size="sm" 
          onClick={async () => {
            await logout(coopId);
          }}
        >
          Log Out
        </Button>
      </div>
    );
  }

  return (
    <Button 
      size="sm" 
      onClick={() => router.push(`/login?coopId=${coopId}`)}
    >
      Log In
    </Button>
  );
}

// Protected Route Component
function ProtectedRoute({ children, coopId }: { children: React.ReactNode; coopId: string }) {
  const router = useRouter();
  const { isAuthenticated, hasProfile, isLoading, activeCoopId } = useWeb3Auth();

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        router.push(`/login?coopId=${coopId}`);
      } else if (activeCoopId && activeCoopId !== coopId) {
        // Session is for different coop, redirect
        router.push(`/portal/${activeCoopId}`);
      }
    }
  }, [isLoading, isAuthenticated, activeCoopId, coopId, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="mt-4 text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (activeCoopId && activeCoopId !== coopId) {
    return null;
  }

  if (!hasProfile) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <h2 className="mb-4 text-xl font-bold">Profile Required</h2>
        <p className="mb-4 text-slate-400">
          Please complete your profile to access the portal.
        </p>
        <Button onClick={() => router.push(`/login?coopId=${coopId}`)}>
          Complete Profile
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}

function PortalLayoutContent({ children, coopId }: { children: React.ReactNode; coopId: string }) {
  const router = useRouter();
  const { data: validation, isLoading } = api.coopConfig.validateCoopId.useQuery({ coopId });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-slate-400">Validating commons...</p>
        </div>
      </div>
    );
  }

  if (!validation?.exists) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="rounded-full bg-red-500/10 p-4">
              <AlertCircle className="h-12 w-12 text-red-500" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Commons Not Found</h1>
            <p className="text-slate-400">
              The commons ID <span className="font-mono text-amber-500">{coopId}</span> does not exist or is not active.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              variant="default"
              onClick={() => router.push('/onboarding')}
            >
              View Available Commons
            </Button>
            <Button 
              variant="outline" 
              onClick={() => router.push('/')}
            >
              Go Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CoopProvider coopId={coopId}>
      <TRPCProvider coopId={coopId}>
        <div className="min-h-screen bg-[#080a0d] text-white">
          <PortalNav coopId={coopId} />
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
            <ProtectedRoute coopId={coopId}>
              {children}
            </ProtectedRoute>
          </main>
        </div>
      </TRPCProvider>
    </CoopProvider>
  );
}

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const coopId = params.coopId as string;

  if (!coopId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p>Invalid commons ID</p>
      </div>
    );
  }

  return <PortalLayoutContent coopId={coopId}>{children}</PortalLayoutContent>;
}

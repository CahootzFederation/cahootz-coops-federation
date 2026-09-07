'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useWeb3Auth } from '@/hooks/use-web3-auth';
import { Button } from '@/components/ui/button';

function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isPlatformAdmin, isLoading, email, address, logout } = useWeb3Auth();

  const isLoginPage = pathname === '/portal/admin/login';

  useEffect(() => {
    if (isLoading || isLoginPage) return;
    if (!isAuthenticated) {
      router.push('/portal/admin/login');
    }
  }, [isLoading, isLoginPage, isAuthenticated, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <p className="mt-4 text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isPlatformAdmin) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4 text-center">
        <h2 className="text-xl font-bold text-white">Access Denied</h2>
        <p className="max-w-md text-slate-400">
          {email || address} is signed in but is not on the platform admin allowlist.
        </p>
        <Button variant="outline" onClick={() => logout()}>
          Log Out
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#080a0d] text-white">
      <header className="border-b border-white/10 px-6 py-4">
        <p className="text-xs font-black uppercase tracking-normal text-orange-200">
          Cahootz Platform Admin
        </p>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        <AdminGate>{children}</AdminGate>
      </main>
    </div>
  );
}

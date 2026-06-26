'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { useAccount } from 'wagmi';
import { AlertCircle, ExternalLink } from 'lucide-react';

export default function AccessDenied() {
  const router = useRouter();
  const { open } = useWeb3Modal();
  const { address, isConnected } = useAccount();
  const [hasSoulaaniCoin, setHasSoulaaniCoin] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  // Check if the connected wallet has SoulaaniCoin
  useEffect(() => {
    const checkSoulaaniCoin = async () => {
      if (!isConnected || !address) {
        setHasSoulaaniCoin(null);
        return;
      }

      setIsChecking(true);
      try {
        // Call the API to check if the wallet has SoulaaniCoin
        const response = await fetch('/api/auth/check-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });

        if (response.ok) {
          const data = await response.json();
          setHasSoulaaniCoin(data.hasSoulaaniCoin);
        } else {
          setHasSoulaaniCoin(false);
        }
      } catch (error) {
        console.error('Error checking SoulaaniCoin balance:', error);
        setHasSoulaaniCoin(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkSoulaaniCoin();
  }, [address, isConnected]);

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-md rounded-lg bg-slate-800 p-8 text-center shadow-lg">
        <AlertCircle className="mx-auto mb-4 h-16 w-16 text-amber-500" />
        <h1 className="mb-4 text-2xl font-bold text-white">Access Denied</h1>
        
        {!isConnected ? (
          <>
            <p className="mb-6 text-slate-300">
              You need to connect your wallet to access the admin panel.
            </p>
            <Button onClick={() => open()}>Connect Wallet</Button>
          </>
        ) : hasSoulaaniCoin === false ? (
          <>
            <p className="mb-6 text-slate-300">
              You need to have SoulaaniCoin (SC) to access the admin panel. 
              SoulCoin is the governance token for Cahootz co-op members.
            </p>
            <div className="flex flex-col space-y-4">
              <Button 
                variant="outline" 
                className="flex items-center justify-center"
                onClick={() => window.open('https://cahootz.coop/get-started', '_blank')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Learn How to Get SoulaaniCoin
              </Button>
              <Button variant="secondary" onClick={() => router.push('/')}>
                Return to Home
              </Button>
            </div>
          </>
        ) : isChecking ? (
          <p className="text-slate-300">Checking your SoulaaniCoin balance...</p>
        ) : (
          <p className="text-slate-300">
            There was an error verifying your access. Please try again later.
          </p>
        )}
      </div>
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { WagmiProvider, createConfig, http  } from 'wagmi';
import type {Config} from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWeb3Modal } from '@web3modal/wagmi/react';
import { injected, walletConnect } from 'wagmi/connectors';
import { baseSepolia, base } from 'viem/chains';
import { config as appConfig } from './config';

// Create wagmi config with both Base Sepolia and Base Mainnet
const metadata = {
  name: 'Cahootz Admin',
  description: 'Cahootz co-op admin panel',
  url: appConfig.app.uri,
  icons: [`${appConfig.app.uri}/favicon.ico`],
};

const queryClient = new QueryClient();

function createWagmiConfig() {
  return createConfig({
    chains: [baseSepolia, base],
    transports: {
      [baseSepolia.id]: http('https://sepolia.base.org'),
      [base.id]: http(),
    },
    connectors: [
      injected(),
      ...(appConfig.walletConnect.projectId ? [
        walletConnect({
          projectId: appConfig.walletConnect.projectId,
          metadata,
        }),
      ] : []),
    ],
  });
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [wagmiConfig, setWagmiConfig] = useState<Config | null>(null);

  useEffect(() => {
    const nextWagmiConfig = createWagmiConfig();
    setWagmiConfig(nextWagmiConfig);
    setMounted(true);
    
    // Create web3modal only on client side if projectId is available
    if (appConfig.walletConnect.projectId && typeof window !== 'undefined') {
      createWeb3Modal({
        wagmiConfig: nextWagmiConfig,
        projectId: appConfig.walletConnect.projectId,
        enableAnalytics: false,
        themeMode: 'dark',
        themeVariables: {
          '--w3m-accent': '#3b82f6',
          '--w3m-border-radius-master': '0.5rem',
        },
      });
    }
  }, []);

  if (!mounted || !wagmiConfig) {
    return null;
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

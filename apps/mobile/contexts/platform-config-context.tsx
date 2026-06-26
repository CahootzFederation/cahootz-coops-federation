import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type CoinConfig = {
  symbol: string;   // e.g. "SC"
  name: string;     // e.g. "Cahootz Coin"
  description: string;
};

type PlatformConfigContextValue = {
  coin: CoinConfig;
  platformName: string;
  loaded: boolean;
};

const DEFAULT: PlatformConfigContextValue = {
  coin: {
    symbol: 'SC',
    name: 'Cahootz Coin',
    description: '',
  },
  platformName: 'Cahootz',
  loaded: false,
};

const PlatformConfigContext = createContext<PlatformConfigContextValue>(DEFAULT);

export function PlatformConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PlatformConfigContextValue>(DEFAULT);

  useEffect(() => {
    api.getPlatformConfig()
      .then((data) => {
        setConfig({ ...data, loaded: true });
      })
      .catch(() => {
        // Fall back to defaults silently — coin names are non-critical
        setConfig({ ...DEFAULT, loaded: true });
      });
  }, []);

  return (
    <PlatformConfigContext.Provider value={config}>
      {children}
    </PlatformConfigContext.Provider>
  );
}

/** Returns coin symbol, name, and description from DB config. Falls back to SC defaults. */
export function useCoin(): CoinConfig {
  return useContext(PlatformConfigContext).coin;
}

export function usePlatformConfig(): PlatformConfigContextValue {
  return useContext(PlatformConfigContext);
}

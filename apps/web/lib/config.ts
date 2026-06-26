/**
 * Application configuration
 * Uses environment variables with fallbacks for testing
 * 
 * NOTE: This file exports CLIENT-SAFE configuration only.
 * For server-side config (like SESSION_SECRET), use getServerConfig()
 */
import { env } from '~/env';

// Client-safe configuration (can be imported anywhere)
export const config = {
  // WalletConnect configuration
  walletConnect: {
    projectId: env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || '',
  },
  
  // App configuration
  app: {
    domain: env.NEXT_PUBLIC_DOMAIN || 'localhost',
    uri: env.NEXT_PUBLIC_URI || 'http://localhost:3000',
  },
  
  // Default chain configuration (can be overridden per-coop from database)
  chain: {
    rpcUrl: env.NEXT_PUBLIC_RPC_URL || 'https://sepolia.base.org',
  },
  
  // Feature flags
  features: {
    // Skip blockchain checks in test/development mode
    skipBlockchainChecks: env.NODE_ENV === 'test' || env.NODE_ENV === 'development',
  },
};

// Server-only configuration (use only in API routes, middleware, and server components)
export function getServerConfig() {
  const sessionSecret =
    env.SESSION_SECRET || 'complex_password_at_least_32_characters_long_for_development';
  
  return {
    session: {
      secret: sessionSecret,
      cookieName: 'cahootz_auth_session',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    },
  };
}

// Validate required configuration (server-side only)
export function validateConfig() {
  const errors: string[] = [];
  
  if (env.NODE_ENV === 'production') {
    if (!config.walletConnect.projectId) {
      errors.push('NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is required in production');
    }
    
    const serverConfig = getServerConfig();
    if (serverConfig.session.secret.includes('development')) {
      errors.push('SESSION_SECRET must be set to a secure value in production');
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

// Export default chain configuration for wagmi (Base Sepolia)
export const chainConfig = {
  id: 84532,
  name: 'Base Sepolia',
  network: 'base-sepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org'] },
    public: { http: ['https://sepolia.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
};

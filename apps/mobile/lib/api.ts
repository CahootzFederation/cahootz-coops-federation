// Expo-compatible API client for Cahootz co-op applications
// Uses native fetch API - no additional dependencies required

import { getApiUrl, getWebUrl, networkConfig } from './config';
import { coopConfig } from './coop-config';

/**
 * Resolve the coopId to use for public marketplace queries.
 * Prefer the authenticated user's coop (from coopConfig), then the
 * EXPO_PUBLIC_COOP_ID env override, and finally fall back to 'soulaan'.
 */
export function resolveCoopId(): string {
  const fromConfig = coopConfig().id;
  if (fromConfig && fromConfig !== 'default') return fromConfig;
  return 'error-no-coop-id';
}

// API configuration
export const API_BASE_URL = getApiUrl();

/**
 * Helper to create headers with optional wallet address
 * Used for authenticated requests that require wallet verification
 */
export function createApiHeaders(walletAddress?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    ...networkConfig.defaultHeaders,
  };

  // Add wallet address header if provided (for privateProcedure endpoints)
  if (walletAddress) {
    headers['x-wallet-address'] = walletAddress;
  }

  return headers;
}

// Application submission types
export interface ApplicationData {
  // Coop identification
  coopId: string;
  
  // Personal Information
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;

  // Media Uploads (optional)
  videoCID?: string;
  photoCID?: string;

  // Terms Agreement
  agreeToCoopValues: boolean;
  agreeToTerms: boolean;
  agreeToPrivacy: boolean;

  // Co-op configured question answers
  dynamicAnswers?: Record<string, any>;
  
  // Allow dynamic question answers
  [key: string]: any;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface WalletInfo {
  walletId: string | null;
  address: string;
  walletType: 'EXTERNAL' | 'MANAGED' | null;
  isPrimary: boolean;
  verifiedAt?: string;
  walletCreatedAt?: string;
  hasWallet: boolean;
}

export interface WaitlistSignupData {
  email: string;
  name?: string;
  suggestedCoop?: string;
}

// Helper functions for API calls
export const api = {
  /**
   * Submit a new application to join a Cahootz co-op
   */
  async submitApplication(data: ApplicationData) {
    const response = await fetch(`${API_BASE_URL}/trpc/application.submitApplication`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify(data)
    });

    // Always parse the response body, even for error responses
    const result = await response.json();

    console.log('📥 Raw API response:', JSON.stringify(result, null, 2));
    console.log('📥 Response status:', response.status);
    console.log('📥 Has error?', !!result.error);
    if (result.error) {
      console.log('📥 Error object:', JSON.stringify(result.error, null, 2));
      console.log('📥 Error message:', result.error.message);
    }

    // Check if there's a tRPC error in the response
    if (result.error) {
      const errorMessage = result.error.message || result.error.data?.message || 'Application submission failed';
      console.log('📥 Throwing error with message:', errorMessage);
      throw new Error(errorMessage);
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // tRPC wraps the response in result.data
    return result.result?.data;
  },

  async submitWaitlist(data: WaitlistSignupData) {
    const response = await fetch(`${getWebUrl()}/api/waitlist`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({
        email: data.email,
        name: data.name,
        source: 'hero',
        suggestedCoop: data.suggestedCoop,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Could not join the waitlist. Please try again.');
    }

    return result as { success: boolean; message: string };
  },

  /**
   * Login with email and password
   */
  async login(data: LoginData) {
    const response = await fetch(`${API_BASE_URL}/trpc/auth.login`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify(data)
    });

    // Always parse the response body, even for error responses
    const result = await response.json();
    
    // Check if there's a tRPC error in the response
    if (result.error) {
      throw new Error(result.error.message || 'Login failed');
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // tRPC wraps the response in result.data.json
    return result.result?.data;
  },

  /**
   * Check if user can login (status check)
   */
  async checkLoginStatus(email: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/auth.checkLoginStatus`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ email })
    });

    // Always parse the response body, even for error responses
    const result = await response.json();
    
    // Check if there's a tRPC error in the response
    if (result.error) {
      throw new Error(result.error.message || 'Status check failed');
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // tRPC wraps the response in result.data.json
    return result.result?.data;
  },

  /**
   * Get application status
   */
  async getApplicationStatus(userId: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/application.getApplicationStatus`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ userId })
    });

    // Always parse the response body, even for error responses
    const result = await response.json();
    
    // Check if there's a tRPC error in the response
    if (result.error) {
      throw new Error(result.error.message || 'Status check failed');
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // tRPC wraps the response in result.data.json
    return result.result?.data;
  },

  /**
   * Get full application data (for admin/review purposes)
   */
  async getApplicationData(userId: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/application.getApplicationData`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ userId })
    });

    // Always parse the response body, even for error responses
    const result = await response.json();

    // Check if there's a tRPC error in the response
    if (result.error) {
      throw new Error(result.error.message || 'Data retrieval failed');
    }

    // If HTTP status is not OK but no error in JSON, throw generic error
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // tRPC wraps the response in result.data.json
    return result.result?.data;
  },

  /**
   * Refresh user data from the server
   * Used to get updated user info including wallet address
   */
  async refreshUser(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(`${API_BASE_URL}/trpc/user.getMe?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to refresh user');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // UNITY COIN (UC) WALLET & TRANSFER FUNCTIONS
  // ──────────────────────────────────────────────────────────

  /**
   * Get wallet info for a user
   */
  async getWalletInfo(userId: string, walletAddress?: string | null): Promise<WalletInfo> {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(`${API_BASE_URL}/trpc/user.getWalletInfo?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get wallet info');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  async exportWallet(userId: string, password: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/user.exportWallet`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, password })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to export wallet');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data as { address: string; privateKey: string; warning: string };
  },

  async requestWalletChallenge(data: {
    userId: string;
    walletAddress: string;
    coopId?: string;
    purpose: string;
  }) {
    const response = await fetch(`${API_BASE_URL}/trpc/walletAuth.requestChallenge`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to request wallet challenge');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data as { challengeId: string; message: string; expiresAt: string };
  },

  async verifyWalletSignature(data: {
    challengeId: string;
    walletAddress: string;
    signature: string;
  }) {
    const response = await fetch(`${API_BASE_URL}/trpc/walletAuth.verifySignature`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to verify wallet signature');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data as {
      success: boolean;
      userId: string;
      walletAddress: string;
      verifiedAt: string;
    };
  },

  /**
   * Create a wallet for a user
   */
  async createWallet(userId: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/user.createWallet`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ userId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to create wallet');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get UC balance for a wallet
   */
  async getUCBalance(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/ucTransfer.getBalance`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ walletAddress })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get balance');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get transfer history for a wallet
   */
  async getTransferHistory(walletAddress: string, limit = 50) {
    const response = await fetch(`${API_BASE_URL}/trpc/ucTransfer.getTransferHistory`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ walletAddress, limit })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get transfer history');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Validate a recipient address for transfers
   */
  async validateRecipient(recipientAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/ucTransfer.validateRecipient`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ recipientAddress })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to validate recipient');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Find user by username for transfers
   */
  async getUserByUsername(username: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/ucTransfer.getUserByUsername`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ username })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'User not found');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Execute a UC transfer
   */
  async executeTransfer(userId: string, recipientAddress: string, amount: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/ucTransfer.executeTransfer`, {
      method: 'POST',
      headers: {
        ...networkConfig.defaultHeaders,
      },
      body: JSON.stringify({ userId, recipientAddress, amount })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Transfer failed');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get available payment processors for onramp
   * @param walletAddress - User's wallet address for authentication
   */
  async getAvailableProcessors(walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/onramp.getAvailableProcessors`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({})
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get processors');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Create payment intent for buying UC
   * @param walletAddress - User's wallet address for authentication
   */
  async createPaymentIntent(
    amountUSD: number, 
    walletAddress: string | null,
    processor?: 'stripe' | 'paypal' | 'square'
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/onramp.createPaymentIntent`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ amountUSD, processor })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to create payment intent');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get onramp transaction history
   * @param walletAddress - User's wallet address for authentication
   */
  async getOnrampHistory(walletAddress: string | null, limit = 50, offset = 0) {
    const response = await fetch(`${API_BASE_URL}/trpc/onramp.getOnrampHistory`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ limit, offset })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get onramp history');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Fund wallet with a saved card
   * Charges the saved card and mints UC to user's wallet
   * @param walletAddress - User's wallet address for authentication
   */
  async fundWithSavedCard(
    amountUSD: number,
    walletAddress: string,
    paymentMethodId?: string
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/onramp.fundWithSavedCard`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ amountUSD, paymentMethodId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to fund wallet');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get onramp transaction status
   * @param walletAddress - User's wallet address for authentication
   */
  async getOnrampStatus(transactionId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/onramp.getOnrampStatus`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ transactionId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get transaction status');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // P2P PAYMENT FUNCTIONS
  // ──────────────────────────────────────────────────────────

  /**
   * Get user's balance in USD
   */
  async getUSDBalance(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.getBalance?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get balance');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get token balances (SC and UC) from blockchain
   */
  async getTokenBalances(walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ walletAddress }));
    const response = await fetch(`${API_BASE_URL}/trpc/user.getBalances?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get token balances');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data || { sc: '0', uc: '0', scRaw: '0', ucRaw: '0' };
  },

  /**
   * Send payment to another user (Soulaan user or non-user via phone)
   */
  async sendPayment(
    userId: string,
    recipient: string,
    recipientType: 'username' | 'phone' | 'userId',
    amount: number,
    note?: string,
    walletAddress?: string | null,
    transferType: 'PERSONAL' | 'RENT' | 'SERVICE' | 'STORE' = 'PERSONAL',
    transferMetadata?: {
      rentMonth?: string;
      providerRole?: string;
      storeName?: string;
      personalNote?: string;
    }
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.sendPayment`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({
        userId,
        recipient,
        recipientType,
        amount,
        note,
        transferType,
        transferMetadata
      })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Payment failed');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Look up a recipient by username or phone
   */
  async lookupRecipient(
    query: string,
    type: 'username' | 'phone',
    walletAddress?: string | null
  ) {
    const input = encodeURIComponent(JSON.stringify({ query, type }));
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.lookupRecipient?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Lookup failed');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get P2P payment history
   */
  async getP2PHistory(userId: string, limit = 50, offset = 0, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId, limit, offset }));
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.getHistory?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get history');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get saved payment methods
   */
  async getPaymentMethods(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.getPaymentMethods?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get payment methods');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Create SetupIntent for adding a new card
   */
  async createSetupIntent(userId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.createSetupIntent`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to create setup intent');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Save payment method after SetupIntent succeeds
   */
  async savePaymentMethod(userId: string, paymentMethodId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.savePaymentMethod`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, paymentMethodId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to save payment method');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Remove a payment method
   */
  async removePaymentMethod(userId: string, paymentMethodId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.removePaymentMethod`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, paymentMethodId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to remove payment method');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(userId: string, paymentMethodId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.setDefaultPaymentMethod`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, paymentMethodId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to set default payment method');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get notifications
   */
  async getP2PNotifications(userId: string, unreadOnly = false, limit = 20, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId, unreadOnly, limit }));
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.getNotifications?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get notifications');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Mark notification as read
   */
  async markNotificationRead(notificationId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.markNotificationRead`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ notificationId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to mark notification as read');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(userId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.markAllNotificationsRead`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to mark notifications as read');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // BANK ACCOUNTS
  // ──────────────────────────────────────────────────────────

  /**
   * Get saved bank accounts
   */
  async getBankAccounts(userId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId }));
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.getBankAccounts?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get bank accounts');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Add a new bank account
   */
  async addBankAccount(
    userId: string,
    accountHolderName: string,
    routingNumber: string,
    accountNumber: string,
    bankName?: string,
    walletAddress?: string | null
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.addBankAccount`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, accountHolderName, routingNumber, accountNumber, bankName })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to add bank account');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Remove a bank account
   */
  async removeBankAccount(userId: string, bankAccountId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.removeBankAccount`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, bankAccountId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to remove bank account');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Set default bank account
   */
  async setDefaultBankAccount(userId: string, bankAccountId: string, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.setDefaultBankAccount`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, bankAccountId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to set default bank account');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // WITHDRAWALS
  // ──────────────────────────────────────────────────────────

  /**
   * Withdraw funds to bank account
   */
  async withdraw(userId: string, bankAccountId: string, amountUSD: number, walletAddress?: string | null) {
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.withdraw`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ userId, bankAccountId, amountUSD })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to process withdrawal');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get withdrawal history
   */
  async getWithdrawals(userId: string, limit = 20, offset = 0, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ userId, limit, offset }));
    const response = await fetch(`${API_BASE_URL}/trpc/p2p.getWithdrawals?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get withdrawals');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // STORE / MARKETPLACE
  // ──────────────────────────────────────────────────────────

  /**
   * Get all stores (public)
   */
  async getStores(options?: {
    category?: string;
    scVerifiedOnly?: boolean;
    featured?: boolean;
    search?: string;
    limit?: number;
    cursor?: string;
  }) {
    const input = encodeURIComponent(JSON.stringify({ coopId: resolveCoopId(), ...options }));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getStores?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get stores');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get single store details (public)
   */
  async getStore(storeId: string) {
    const input = encodeURIComponent(JSON.stringify({ storeId }));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getStore?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get store');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get products (public)
   */
  async getProducts(options: {
    coopId?: string;
    storeId?: string;
    category?: string;
    featured?: boolean;
    search?: string;
    limit?: number;
    cursor?: string;
  }) {
    // If no specific store is being queried, scope to the active coop so
    // browsing surfaces don't accidentally mix products across coops.
    const payload = options.storeId
      ? options
      : { coopId: options.coopId ?? resolveCoopId(), ...options };
    const input = encodeURIComponent(JSON.stringify(payload));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getProducts?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get products');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get single product details (public)
   */
  async getProduct(productId: string) {
    const input = encodeURIComponent(JSON.stringify({ productId }));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getProduct?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get product');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get my store (authenticated)
   */
  async getMyStore(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyStore`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message || 'Failed to fetch store');
    }
    return result.result?.data || null;
  },

  async getMyStores(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyStores`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get my store');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  async getCommerceTransaction(
    data: { userId: string; transactionId: string },
    walletAddress: string
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/commerce.getTransaction`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get commerce transaction');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  async listCommerceTransactions(
    data: {
      userId: string;
      status?: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
      businessId?: string;
      customerId?: string;
      limit?: number;
      offset?: number;
    },
    walletAddress: string
  ) {
    const input = encodeURIComponent(JSON.stringify(data));
    const response = await fetch(`${API_BASE_URL}/trpc/commerce.listTransactions?input=${input}`, {
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to list commerce transactions');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Apply to become a store (authenticated)
   */
  async applyForStore(data: {
    storeName: string;
    storeDescription: string;
    category: string;
    imageUrl?: string;
    bannerUrl?: string;
    businessName?: string;
    businessAddress?: string;
    businessCity?: string;
    businessState?: string;
    businessZip?: string;
    ownerName: string;
    ownerEmail: string;
    ownerPhone: string;
    communityBenefitStatement?: string;
    estimatedMonthlyRevenue?: string;
    websiteUrl?: string;
    socialMediaUrls?: string[];
    businessLicenseCID?: string;
  }, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.applyForStore`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to submit store application');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  async createBusinessForStore(data: {
    userId: string;
    storeId: string;
    email: string;
    businessType?: 'individual' | 'company';
    country?: string;
  }, walletAddress: string) {
    console.log('🔗 [Stripe Connect] Creating business for store', data);
    console.log('🔗 [Stripe Connect] Wallet address', walletAddress);
    console.log('🔗 [Stripe Connect] API base URL', API_BASE_URL);
    const response = await fetch(`${API_BASE_URL}/trpc/stripeConnect.createBusinessForStore`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to start Stripe onboarding');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  async syncStripeBusinessStatus(data: {
    userId: string;
    businessId: string;
  }, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/stripeConnect.syncStatus`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to sync Stripe onboarding status');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  async submitScVerificationApplication(data: {
    storeId: string;
    whyScEligible: string;
    expectedVolume?: string;
  }, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/scVerification.submitApplication`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (result.error) {
      // tRPC v11 wraps error details in a `json` envelope when no transformer is used
      const message = result.error?.json?.message || result.error?.message || 'Failed to submit SC rewards application';
      throw new Error(message);
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data ?? result.result?.data?.json;
  },

  async getMyScVerificationStatus(storeId: string, walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ storeId }));
    const response = await fetch(`${API_BASE_URL}/trpc/scVerification.getMyApplicationStatus?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      const message = result.error?.json?.message || result.error?.message || 'Failed to get SC rewards status';
      throw new Error(message);
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data ?? result.result?.data?.json;
  },

  /**
   * Get my products (authenticated - store owners)
   */
  async getMyProducts(walletAddress: string, includeInactive = false, storeId?: string) {
    const input = encodeURIComponent(JSON.stringify({ includeInactive, storeId }));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyProducts?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get my products');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Add a product (authenticated - store owners)
   */
  async addProduct(data: {
    storeId: string;
    name: string;
    description?: string;
    category: string;
    imageUrl?: string;
    images?: string[];
    priceUSD: number;
    ucDiscountPrice?: number;
    sku?: string;
    quantity?: number;
    trackInventory?: boolean;
    allowBackorder?: boolean;
  }, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.addProduct`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to add product');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Update a product (authenticated - store owners)
   */
  async updateProduct(productId: string, data: {
    name?: string;
    description?: string;
    category?: string;
    imageUrl?: string | null;
    images?: string[];
    priceUSD?: number;
    ucDiscountPrice?: number | null;
    sku?: string | null;
    quantity?: number;
    trackInventory?: boolean;
    allowBackorder?: boolean;
    isActive?: boolean;
  }, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.updateProduct`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ productId, ...data })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to update product');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Delete a product (authenticated - store owners)
   */
  async deleteProduct(productId: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.deleteProduct`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ productId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to delete product');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get featured products for home page (public)
   */
  async getFeaturedProducts(limit?: number) {
    const input = encodeURIComponent(JSON.stringify({ limit: limit || 8 }));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getFeaturedProducts?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get featured products');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data || [];
  },

  // ──────────────────────────────────────────────────────────
  // STORE QUICK PAYMENT
  // ──────────────────────────────────────────────────────────

  /**
   * Get store's quick pay info (for store owners)
   */
  async getQuickPayInfo(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.getQuickPayInfo`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get quick pay info');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Generate or set store's short code
   */
  async generateShortCode(customCode: string | undefined, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.generateShortCode`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ customCode })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to generate short code');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Check if a short code is available
   */
  async validateShortCode(code: string, walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ code }));
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.validateShortCode?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to validate short code');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Create a payment request (generates QR/link)
   */
  async createPaymentRequest(
    data: {
      amount?: number;
      description?: string;
      referenceId?: string;
      expiresInMinutes?: number;
    },
    walletAddress: string
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.createPaymentRequest`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to create payment request');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get payment request info by token (public)
   */
  async getPaymentRequest(token: string) {
    const input = encodeURIComponent(JSON.stringify({ token }));
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.getPaymentRequest?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get payment request');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Pay a payment request
   */
  async payRequest(token: string, amount: number, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.payRequest`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ token, amount })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Payment failed');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get store by short code (public)
   */
  async getStoreByCode(code: string) {
    const input = encodeURIComponent(JSON.stringify({ code }));
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.getStoreByCode?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get store');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Pay a store directly by code
   */
  async payByStoreCode(
    storeCode: string,
    amount: number,
    note: string | undefined,
    walletAddress: string
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.payByStoreCode`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ storeCode, amount, note })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Payment failed');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get store's payment request history
   */
  async getMyPaymentRequests(
    status: string | undefined,
    limit: number | undefined,
    cursor: string | undefined,
    walletAddress: string
  ) {
    const input = encodeURIComponent(JSON.stringify({ status, limit, cursor }));
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.getMyPaymentRequests?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get payment requests');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Cancel a payment request
   */
  async cancelPaymentRequest(requestId: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/storePay.cancelPaymentRequest`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ requestId })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to cancel payment request');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // CATEGORIES
  // ──────────────────────────────────────────────────────────

  /**
   * Get store categories (public)
   */
  async getStoreCategories(includeAdminOnly = false) {
    const input = encodeURIComponent(JSON.stringify({ includeAdminOnly }));
    const response = await fetch(`${API_BASE_URL}/trpc/categories.getStoreCategories?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get store categories');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ──────────────────────────────────────────────────────────
  // ORDERS
  // ──────────────────────────────────────────────────────────

  /**
   * Create an order from cart items
   */
  async createOrder(
    data: {
      storeId: string;
      items: { productId: string; quantity: number }[];
      shippingAddress?: string;
      note?: string;
    },
    walletAddress: string
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.createOrder`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to create order');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get buyer's order history
   */
  async getMyOrders(walletAddress: string, limit = 20, cursor?: string) {
    const input = encodeURIComponent(JSON.stringify({ limit, cursor }));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getMyOrders?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get orders');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get single order details
   */
  async getOrder(orderId: string, walletAddress: string) {
    const input = encodeURIComponent(JSON.stringify({ orderId }));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getOrder?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get order');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get store's incoming orders (for store owners)
   */
  async getStoreOrders(
    walletAddress: string,
    options?: { storeId?: string; status?: string; limit?: number; cursor?: string }
  ) {
    const input = encodeURIComponent(JSON.stringify(options || {}));
    const response = await fetch(`${API_BASE_URL}/trpc/store.getStoreOrders?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get store orders');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Update order fulfillment status (for store owners)
   */
  async updateOrderStatus(
    orderId: string,
    status: 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED',
    trackingNumber: string | undefined,
    walletAddress: string
  ) {
    const response = await fetch(`${API_BASE_URL}/trpc/store.updateOrderStatus`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ orderId, status, trackingNumber })
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to update order status');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get product categories (public)
   */
  async getProductCategories(includeAdminOnly = false) {
    const input = encodeURIComponent(JSON.stringify({ includeAdminOnly }));
    const response = await fetch(`${API_BASE_URL}/trpc/categories.getProductCategories?input=${input}`, {
      method: 'GET',
      headers: {
        ...networkConfig.defaultHeaders,
      },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get product categories');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SC REWARDS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get user's SC reward history
   */
  async getUserSCRewards(userId: string, limit = 10, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ 
      userId, 
      status: 'COMPLETED', // Only show completed rewards
      limit,
      offset: 0 
    }));
    const response = await fetch(`${API_BASE_URL}/trpc/scRewards.getSCRewards?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get SC rewards');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get user's notifications
   */
  async getNotifications(
    walletAddress: string,
    options?: { limit?: number; cursor?: string; unreadOnly?: boolean }
  ) {
    const input = encodeURIComponent(JSON.stringify(options || {}));
    const response = await fetch(`${API_BASE_URL}/trpc/notification.getNotifications?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get notifications');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Get unread notification count
   */
  async getUnreadNotificationCount(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/notification.getUnreadCount`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get unread count');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(notificationId: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/notification.markAsRead`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ notificationId }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to mark as read');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  // ── Coop Config ────────────────────────────────────────────────────────────

  /**
   * Get list of available coops for onboarding
   */
  async listAvailableCoops() {
    const response = await fetch(`${API_BASE_URL}/trpc/coopConfig.listAvailableCoops?input={}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get available coops');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return result.result?.data as {
      id: string;
      name: string;
      tagline: string;
      description: string;
      mission: string;
      features: { title: string; description: string }[];
      eligibility: string;
      bgColor: string;
      accentColor: string;
    }[];
  },

  /**
   * Get the active CoopConfig (includes proposalCategories for label lookup)
   */
  async getCoopConfig(coopId: string) {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(`${API_BASE_URL}/trpc/coopConfig.getActive?input=${input}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await response.json();
    if (result.error) return null;
    return result.result?.data as {
      proposalCategories: { key: string; label: string; isActive: boolean }[];
    } | null;
  },

  // ── Proposals ──────────────────────────────────────────────────────────────

  /**
   * List proposals with optional status filter
   */
  async listProposals(
    options: { status?: string; limit?: number; offset?: number } = {},
    walletAddress?: string | null,
  ) {
    const input = encodeURIComponent(
      JSON.stringify({ status: options.status, limit: options.limit ?? 20, offset: options.offset ?? 0 }),
    );
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.list?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to load proposals');
    return result.result?.data as { proposals: any[]; total: number; hasMore: boolean };
  },

  /**
   * Get a single proposal by ID
   */
  async getProposal(id: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ id }));
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.getById?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to load proposal');
    return result.result?.data;
  },

  /**
   * Get proposals submitted by a specific wallet address
   */
  async getMyProposals(walletAddress: string, limit = 20, offset = 0) {
    const input = encodeURIComponent(JSON.stringify({ wallet: walletAddress, limit, offset }));
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.getByProposer?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to load proposals');
    return result.result?.data as { proposals: any[]; total: number };
  },

  /**
   * Submit a new proposal (authenticated — requires wallet)
   */
  async createProposal(text: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.create`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ text }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to submit proposal');
    return result.result?.data;
  },

  /**
   * List comments for a proposal
   */
  async listProposalComments(proposalId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ proposalId, limit: 50, offset: 0 }));
    const response = await fetch(`${API_BASE_URL}/trpc/proposalComment.listByProposal?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to load comments');
    return result.result?.data as { comments: any[]; total: number };
  },

  /**
   * Post a comment on a proposal (authenticated — requires wallet)
   */
  async createProposalComment(proposalId: string, content: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposalComment.create`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ proposalId, content }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to post comment');
    return result.result?.data;
  },

  /**
   * React to a proposal (toggle support/concern)
   * Authenticated — requires wallet address
   */
  async reactToProposal(proposalId: string, reaction: 'SUPPORT' | 'CONCERN', walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposalReaction.upsert`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ proposalId, reaction }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to react');
    return result.result?.data as { support: number; concern: number; myReaction: 'SUPPORT' | 'CONCERN' | null };
  },

  /**
   * Get reaction counts for a proposal
   */
  async getReactionCounts(proposalId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ proposalId, walletAddress: walletAddress ?? undefined }));
    const response = await fetch(`${API_BASE_URL}/trpc/proposalReaction.getCounts?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to get reaction counts');
    return result.result?.data as { support: number; concern: number; myReaction: 'SUPPORT' | 'CONCERN' | null };
  },

  /**
   * Withdraw a proposal (proposer only)
   */
  async withdrawProposal(id: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.withdraw`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ id }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to withdraw proposal');
    return result.result?.data;
  },

  /**
   * Cast a council vote on a proposal (admin only)
   */
  async councilVote(proposalId: string, vote: 'FOR' | 'AGAINST' | 'ABSTAIN', walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.councilVote`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ proposalId, vote }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to cast council vote');
    return result.result?.data as { vote: string; forCount: number; againstCount: number; abstainCount: number; newStatus: string | null };
  },

  /**
   * Resubmit / edit a proposal (proposer only, status must be submitted or votable)
   */
  async resubmitProposal(proposalId: string, text: string, walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.resubmit`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({ proposalId, text }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to resubmit proposal');
    return result.result?.data;
  },

  /**
   * Get the full submission audit trail for a proposal (all revisions)
   */
  async getProposalRevisions(proposalId: string, walletAddress?: string | null) {
    const input = encodeURIComponent(JSON.stringify({ proposalId }));
    const response = await fetch(`${API_BASE_URL}/trpc/proposal.getRevisions?input=${input}`, {
      method: 'GET',
      headers: createApiHeaders(walletAddress),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Failed to load revision history');
    return result.result?.data as {
      id: string;
      revisionNumber: number;
      submittedAt: string;
      rawText?: string;
      evaluation?: any;
      decision?: string;
      decisionReasons: string[];
      auditChecks: any[];
      status: string;
      engineVersion: string;
    }[];
  },

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(walletAddress: string) {
    const response = await fetch(`${API_BASE_URL}/trpc/notification.markAllAsRead`, {
      method: 'POST',
      headers: createApiHeaders(walletAddress),
      body: JSON.stringify({}),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to mark all as read');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data;
  },

  async getActiveFeeConfig(walletAddress?: string | null): Promise<{
    id: string;
    platformMarkupBps: number;
    merchantFeeBps: number;
    treasuryFeeBps: number;
  }> {
    const response = await fetch(`${API_BASE_URL}/trpc/treasuryLedger.getActiveFeeConfig`, {
      method: 'GET',
      headers: walletAddress ? createApiHeaders(walletAddress) : { ...networkConfig.defaultHeaders },
    });

    const result = await response.json();
    if (result.error) {
      const message = result.error?.json?.message || result.error?.message || 'Failed to load fee config';
      throw new Error(message);
    }

    return result.result?.data ?? result.result?.data?.json ?? {
      id: 'default',
      platformMarkupBps: 400,
      merchantFeeBps: 0,
      treasuryFeeBps: 400,
    };
  },

  async getPlatformConfig(): Promise<{
    coin: { symbol: string; name: string; description: string };
    platformName: string;
  }> {
    const response = await fetch(`${API_BASE_URL}/trpc/platformConfig.getConfig`, {
      method: 'GET',
      headers: { ...networkConfig.defaultHeaders },
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to load platform config');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return result.result?.data ?? {
      coin: { symbol: 'SC', name: 'Cahootz Coin', description: '' },
      platformName: 'Cahootz',
    };
  },

    /**
   * Get application questions for a specific coop
   */
    async getApplicationQuestions(coopId: string) {
      const response = await fetch(`${API_BASE_URL}/trpc/coopConfig.getApplicationQuestions?input=${encodeURIComponent(JSON.stringify({ coopId }))}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
  
      const result = await response.json();
      if (result.error) {
        throw new Error(result.error.message || 'Failed to get application questions');
      }
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      return result.result?.data as {
        questions: {
          id: string;
          type: string;
          label: string;
          description?: string;
          placeholder?: string;
          required: boolean;
          options?: { value: string; label: string }[];
          validation?: Record<string, unknown>;
        }[];
      };
    }
};

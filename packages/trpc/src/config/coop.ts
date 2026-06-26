/**
 * Coop-specific configuration
 * These values are loaded from environment variables per deployment
 */

export interface CoopConfig {
  // Identity
  name: string;
  shortName: string;
  tagline: string;

  // URLs
  appUrl: string;
  webUrl: string;
  iosAppStoreUrl: string;
  androidPlayStoreUrl: string;

  // Branding
  primaryColor: string;
  accentColor: string;
  logoUrl: string;

  // Payment settings
  minPaymentAmount: number;
  maxPaymentAmount: number;
  claimExpirationDays: number;
  withdrawalMinAmount: number;

  // Fees (as decimals, e.g., 0.01 = 1%)
  p2pFeePercent: number;
  withdrawalFeePercent: number;
  withdrawalFeeFlat: number;

  // Support
  supportEmail: string;
  supportPhone: string;
}

// Load configuration from environment variables
export function getCoopConfig(): CoopConfig {
  return {
    // Identity
    name: process.env.COOP_NAME || '???',
    shortName: process.env.COOP_SHORT_NAME || '???',
    tagline: process.env.COOP_TAGLINE || 'Building Generational Wealth Together',

    // URLs
    appUrl: process.env.APP_URL || 'https://app.cahootz.coop',
    webUrl: process.env.WEB_URL || 'https://cahootz.coop',
    iosAppStoreUrl: process.env.IOS_APP_STORE_URL || 'https://apps.apple.com/app/soulaan',
    androidPlayStoreUrl: process.env.ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.soulaan',

    // Branding
    primaryColor: process.env.COOP_PRIMARY_COLOR || '#2563eb', // blue-600
    accentColor: process.env.COOP_ACCENT_COLOR || '#16a34a', // green-600
    logoUrl: process.env.COOP_LOGO_URL || '/logo.png',

    // Payment settings
    minPaymentAmount: parseFloat(process.env.MIN_PAYMENT_AMOUNT || '0.01'),
    maxPaymentAmount: parseFloat(process.env.MAX_PAYMENT_AMOUNT || '10000'),
    claimExpirationDays: parseInt(process.env.CLAIM_EXPIRATION_DAYS || '7', 10),
    withdrawalMinAmount: parseFloat(process.env.WITHDRAWAL_MIN_AMOUNT || '1'),

    // Fees
    p2pFeePercent: parseFloat(process.env.P2P_FEE_PERCENT || '0'),
    withdrawalFeePercent: parseFloat(process.env.WITHDRAWAL_FEE_PERCENT || '0'),
    withdrawalFeeFlat: parseFloat(process.env.WITHDRAWAL_FEE_FLAT || '0'),

    // Support
    supportEmail: process.env.RESEND_FROM_EMAIL || 'support@mail.cahootzcoops.com',
    supportPhone: process.env.SUPPORT_PHONE || '',
  };
}

// Singleton for performance
let cachedConfig: CoopConfig | null = null;

export function coopConfig(): CoopConfig {
  if (!cachedConfig) {
    cachedConfig = getCoopConfig();
  }
  return cachedConfig;
}

// Helper to reset cache (useful for testing)
export function resetCoopConfigCache(): void {
  cachedConfig = null;
}

/**
 * Feature Flag Service - Runtime feature toggles
 * 
 * Enables gradual rollout of hybrid architecture without breaking existing flows.
 * Allows A/B testing and safe rollback.
 */

import { db } from '@repo/db';

// Feature flag keys
export const FEATURE_FLAGS = {
  // Hybrid architecture flags
  HYBRID_PAYMENTS_ENABLED: 'hybrid_payments_enabled',
  STRIPE_CONNECT_ONBOARDING: 'stripe_connect_onboarding',
  NEW_WEBHOOK_HANDLER: 'new_webhook_handler',
  SC_TOKEN_SERVICE: 'sc_token_service',
  TREASURY_LEDGER: 'treasury_ledger',
  
  // Auth flags
  WALLET_AUTH_V2: 'wallet_auth_v2',
  SESSION_MANAGEMENT: 'session_management',
  ADMIN_MFA: 'admin_mfa',

  // Proactive Sage member/community memory workflows. Both default off so
  // policy review and staged rollout can happen independently.
  SAGE_WEEKLY_OUTREACH: 'sage_weekly_outreach',
  SAGE_COMMUNITY_MEMORY: 'sage_community_memory',
  SAGE_PRIVATE_SAFETY_RESPONSE: 'sage_private_safety_response',
  
  // UC-era compatibility flags (keep these for future reactivation)
  UC_ONRAMP_ENABLED: 'uc_onramp_enabled',
  UC_P2P_ENABLED: 'uc_p2p_enabled',
  UC_WITHDRAWALS_ENABLED: 'uc_withdrawals_enabled',
} as const;

/**
 * Check if a feature flag is enabled
 * 
 * @param key - Feature flag key
 * @returns Boolean indicating if feature is enabled
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({
    where: { key },
  });

  if (!flag) {
    // Default to disabled for unknown flags
    return false;
  }

  return flag.enabled;
}

/**
 * Enable a feature flag
 * 
 * @param key - Feature flag key
 * @param description - Optional description
 * @param metadata - Optional metadata
 */
export async function enableFeature(
  key: string,
  description?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.featureFlag.upsert({
    where: { key },
    create: {
      key,
      enabled: true,
      description,
      metadata: metadata as any,
    },
    update: {
      enabled: true,
      description,
      metadata: metadata as any,
    },
  });

  console.log(`✅ [Feature Flags] Enabled: ${key}`);
}

/**
 * Disable a feature flag
 * 
 * @param key - Feature flag key
 */
export async function disableFeature(key: string): Promise<void> {
  await db.featureFlag.update({
    where: { key },
    data: { enabled: false },
  });

  console.log(`❌ [Feature Flags] Disabled: ${key}`);
}

/**
 * Get all feature flags
 * 
 * @returns Array of all feature flags
 */
export async function getAllFeatureFlags(): Promise<
  Array<{
    key: string;
    enabled: boolean;
    description: string | null;
    metadata: any;
  }>
> {
  const flags = await db.featureFlag.findMany({
    orderBy: { key: 'asc' },
  });

  return flags.map((flag) => ({
    key: flag.key,
    enabled: flag.enabled,
    description: flag.description,
    metadata: flag.metadata,
  }));
}

/**
 * Initialize default feature flags
 * Should be run once during deployment
 */
export async function initializeDefaultFlags(): Promise<void> {
  console.log(`🚩 [Feature Flags] Initializing default flags...`);

  const defaultFlags = [
    // Hybrid architecture flags (start disabled)
    { key: FEATURE_FLAGS.HYBRID_PAYMENTS_ENABLED, enabled: false, description: 'Enable hybrid Stripe + SC payment flows' },
    { key: FEATURE_FLAGS.STRIPE_CONNECT_ONBOARDING, enabled: false, description: 'Enable Stripe Connect business onboarding' },
    { key: FEATURE_FLAGS.NEW_WEBHOOK_HANDLER, enabled: false, description: 'Use new webhook handler with bounded contexts' },
    { key: FEATURE_FLAGS.SC_TOKEN_SERVICE, enabled: false, description: 'Use new idempotent SC token service' },
    { key: FEATURE_FLAGS.TREASURY_LEDGER, enabled: false, description: 'Use new treasury ledger accounting' },
    
    // Auth flags (start disabled)
    { key: FEATURE_FLAGS.WALLET_AUTH_V2, enabled: false, description: 'Use challenge-based wallet authentication' },
    { key: FEATURE_FLAGS.SESSION_MANAGEMENT, enabled: false, description: 'Enable session-based auth' },
    { key: FEATURE_FLAGS.ADMIN_MFA, enabled: false, description: 'Require MFA for admin operations' },
    { key: FEATURE_FLAGS.SAGE_WEEKLY_OUTREACH, enabled: false, description: 'Send one private weekly Sage check-in on each member\'s stable weekday', metadata: { scheduleVersion: 'v1' } },
    { key: FEATURE_FLAGS.SAGE_COMMUNITY_MEMORY, enabled: false, description: 'Consolidate consented member signals into Sage-internal Commons hypotheses' },
    { key: FEATURE_FLAGS.SAGE_PRIVATE_SAFETY_RESPONSE, enabled: false, description: 'Use the reviewed private urgent-disclosure response path' },
    
    // UC-era compatibility flags (start enabled, will be disabled during migration)
    { key: FEATURE_FLAGS.UC_ONRAMP_ENABLED, enabled: true, description: 'Enable UC onramp (legacy)' },
    { key: FEATURE_FLAGS.UC_P2P_ENABLED, enabled: true, description: 'Enable UC P2P transfers (legacy)' },
    { key: FEATURE_FLAGS.UC_WITHDRAWALS_ENABLED, enabled: true, description: 'Enable UC withdrawals (legacy)' },
  ];

  for (const flag of defaultFlags) {
    await db.featureFlag.upsert({
      where: { key: flag.key },
      create: flag,
      update: {}, // Don't overwrite existing flags
    });
  }

  console.log(`✅ [Feature Flags] Initialized ${defaultFlags.length} default flags`);
}

/**
 * Check if hybrid architecture is fully enabled
 * 
 * @returns Boolean indicating if all hybrid features are enabled
 */
export async function isHybridArchitectureEnabled(): Promise<boolean> {
  const flags = await Promise.all([
    isFeatureEnabled(FEATURE_FLAGS.HYBRID_PAYMENTS_ENABLED),
    isFeatureEnabled(FEATURE_FLAGS.STRIPE_CONNECT_ONBOARDING),
    isFeatureEnabled(FEATURE_FLAGS.NEW_WEBHOOK_HANDLER),
    isFeatureEnabled(FEATURE_FLAGS.SC_TOKEN_SERVICE),
    isFeatureEnabled(FEATURE_FLAGS.TREASURY_LEDGER),
  ]);

  return flags.every((flag) => flag === true);
}

/**
 * Check if UC-era features are still enabled
 * 
 * @returns Boolean indicating if any UC features are enabled
 */
export async function isUCEraEnabled(): Promise<boolean> {
  const flags = await Promise.all([
    isFeatureEnabled(FEATURE_FLAGS.UC_ONRAMP_ENABLED),
    isFeatureEnabled(FEATURE_FLAGS.UC_P2P_ENABLED),
    isFeatureEnabled(FEATURE_FLAGS.UC_WITHDRAWALS_ENABLED),
  ]);

  return flags.some((flag) => flag === true);
}

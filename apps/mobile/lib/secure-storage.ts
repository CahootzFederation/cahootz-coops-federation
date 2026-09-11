import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secure storage utility
 * Uses Expo SecureStore on native (iOS/Android) and localStorage on web
 * Data is encrypted on native platforms (Keychain on iOS, EncryptedSharedPreferences on Android)
 */

const STORAGE_KEYS = {
  USER: 'cahootz.user',
  LOGIN_TIME: 'cahootz.loginTime',
  SESSION_TOKEN: 'cahootz.sessionToken',
  PROFILE_ONBOARDING_DEFERRED_USER: 'cahootz.profileOnboardingDeferredUser',
} as const;

const LEGACY_STORAGE_KEYS = {
  USER: 'soulaan.user',
  LOGIN_TIME: 'soulaan.loginTime',
  SESSION_TOKEN: 'soulaan.sessionToken',
  PROFILE_ONBOARDING_DEFERRED_USER: 'soulaan.profileOnboardingDeferredUser',
} as const;

const WALLET_KEY_PREFIX = 'cahootz.wallet.privateKey';
const LEGACY_WALLET_KEY_PREFIX = 'soulaan.wallet.privateKey';

const isWeb = Platform.OS === 'web';

function legacyKeyFor(key: string): string | null {
  const keyEntry = Object.entries(STORAGE_KEYS).find(([, currentKey]) => currentKey === key);
  if (keyEntry) {
    const [name] = keyEntry as [keyof typeof STORAGE_KEYS, string];
    return LEGACY_STORAGE_KEYS[name];
  }

  if (key.startsWith(`${WALLET_KEY_PREFIX}.`)) {
    return key.replace(WALLET_KEY_PREFIX, LEGACY_WALLET_KEY_PREFIX);
  }

  return null;
}

async function setRawItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }

    throw new Error('localStorage not available');
  }

  await SecureStore.setItemAsync(key, value);
}

async function getRawItem(key: string): Promise<string | null> {
  if (isWeb) {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }

    return null;
  }

  return SecureStore.getItemAsync(key);
}

async function removeRawItem(key: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }

    return;
  }

  await SecureStore.deleteItemAsync(key);
}

export const secureStorage = {
  /**
   * Store a value securely
   */
  async setItem(key: string, value: string): Promise<void> {
    try {
      await setRawItem(key, value);
    } catch (error) {
      console.error('Error storing secure data:', error);
      throw new Error('Failed to store data securely');
    }
  },

  /**
   * Retrieve a value from secure storage
   */
  async getItem(key: string): Promise<string | null> {
    try {
      const currentValue = await getRawItem(key);
      if (currentValue) {
        return currentValue;
      }

      const legacyKey = legacyKeyFor(key);
      if (!legacyKey) {
        return null;
      }

      const legacyValue = await getRawItem(legacyKey);
      if (!legacyValue) {
        return null;
      }

      try {
        await setRawItem(key, legacyValue);
        await removeRawItem(legacyKey);
      } catch (migrationError) {
        console.warn('Secure storage key migration skipped:', migrationError);
      }

      return legacyValue;
    } catch (error) {
      console.error('Error retrieving secure data:', error);
      return null;
    }
  },

  /**
   * Remove a value from secure storage
   */
  async removeItem(key: string): Promise<void> {
    try {
      await removeRawItem(key);

      const legacyKey = legacyKeyFor(key);
      if (legacyKey) {
        await removeRawItem(legacyKey);
      }
    } catch (error) {
      console.error('Error removing secure data:', error);
      throw new Error('Failed to remove data');
    }
  },

  /**
   * Clear all authentication data
   */
  async clear(): Promise<void> {
    try {
      await Promise.all([
        ...Object.values(STORAGE_KEYS).map((key) => removeRawItem(key)),
        ...Object.values(LEGACY_STORAGE_KEYS).map((key) => removeRawItem(key)),
      ]);
    } catch (error) {
      console.error('Error clearing secure storage:', error);
      throw new Error('Failed to clear storage');
    }
  },

  /**
   * Get storage keys
   */
  keys: STORAGE_KEYS,
  legacyKeys: LEGACY_STORAGE_KEYS,
};

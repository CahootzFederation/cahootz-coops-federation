import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secure storage utility
 * Uses Expo SecureStore on native (iOS/Android) and localStorage on web
 * Data is encrypted on native platforms (Keychain on iOS, EncryptedSharedPreferences on Android)
 */

const STORAGE_KEYS = {
  USER: 'soulaan.user',
  LOGIN_TIME: 'soulaan.loginTime',
  SESSION_TOKEN: 'soulaan.sessionToken',
} as const;

const isWeb = Platform.OS === 'web';

export const secureStorage = {
  /**
   * Store a value securely
   */
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (isWeb) {
        // Use localStorage on web
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
        } else {
          throw new Error('localStorage not available');
        }
      } else {
        // Use SecureStore on native
        await SecureStore.setItemAsync(key, value);
      }
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
      if (isWeb) {
        // Use localStorage on web
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
        return null;
      } else {
        // Use SecureStore on native
        return await SecureStore.getItemAsync(key);
      }
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
      if (isWeb) {
        // Use localStorage on web
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
      } else {
        // Use SecureStore on native
        await SecureStore.deleteItemAsync(key);
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
      if (isWeb) {
        // Clear specific keys on web
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(STORAGE_KEYS.USER);
          window.localStorage.removeItem(STORAGE_KEYS.LOGIN_TIME);
          window.localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
        }
      } else {
        // Clear on native
        await Promise.all([
          SecureStore.deleteItemAsync(STORAGE_KEYS.USER),
          SecureStore.deleteItemAsync(STORAGE_KEYS.LOGIN_TIME),
          SecureStore.deleteItemAsync(STORAGE_KEYS.SESSION_TOKEN),
        ]);
      }
    } catch (error) {
      console.error('Error clearing secure storage:', error);
      throw new Error('Failed to clear storage');
    }
  },

  /**
   * Get storage keys
   */
  keys: STORAGE_KEYS,
};

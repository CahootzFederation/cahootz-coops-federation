import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

import { secureStorage } from '@/lib/secure-storage';

export const UPDATE_CHANNEL_DEBUG_EMAILS = Object.freeze([
  'admin@cahootz.coop',
  'deon@appmunki.com',
  'deon.robinson.sf@gmail.com',
  'deon@dockpad.io',
]) as readonly string[];

export const UPDATE_DEBUG_CHANNELS = Object.freeze([
  'production',
  'preview',
  'development',
]) as readonly string[];

export type UpdateDebugChannel = (typeof UPDATE_DEBUG_CHANNELS)[number];

const UPDATE_CHANNEL_HEADER = 'expo-channel-name';
const UPDATE_CHANNEL_OVERRIDE_STORAGE_KEY = 'cahootz.updateChannelOverride';

export function normalizeDebugEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? '';
}

export function canAccessUpdateChannelDebug(email?: string | null) {
  const normalizedEmail = normalizeDebugEmail(email);
  return UPDATE_CHANNEL_DEBUG_EMAILS.includes(normalizedEmail);
}

export function isUpdateDebugChannel(channel: string | null): channel is UpdateDebugChannel {
  return UPDATE_DEBUG_CHANNELS.includes(channel as UpdateDebugChannel);
}

export async function getStoredUpdateChannelOverride() {
  const storedChannel = await secureStorage.getItem(UPDATE_CHANNEL_OVERRIDE_STORAGE_KEY);
  return isUpdateDebugChannel(storedChannel) ? storedChannel : null;
}

export async function setUpdateChannelOverride(channel: UpdateDebugChannel) {
  if (Platform.OS === 'web') {
    throw new Error('EAS update channel switching is only available in native builds.');
  }

  Updates.setUpdateRequestHeadersOverride({ [UPDATE_CHANNEL_HEADER]: channel });
  await secureStorage.setItem(UPDATE_CHANNEL_OVERRIDE_STORAGE_KEY, channel);
}

export async function clearUpdateChannelOverride() {
  if (Platform.OS === 'web') {
    await secureStorage.removeItem(UPDATE_CHANNEL_OVERRIDE_STORAGE_KEY);
    return;
  }

  Updates.setUpdateRequestHeadersOverride(null);
  await secureStorage.removeItem(UPDATE_CHANNEL_OVERRIDE_STORAGE_KEY);
}

export async function clearUpdateChannelOverrideQuietly() {
  try {
    await clearUpdateChannelOverride();
  } catch (error) {
    console.warn('Unable to clear update channel override:', error);
  }
}

import React from 'react';
import { ActivityIndicator, Alert, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { ArrowLeft, CheckCircle2, RadioTower, RotateCcw } from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import {
  UPDATE_DEBUG_CHANNELS,
  canAccessUpdateChannelDebug,
  clearUpdateChannelOverride,
  getStoredUpdateChannelOverride,
  setUpdateChannelOverride,
  type UpdateDebugChannel,
} from '@/lib/update-channel-debug';

const DEBUG_THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  dark: '#0F172A',
  success: '#16A34A',
};

function shortUpdateId(updateId: string | null) {
  return updateId ? `${updateId.slice(0, 8)}...${updateId.slice(-6)}` : 'Embedded or local';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to switch update channels.';
}

export default function DebugUpdatesScreen() {
  const { user } = useAuth();
  const [storedOverride, setStoredOverride] = React.useState<UpdateDebugChannel | null>(null);
  const [busyChannel, setBusyChannel] = React.useState<UpdateDebugChannel | 'reset' | null>(null);
  const [statusText, setStatusText] = React.useState('Choose a channel to check for a compatible update.');

  const canAccess = canAccessUpdateChannelDebug(user?.email);

  React.useEffect(() => {
    if (!canAccess) return;

    getStoredUpdateChannelOverride()
      .then(setStoredOverride)
      .catch((error) => {
        console.warn('Unable to read stored update channel override:', error);
      });
  }, [canAccess]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(authenticated)/profile' as any);
  };

  const promptReload = (title: string, message: string) => {
    Alert.alert(title, message, [
      { text: 'Later', style: 'cancel' },
      { text: 'Reload Now', onPress: () => void Updates.reloadAsync() },
    ]);
  };

  const handleSwitchChannel = async (channel: UpdateDebugChannel) => {
    if (!canAccess || busyChannel) return;

    setBusyChannel(channel);
    setStatusText(`Switching update requests to ${channel}...`);

    try {
      await setUpdateChannelOverride(channel);
      setStoredOverride(channel);

      setStatusText(`Checking ${channel} for a compatible update...`);
      const checkResult = await Updates.checkForUpdateAsync();
      if (!checkResult.isAvailable && !checkResult.isRollBackToEmbedded) {
        setStatusText(`No compatible ${channel} update is available for runtime ${Updates.runtimeVersion ?? 'unknown'}.`);
        Alert.alert('No update found', `This build is now set to request ${channel}, but Expo did not find a newer compatible update.`);
        return;
      }

      setStatusText(`Downloading the ${channel} update...`);
      const fetchResult = await Updates.fetchUpdateAsync();
      if (fetchResult.isNew || fetchResult.isRollBackToEmbedded) {
        setStatusText(`Downloaded ${channel}. Reload to run it.`);
        promptReload('Update ready', `The ${channel} update is downloaded. Reload the app to run it.`);
        return;
      }

      setStatusText(`The ${channel} update is already cached or current.`);
      promptReload('Channel switched', `Reload the app to request ${channel} on startup.`);
    } catch (error) {
      const message = getErrorMessage(error);
      setStatusText(message);
      Alert.alert('Channel switch failed', message);
    } finally {
      setBusyChannel(null);
    }
  };

  const handleResetChannel = async () => {
    if (!canAccess || busyChannel) return;

    setBusyChannel('reset');
    setStatusText('Clearing channel override...');

    try {
      await clearUpdateChannelOverride();
      setStoredOverride(null);
      setStatusText('Channel override cleared. Reload to return to this build channel.');
      promptReload('Override cleared', 'Reload the app to return to the channel baked into this build.');
    } catch (error) {
      const message = getErrorMessage(error);
      setStatusText(message);
      Alert.alert('Could not clear override', message);
    } finally {
      setBusyChannel(null);
    }
  };

  if (!canAccess) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: DEBUG_THEME.paper }}>
        <View className="border-b bg-white px-3 pt-3 pb-2" style={{ borderColor: DEBUG_THEME.border }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={handleBack}
              className="h-9 w-9 items-center justify-center rounded-full border bg-white"
              style={{ borderColor: DEBUG_THEME.border }}
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={18} color="#1F2937" strokeWidth={2.6} />
            </TouchableOpacity>
            <Text className="text-base font-black text-gray-950">Update Channels</Text>
          </View>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <View className="rounded-2xl border bg-white p-5" style={{ borderColor: DEBUG_THEME.border }}>
            <Text className="text-lg font-black text-gray-950">Not Available</Text>
            <Text className="mt-2 text-sm font-semibold text-gray-500">
              This debug screen is limited to allowlisted Cahootz accounts.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: DEBUG_THEME.paper }}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="border-b bg-white px-3 pt-3 pb-2" style={{ borderColor: DEBUG_THEME.border }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={handleBack}
              className="h-9 w-9 items-center justify-center rounded-full border bg-white"
              style={{ borderColor: DEBUG_THEME.border }}
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={18} color="#1F2937" strokeWidth={2.6} />
            </TouchableOpacity>
            <View className="min-w-0 flex-1">
              <Text className="text-[10px] font-black uppercase text-gray-500">Debug</Text>
              <Text className="text-base font-black text-gray-950" numberOfLines={1}>
                Update Channels
              </Text>
            </View>
            <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: DEBUG_THEME.primary }}>
              <RadioTower size={17} color="#FFFFFF" />
            </View>
          </View>
        </View>

        <View className="px-5 py-4">
          <View className="rounded-2xl border bg-white p-5" style={{ borderColor: DEBUG_THEME.border }}>
            <Text className="text-xl font-black text-gray-950">EAS Update Channel</Text>
            <Text className="mt-2 text-sm font-semibold leading-5 text-gray-500">
              Switch this build between compatible EAS Update channels. This only works in native release builds with the same runtime version.
            </Text>

            <View className="mt-4 rounded-xl border bg-gray-50 p-4" style={{ borderColor: DEBUG_THEME.border }}>
              <InfoRow label="Signed in as" value={user?.email ?? 'Unknown'} />
              <InfoRow label="Build channel" value={Updates.channel ?? 'No build channel'} />
              <InfoRow label="Override" value={storedOverride ?? 'None'} />
              <InfoRow label="Runtime" value={Updates.runtimeVersion ?? 'Unknown'} />
              <InfoRow label="Update ID" value={shortUpdateId(Updates.updateId)} />
              <InfoRow label="Updates enabled" value={Updates.isEnabled ? 'Yes' : 'No'} last />
            </View>
          </View>

          <View className="mt-4 overflow-hidden rounded-2xl border bg-white" style={{ borderColor: DEBUG_THEME.border }}>
            <Text className="px-4 pb-2 pt-4 text-xs font-black uppercase text-gray-500">Channels</Text>
            {UPDATE_DEBUG_CHANNELS.map((channel, index) => {
              const isLast = index === UPDATE_DEBUG_CHANNELS.length - 1;
              const isBusy = busyChannel === channel;
              const isSelected = storedOverride === channel;

              return (
                <TouchableOpacity
                  key={channel}
                  onPress={() => void handleSwitchChannel(channel)}
                  disabled={Boolean(busyChannel)}
                  className="flex-row items-center gap-3 px-4 py-4"
                  style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: DEBUG_THEME.border }}
                  activeOpacity={0.75}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: DEBUG_THEME.primarySoft }}>
                    {isBusy ? (
                      <ActivityIndicator size="small" color={DEBUG_THEME.primary} />
                    ) : isSelected ? (
                      <CheckCircle2 size={20} color={DEBUG_THEME.success} />
                    ) : (
                      <RadioTower size={20} color={DEBUG_THEME.primary} />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="font-black capitalize text-gray-950">{channel}</Text>
                    <Text className="mt-0.5 text-xs font-semibold text-gray-500">
                      Request compatible updates from {channel}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: DEBUG_THEME.border }}>
            <Text className="text-xs font-black uppercase text-gray-500">Status</Text>
            <Text className="mt-2 text-sm font-semibold leading-5" style={{ color: DEBUG_THEME.dark }}>
              {statusText}
            </Text>
            <Button
              className="mt-4"
              variant="outline"
              disabled={Boolean(busyChannel)}
              onPress={() => void handleResetChannel()}
            >
              {busyChannel === 'reset' ? <ActivityIndicator size="small" color={DEBUG_THEME.primary} /> : <RotateCcw size={18} color={DEBUG_THEME.primary} />}
              <Text>Back to Build Channel</Text>
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      className="flex-row items-center justify-between gap-3 py-2"
      style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: DEBUG_THEME.border }}
    >
      <Text className="text-xs font-black uppercase text-gray-500">{label}</Text>
      <Text className="min-w-0 flex-1 text-right text-sm font-black text-gray-900" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin, Store } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { coopConfig } from '@/lib/coop-config';
import { resolveBrandColor } from '@/lib/brand-colors';

interface CoopApp {
  key: 'marketplace' | 'directory';
  name: string;
  description: string;
  memberEnabled: boolean;
}

const fallbackApps: CoopApp[] = [
  {
    key: 'marketplace',
    name: 'Marketplace',
    description: 'Shop products and stores in your coop.',
    memberEnabled: true,
  },
  {
    key: 'directory',
    name: 'Directory',
    description: 'Find local businesses connected to your coop.',
    memberEnabled: true,
  },
];

export default function AppsScreen() {
  const { user } = useAuth();
  const config = coopConfig();
  const primaryColor = resolveBrandColor(user?.coop?.primaryColor || config.primaryColor, '#B45309');
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, '#0F766E');
  const [apps, setApps] = useState<CoopApp[]>(fallbackApps);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadApps = useCallback(async () => {
    try {
      const result = await api.getMemberApps(user?.coop?.id);
      setApps(result?.length ? result : fallbackApps);
    } catch (error) {
      console.error('Failed to load coop apps:', error);
      setApps(fallbackApps);
    } finally {
      setLoading(false);
    }
  }, [user?.coop?.id]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  useFocusEffect(
    useCallback(() => {
      loadApps();
    }, [loadApps])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadApps();
    setRefreshing(false);
  };

  const openApp = (app: CoopApp) => {
    if (app.key === 'directory') {
      router.push('/(authenticated)/directory' as any);
      return;
    }

    router.push('/(authenticated)/stores' as any);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={primaryColor} />
          <Text className="mt-4 text-gray-500">Loading apps...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primaryColor} />}
      >
        <View className="p-5 pb-28">
          <View className="mb-8">
            <Text className="text-sm text-gray-500">Welcome to</Text>
            <Text className="text-3xl font-bold text-gray-900">
              {user?.coop?.name || config.name}
            </Text>
          </View>

          <View className="flex-row flex-wrap">
            {apps.map((app) => {
              const isDirectory = app.key === 'directory';
              const Icon = isDirectory ? MapPin : Store;
              const color = isDirectory ? accentColor : primaryColor;
              const gradientColors: [string, string] = isDirectory
                ? [accentColor, primaryColor]
                : [primaryColor, accentColor];

              return (
                <TouchableOpacity
                  key={app.key}
                  onPress={() => openApp(app)}
                  activeOpacity={0.8}
                  className="mb-7 w-1/3 items-center px-2"
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${app.name}`}
                >
                  <View
                    className="h-20 w-20 items-center justify-center rounded-[24px] shadow-sm"
                    style={{
                      backgroundColor: color,
                      shadowColor: color,
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.22,
                      shadowRadius: 16,
                      elevation: 5,
                    }}
                  >
                    <LinearGradient
                      colors={gradientColors}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      className="h-20 w-20 items-center justify-center rounded-[24px]"
                    >
                      <Icon size={32} color="#FFFFFF" strokeWidth={2.3} />
                    </LinearGradient>
                  </View>
                  <View className="mt-2 min-h-[34px] items-center justify-start">
                    <Text
                      className="text-center text-xs font-semibold leading-4 text-gray-900"
                      numberOfLines={2}
                    >
                      {app.name}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

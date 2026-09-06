import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';

import AccountProfileScreen from '@/components/account-profile-screen';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';

export default function WalletScreen() {
  const { isLoading, isAuthenticated, sessionToken } = useAuth();

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;

    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  if (isLoading || !isAuthenticated || !sessionToken) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <ActivityIndicator size="small" color="#FF6B00" />
        <Text className="mt-3 text-center text-sm font-semibold text-gray-500">
          Opening sign in...
        </Text>
      </View>
    );
  }

  return <AccountProfileScreen />;
}

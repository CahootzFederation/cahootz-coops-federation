import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import CheckoutHybrid from '@/components/checkout-hybrid';

export default function CheckoutScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();

  if (!storeId) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-500 dark:text-gray-400">We couldn't open checkout. Go back and try again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return <CheckoutHybrid storeId={storeId} />;
}

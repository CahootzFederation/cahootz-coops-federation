import { View, Text, TouchableOpacity } from 'react-native';
import { X } from 'lucide-react-native';

interface CardInputProps {
  onSuccess: (card: { brand: string; last4: string }) => void;
  onCancel: () => void;
}

export default function CardInput({ onCancel }: CardInputProps) {
  return (
    <View className="flex-1 bg-white">
      <View className="pt-14 pb-4 px-4 border-b border-gray-100">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={onCancel} className="p-2 -ml-2">
            <X size={24} color="#111827" />
          </TouchableOpacity>
          <Text className="flex-1 text-center text-lg font-semibold text-gray-900 -ml-8">
            Payment Methods
          </Text>
        </View>
      </View>

      <View className="flex-1 justify-center px-6">
        <Text className="text-xl font-bold text-gray-900 text-center">
          Cards are added at checkout
        </Text>
        <Text className="text-gray-600 text-center mt-3">
          Cahootz now uses Stripe-hosted Checkout for card payments in the mobile app.
        </Text>
        <TouchableOpacity
          onPress={onCancel}
          className="mt-8 py-4 rounded-xl items-center bg-amber-600"
        >
          <Text className="text-white font-bold text-lg">Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

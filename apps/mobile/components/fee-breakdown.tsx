import { View, Text } from 'react-native';
import { Info } from 'lucide-react-native';

interface FeeBreakdownProps {
  subtotal: number;
  processorFee: number;
  processor?: string;
  showDetails?: boolean;
  className?: string;
}

/**
 * Fee Breakdown Component
 * 
 * Displays a clear breakdown of transaction costs including processor fees
 * Used in checkout and payment screens
 */
export function FeeBreakdown({ 
  subtotal, 
  processorFee, 
  processor = 'Stripe',
  showDetails = true,
  className = ''
}: FeeBreakdownProps) {
  const total = subtotal + processorFee;
  const normalizedProcessor = processor.toLowerCase();
  const processorRateLabel =
    normalizedProcessor === 'paypal'
      ? '3.49% + $0.49'
      : '2.9% + $0.30';

  return (
    <View className={`bg-blue-50 rounded-xl p-4 border border-blue-200 ${className}`}>
      {/* Info Header */}
      <View className="flex-row items-center mb-3">
        <Info size={16} color="#3B82F6" />
        <Text className="text-blue-800 font-semibold ml-2">Payment breakdown</Text>
      </View>

      {/* Fee Details */}
      <View className="space-y-2">
        {/* Subtotal */}
        <View className="flex-row justify-between">
          <Text className="text-gray-700">Amount</Text>
          <Text className="text-gray-900 font-medium">${subtotal.toFixed(2)}</Text>
        </View>

        {/* Processor Fee */}
        <View className="flex-row justify-between">
          <View className="flex-1">
            <Text className="text-gray-700">{processor} Processing Fee</Text>
            {showDetails && processorFee > 0 && (
              <Text className="text-gray-500 text-xs mt-0.5">
                (Rate: {processorRateLabel})
              </Text>
            )}
          </View>
          <Text className="text-gray-900 font-medium">${processorFee.toFixed(2)}</Text>
        </View>

        {/* Divider */}
        <View className="border-t border-blue-300 my-2" />

        {/* Total */}
        <View className="flex-row justify-between">
          <Text className="text-gray-900 font-bold text-lg">Total</Text>
          <Text className="text-gray-900 font-bold text-lg">${total.toFixed(2)}</Text>
        </View>
      </View>

      {/* Info Footer */}
      {showDetails && (
        <View className="mt-3 pt-3 border-t border-blue-200">
          <Text className="text-blue-700 text-xs">
            Processing fees help cover payment network costs. Your recipient receives the full amount.
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * Compact Fee Display
 * 
 * Shows just the processor fee as a single line
 * Useful for inline display in confirmation screens
 */
export function CompactFeeDisplay({ 
  processorFee, 
  processor = 'Stripe' 
}: { 
  processorFee: number; 
  processor?: string;
}) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <View className="flex-row items-center">
        <Info size={14} color="#6B7280" />
        <Text className="text-gray-600 text-sm ml-1">{processor} Fee</Text>
      </View>
      <Text className="text-gray-900 font-medium">${processorFee.toFixed(2)}</Text>
    </View>
  );
}

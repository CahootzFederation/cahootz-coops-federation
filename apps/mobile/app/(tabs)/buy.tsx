import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { api } from '~/lib/api';

const PRESET_AMOUNTS = [25, 50, 100, 250];

export default function BuyScreen() {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [processors, setProcessors] = useState<any>(null);
  const [selectedProcessor, setSelectedProcessor] = useState<'stripe' | 'paypal' | 'square'>('stripe');

  useEffect(() => {
    loadProcessors();
  }, []);

  const loadProcessors = async () => {
    try {
      const data = await api.getAvailableProcessors();
      setProcessors(data);

      // Select first available processor
      if (data.processors && data.processors.length > 0) {
        setSelectedProcessor(data.processors[0]);
      }
    } catch (err) {
      console.error('Error loading processors:', err);
    }
  };

  const handleBuyUC = async () => {
    const amountUSD = parseFloat(amount);

    if (!amountUSD || amountUSD < 10) {
      Alert.alert('Error', 'Minimum purchase is $10');
      return;
    }

    if (amountUSD > 10000) {
      Alert.alert('Error', 'Maximum purchase is $10,000');
      return;
    }

    setLoading(true);

    try {
      // Create payment intent
      const paymentIntent = await api.createPaymentIntent(amountUSD, selectedProcessor);

      Alert.alert(
        'Payment SDK Required',
        `To complete this purchase, you need to integrate the ${selectedProcessor.toUpperCase()} payment SDK.\n\n` +
        `Payment Intent ID: ${paymentIntent.paymentIntentId}\n` +
        `Amount: $${amountUSD} USD → ${paymentIntent.amountUC} UC\n\n` +
        'This would normally launch the payment UI from Stripe/PayPal/Square SDK.',
        [
          { text: 'OK' },
          {
            text: 'View Docs',
            onPress: () => {
              // TODO: Open documentation
              console.log('Open payment SDK docs');
            },
          },
        ]
      );

      // TODO: Implement actual payment flow
      // For Stripe:
      // - Create a hosted Checkout Session on the API
      // - Open the returned Stripe Checkout URL
      //
      // For PayPal:
      // - Use react-native-paypal
      // - Launch PayPal checkout flow
      //
      // For Square:
      // - Use react-native-square-in-app-payments
      // - Launch Square payment flow
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to create payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="p-4">
        <Text className="text-2xl font-bold text-gray-900 mb-2">Buy Unity Coins</Text>
        <Text className="text-gray-600 mb-6">
          Purchase UC tokens with your credit card or bank account
        </Text>

        {/* Payment Processor Selection */}
        {processors && processors.processors && processors.processors.length > 0 && (
          <View className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <Text className="text-gray-700 font-semibold mb-3">Payment Method</Text>

            <View className="space-y-2">
              {processors.processors.map((processor: string) => (
                <TouchableOpacity
                  key={processor}
                  onPress={() => setSelectedProcessor(processor as any)}
                  className={`flex-row items-center p-3 rounded-lg border-2 ${
                    selectedProcessor === processor ? 'border-amber-600 bg-amber-50' : 'border-gray-200'
                  }`}
                >
                  <View className="flex-1">
                    <Text className={`font-semibold capitalize ${
                      selectedProcessor === processor ? 'text-amber-700' : 'text-gray-900'
                    }`}>
                      {processor}
                    </Text>
                    {processor === processors.primary && (
                      <Text className="text-xs text-gray-500 mt-1">Recommended</Text>
                    )}
                  </View>
                  {selectedProcessor === processor && (
                    <Text className="text-amber-700 text-xl">✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Amount Input */}
        <View className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <Text className="text-gray-700 font-semibold mb-3">Amount (USD)</Text>

          {/* Preset Amount Buttons */}
          <View className="flex-row flex-wrap gap-2 mb-4">
            {PRESET_AMOUNTS.map((preset) => (
              <TouchableOpacity
                key={preset}
                onPress={() => setAmount(preset.toString())}
                className={`px-4 py-2 rounded-lg border ${
                  amount === preset.toString()
                    ? 'border-amber-600 bg-amber-50'
                    : 'border-gray-300 bg-white'
                }`}
              >
                <Text className={`font-medium ${
                  amount === preset.toString() ? 'text-amber-700' : 'text-gray-700'
                }`}>
                  ${preset}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Amount Input */}
          <View className="flex-row items-center border border-gray-300 rounded-lg px-4 py-3">
            <Text className="text-gray-500 font-medium mr-2">$</Text>
            <TextInput
              className="flex-1 text-gray-900 text-lg"
              placeholder="Enter amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
            <Text className="text-gray-500 ml-2">USD</Text>
          </View>

          {/* UC Preview */}
          {amount && parseFloat(amount) >= 10 && (
            <View className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <Text className="text-amber-800 text-sm">You will receive</Text>
              <Text className="text-amber-900 text-2xl font-bold mt-1">
                {parseFloat(amount).toFixed(2)} UC
              </Text>
              <Text className="text-amber-700 text-xs mt-1">1 UC = 1 USD</Text>
            </View>
          )}

          {/* Minimum/Maximum Notice */}
          <View className="mt-3 bg-gray-50 rounded-lg p-3">
            <Text className="text-gray-600 text-xs">
              • Minimum: $10 USD{'\n'}
              • Maximum: $10,000 USD{'\n'}
              • Processing time: Instant
            </Text>
          </View>
        </View>

        {/* Payment Notice */}
        <View className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4">
          <Text className="text-yellow-800 font-semibold mb-2">Payment flow required</Text>
          <Text className="text-yellow-700 text-sm">
            To enable actual payments, create hosted checkout flows through the API and open the processor checkout URL.
          </Text>
        </View>

        {/* Buy Button */}
        <TouchableOpacity
          onPress={handleBuyUC}
          disabled={loading || !amount || parseFloat(amount) < 10}
          className={`py-4 rounded-xl items-center ${
            loading || !amount || parseFloat(amount) < 10 ? 'bg-gray-300' : 'bg-green-600'
          }`}
        >
          {loading ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">
              Buy {amount ? `$${parseFloat(amount).toFixed(2)}` : ''} UC
            </Text>
          )}
        </TouchableOpacity>

        {/* Security Info */}
        <View className="mt-6 bg-white rounded-xl shadow-sm p-4">
          <Text className="text-gray-700 font-semibold mb-2">Secure Payment</Text>
          <Text className="text-gray-600 text-sm">
            All payments are processed securely through {selectedProcessor}. Your payment information is never stored on our servers.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

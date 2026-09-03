import { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink, ShieldCheck } from 'lucide-react-native';

interface CommercePaymentConfirmationProps {
  clientSecret?: string | null;
  checkoutUrl?: string | null;
  merchantName?: string;
  amountLabel: string;
  accentColor: string;
  cardholderName?: string;
  onSuccess: () => void;
  onError: (message: string) => void;
}

export default function CommercePaymentConfirmation({
  checkoutUrl,
  merchantName,
  amountLabel,
  accentColor,
  onSuccess,
  onError,
}: CommercePaymentConfirmationProps) {
  const [opening, setOpening] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleOpenCheckout = async () => {
    if (!checkoutUrl || opening) return;

    setOpening(true);
    setLocalError('');

    try {
      const returnUrl = Linking.createURL('/checkout');
      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, returnUrl);

      if (result.type === 'success') {
        if (result.url.includes('/checkout/success')) {
          onSuccess();
          return;
        }

        if (result.url.includes('/checkout/cancel')) {
          setLocalError('Payment was canceled.');
          return;
        }
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setLocalError('Checkout was closed before payment completed.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open Stripe Checkout.';
      setLocalError(message);
      onError(message);
    } finally {
      setOpening(false);
    }
  };

  return (
    <View className="mx-6 mt-4 mb-3 rounded-2xl border border-gray-100 bg-white p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${accentColor}1A` }}>
          <ShieldCheck size={20} color={accentColor} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 font-semibold">Secure Stripe Checkout</Text>
          <Text className="text-gray-500 text-sm mt-1">
            Complete payment for {merchantName || 'this order'} on Stripe-hosted checkout.
          </Text>
        </View>
      </View>

      {localError ? (
        <View className="mt-4 rounded-xl bg-secondary p-3">
          <Text className="text-amber-800 text-sm">{localError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        className="mt-4 flex-row items-center justify-center rounded-xl py-4"
        style={{ backgroundColor: !checkoutUrl || opening ? '#9CA3AF' : accentColor }}
        disabled={!checkoutUrl || opening}
        onPress={handleOpenCheckout}
      >
        {opening ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <ExternalLink size={20} color="#fff" />
        )}
        <Text className="ml-2 text-white text-base font-bold">
          {opening ? 'Opening checkout...' : `Pay ${amountLabel}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

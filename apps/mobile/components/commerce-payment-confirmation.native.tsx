import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { CreditCard, ShieldCheck } from 'lucide-react-native';
import { CollectionMode, useStripe } from '@stripe/stripe-react-native';

interface CommercePaymentConfirmationProps {
  clientSecret: string;
  merchantName?: string;
  amountLabel: string;
  accentColor: string;
  cardholderName?: string;
  onSuccess: () => void;
  onError: (message: string) => void;
}

export default function CommercePaymentConfirmation({
  clientSecret,
  merchantName,
  amountLabel,
  accentColor,
  cardholderName,
  onSuccess,
  onError,
}: CommercePaymentConfirmationProps) {
  const { initPaymentSheet, presentPaymentSheet, retrievePaymentIntent } = useStripe();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function preparePaymentSheet() {
      setLoading(true);
      setReady(false);
      setLocalError('');

      const { paymentIntent, error: retrieveError } = await retrievePaymentIntent(clientSecret);

      if (cancelled) return;

      if (paymentIntent?.status === 'Succeeded') {
        setLoading(false);
        onSuccess();
        return;
      }

      if (paymentIntent?.status === 'Processing') {
        setLocalError('Your payment is still processing. Wait a moment and check your order status before trying again.');
        setLoading(false);
        return;
      }

      if (retrieveError) {
        const message = retrieveError.message || 'Could not check payment status.';
        setLocalError(message);
        onError(message);
        setLoading(false);
        return;
      }

      const { error } = await initPaymentSheet({
        merchantDisplayName: merchantName || 'Cahootz Co-op',
        paymentIntentClientSecret: clientSecret,
        allowsDelayedPaymentMethods: false,
        returnURL: 'coop://stripe-redirect',
        defaultBillingDetails: cardholderName ? { name: cardholderName } : undefined,
        billingDetailsCollectionConfiguration: {
          name: CollectionMode.ALWAYS,
        },
      });

      if (cancelled) return;

      if (error) {
        const message = error.message || 'Could not prepare card payment.';
        setLocalError(message);
        onError(message);
      } else {
        setReady(true);
      }

      setLoading(false);
    }

    preparePaymentSheet();

    return () => {
      cancelled = true;
    };
  }, [cardholderName, clientSecret, initPaymentSheet, merchantName, onError, onSuccess, retrievePaymentIntent]);

  const handlePay = async () => {
    if (!ready || paying) return;

    setPaying(true);
    setLocalError('');

    const { paymentIntent, error: retrieveError } = await retrievePaymentIntent(clientSecret);

    if (paymentIntent?.status === 'Succeeded') {
      setPaying(false);
      onSuccess();
      return;
    }

    if (paymentIntent?.status === 'Processing') {
      const message = 'Your payment is still processing. Wait a moment and check your order status before trying again.';
      setLocalError(message);
      onError(message);
      setPaying(false);
      return;
    }

    if (retrieveError) {
      const message = retrieveError.message || 'Could not check payment status. Please try again.';
      setLocalError(message);
      onError(message);
      setPaying(false);
      return;
    }

    const { error } = await presentPaymentSheet();

    if (error) {
      const message = error.code === 'Canceled'
        ? 'Payment was canceled.'
        : error.message || 'Payment failed. Please try again.';
      setLocalError(message);
      if (error.code !== 'Canceled') onError(message);
      setPaying(false);
      return;
    }

    setPaying(false);
    onSuccess();
  };

  return (
    <View className="mx-6 mt-4 mb-3 rounded-2xl border border-gray-100 bg-white p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${accentColor}1A` }}>
          <CreditCard size={20} color={accentColor} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 font-semibold">Secure card payment</Text>
          <Text className="text-gray-500 text-sm mt-1">
            Enter a card with Stripe PaymentSheet to complete this order.
          </Text>
        </View>
      </View>

      {localError ? (
        <View className="mt-4 rounded-xl bg-red-50 p-3">
          <Text className="text-red-700 text-sm">{localError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        className="mt-4 flex-row items-center justify-center rounded-xl py-4"
        style={{ backgroundColor: !ready || loading || paying ? '#9CA3AF' : accentColor }}
        disabled={!ready || loading || paying}
        onPress={handlePay}
      >
        {loading || paying ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <ShieldCheck size={20} color="#fff" />
        )}
        <Text className="ml-2 text-white text-base font-bold">
          {loading ? 'Preparing payment...' : paying ? 'Confirming...' : `Pay ${amountLabel}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

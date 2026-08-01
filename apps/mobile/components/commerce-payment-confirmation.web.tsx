import { FormEvent, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { CreditCard, ShieldCheck } from 'lucide-react-native';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = publishableKey ? loadStripe(publishableKey) : Promise.resolve(null);

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

function CommercePaymentForm({
  clientSecret,
  amountLabel,
  accentColor,
  onSuccess,
  onError,
}: Omit<CommercePaymentConfirmationProps, 'merchantName' | 'checkoutUrl'> & { clientSecret: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();

    if (!stripe || !elements || processing) return;

    setProcessing(true);
    setLocalError('');

    const { paymentIntent, error: retrieveError } = await stripe.retrievePaymentIntent(clientSecret);

    if (paymentIntent?.status === 'succeeded') {
      setProcessing(false);
      onSuccess();
      return;
    }

    if (paymentIntent?.status === 'processing') {
      const message = 'Your payment is still processing. Wait a moment and check your order status before trying again.';
      setLocalError(message);
      onError(message);
      setProcessing(false);
      return;
    }

    if (retrieveError) {
      const message = retrieveError.message || 'Could not check payment status. Please try again.';
      setLocalError(message);
      onError(message);
      setProcessing(false);
      return;
    }

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
      redirect: 'if_required',
    });

    if (error) {
      if (error.payment_intent?.status === 'succeeded') {
        setProcessing(false);
        onSuccess();
        return;
      }

      const message = error.message || 'Payment failed. Please try again.';
      setLocalError(message);
      onError(message);
      setProcessing(false);
      return;
    }

    setProcessing(false);
    onSuccess();
  };

  return (
    <View>
      <form onSubmit={handleSubmit}>
        <View className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <PaymentElement />
        </View>

        {localError ? (
          <View className="mt-4 rounded-xl bg-red-50 p-3">
            <Text className="text-red-700 text-sm">{localError}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          className="mt-4 flex-row items-center justify-center rounded-xl py-4"
          style={{ backgroundColor: !stripe || processing ? '#9CA3AF' : accentColor }}
          disabled={!stripe || processing}
          onPress={() => handleSubmit()}
        >
          {processing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <ShieldCheck size={20} color="#fff" />
          )}
          <Text className="ml-2 text-white text-base font-bold">
            {processing ? 'Confirming...' : `Pay ${amountLabel}`}
          </Text>
        </TouchableOpacity>
      </form>
    </View>
  );
}

export default function CommercePaymentConfirmation({
  clientSecret,
  merchantName,
  amountLabel,
  accentColor,
  onSuccess,
  onError,
}: CommercePaymentConfirmationProps) {
  const options = useMemo(() => ({
    clientSecret: clientSecret || '',
    appearance: {
      theme: 'stripe' as const,
      variables: {
        colorPrimary: accentColor,
        borderRadius: '12px',
      },
    },
  }), [accentColor, clientSecret]);

  if (!clientSecret) {
    return (
      <View className="mx-6 mt-4 mb-3 rounded-2xl border border-red-100 bg-red-50 p-4">
        <Text className="text-red-700 font-semibold">Payment could not be prepared.</Text>
        <Text className="text-red-700 text-sm mt-1">
          Stripe did not return a client secret for web checkout.
        </Text>
      </View>
    );
  }

  return (
    <View className="mx-6 mt-4 mb-3 rounded-2xl border border-gray-100 bg-white p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${accentColor}1A` }}>
          <CreditCard size={20} color={accentColor} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 font-semibold">Secure card payment</Text>
          <Text className="text-gray-500 text-sm mt-1">
            Enter a card with Stripe to complete your {merchantName ? `${merchantName} ` : ''}order.
          </Text>
        </View>
      </View>

      {publishableKey ? (
        <Elements stripe={stripePromise} options={options}>
          <CommercePaymentForm
            clientSecret={clientSecret}
            amountLabel={amountLabel}
            accentColor={accentColor}
            onSuccess={onSuccess}
            onError={onError}
          />
        </Elements>
      ) : (
        <View className="mt-4 rounded-xl bg-red-50 p-3">
          <Text className="text-red-700 text-sm">
            Stripe publishable key is missing. Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to enable card checkout.
          </Text>
        </View>
      )}
    </View>
  );
}

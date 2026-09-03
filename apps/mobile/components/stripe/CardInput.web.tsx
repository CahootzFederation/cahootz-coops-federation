import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { X } from 'lucide-react-native';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

const stripePromise = loadStripe(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface CardInputProps {
  onSuccess: (card: { brand: string; last4: string }) => void;
  onCancel: () => void;
}

function CardForm({ onSuccess, onCancel }: CardInputProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements || !user?.id) return;

    setAdding(true);
    setError(null);

    try {
      const { clientSecret } = await api.createSetupIntent(user.id, user.walletAddress);

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      const { setupIntent, error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      if (!setupIntent?.payment_method) {
        throw new Error('Failed to create payment method');
      }

      const savedCard = await api.savePaymentMethod(
        user.id,
        typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method.id,
        user.walletAddress
      );

      onSuccess({ brand: savedCard.brand, last4: savedCard.last4 });
    } catch (err) {
      console.error('Error adding card:', err);
      setError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setAdding(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'white' }}>
      <View style={{ paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={onCancel} style={{ padding: 8, marginLeft: -8 }}>
            <X size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600', color: '#111827', marginLeft: -32 }}>
            Add Card
          </Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1, padding: 16 }}>
        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: '#374151', fontWeight: '500', marginBottom: 12 }}>Card Information</Text>
          <View style={{ borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, backgroundColor: '#FFFFFF' }}>
            <CardElement
              options={{
                style: {
                  base: {
                    fontSize: '16px',
                    color: '#111827',
                    '::placeholder': { color: '#9CA3AF' },
                  },
                  invalid: { color: '#EF4444' },
                },
              }}
            />
          </View>
        </View>

        {error && (
          <View style={{ backgroundColor: '#FEF2F2', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: '#B91C1C', fontSize: 14 }}>{error}</Text>
          </View>
        )}

        <View style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <Text style={{ color: '#4B5563', fontSize: 14 }}>
            Your card information is securely processed by Stripe. We never store your full card number.
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={adding || !stripe}
          style={{
            backgroundColor: adding || !stripe ? '#D1D5DB' : '#FF8A2A',
            paddingVertical: 16,
            borderRadius: 12,
            alignItems: 'center',
          }}
        >
          {adding ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>Add Card</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

export default function CardInput({ onSuccess, onCancel }: CardInputProps) {
  return (
    <Elements stripe={stripePromise}>
      <CardForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}

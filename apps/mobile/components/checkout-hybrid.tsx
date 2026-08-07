import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { Alert } from '@/lib/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  ArrowLeft,
  ShoppingBag,
  CreditCard,
  Check,
  BadgeCheck,
  Info,
} from 'lucide-react-native';
import { api, API_BASE_URL, createApiHeaders, resolveCoopId } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { useCart } from '@/contexts/cart-context';
import { coopConfig } from '@/lib/coop-config';
import { getWebUrl } from '@/lib/config';
import { resolveBrandColor, withAlpha } from '@/lib/brand-colors';
import CommercePaymentConfirmation from '@/components/commerce-payment-confirmation';

interface CheckoutHybridProps {
  storeId: string;
}

interface PaymentSession {
  transactionId: string;
  clientSecret?: string | null;
  checkoutUrl?: string | null;
  totalCents: number;
}

interface ShippingAddressFields {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface CheckoutUserInfo {
  id: string;
  email: string | null;
  name: string | null;
  status: string;
  walletAddress: string | null;
  membershipStatus: string | null;
  membershipRoles: string[];
  applicationStatus: string | null;
}

const emptyShippingAddress: ShippingAddressFields = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'US',
};

function normalizeShippingAddress(address: ShippingAddressFields): ShippingAddressFields {
  return {
    line1: address.line1.trim(),
    line2: address.line2.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    postalCode: address.postalCode.trim(),
    country: address.country.trim() || 'US',
  };
}

function formatShippingAddress(address: ShippingAddressFields): string {
  const street = [address.line1, address.line2].filter(Boolean).join(', ');
  const region = [address.state, address.postalCode].filter(Boolean).join(' ');
  const locality = [address.city, region].filter(Boolean).join(', ');
  return [street, locality, address.country].filter(Boolean).join('\n');
}

function formatScAmount(amount?: number | null): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(amount ?? 0);
}

function formatCurrencyFromCents(amountCents?: number | null): string {
  return `$${((amountCents ?? 0) / 100).toFixed(2)}`;
}

function formatStatus(status?: string | null): string {
  if (!status) return 'No commons membership';
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortenAddress(address?: string | null): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function buildStripeReturnUrl(path: string): string {
  const baseUrl = getWebUrl().replace(/\/+$/, '');
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export default function CheckoutHybrid({ storeId }: CheckoutHybridProps) {
  const { user } = useAuth();
  const coin = useCoin();
  const config = coopConfig();
  const coopId = resolveCoopId();
  const primaryColor = resolveBrandColor(user?.coop?.primaryColor || config.primaryColor, '#B45309');
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, '#16A34A');
  const { getStoreItems, clearStoreItems } = useCart();

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [store, setStore] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [businessReadiness, setBusinessReadiness] = useState<any>(null);
  const [checkoutUser, setCheckoutUser] = useState<CheckoutUserInfo | null>(null);
  const [cardholderName, setCardholderName] = useState('');
  const [shippingAddress, setShippingAddress] = useState<ShippingAddressFields>(emptyShippingAddress);
  const [note, setNote] = useState('');
  const [paymentSession, setPaymentSession] = useState<PaymentSession | null>(null);

  const cartItems = storeId ? getStoreItems(storeId) : [];
  const subtotal = cartItems.reduce((sum, item) => sum + item.priceUSD * item.quantity, 0);
  const totalCents = preview?.totalChargedCents ?? Math.round(subtotal * 100);
  const checkoutBusinessId = store?.businessId || storeId;
  const appliesTreasuryFee = preview?.appliesTreasuryFee === true;
  const displayedTreasuryFeeCents = appliesTreasuryFee ? preview?.treasuryFeeCents ?? 0 : 0;
  const displayTotalCents = Math.round(subtotal * 100) + displayedTreasuryFeeCents;
  const coopStatus = preview?.membershipStatus ?? checkoutUser?.membershipStatus ?? checkoutUser?.applicationStatus ?? null;
  const isActiveCoopMember = coopStatus === 'ACTIVE';
  const displayName = checkoutUser?.name || user?.name || checkoutUser?.email || user?.email || shortenAddress(user?.walletAddress);
  const coopName = user?.coop?.name || config.name;
  const roleLabel = checkoutUser?.membershipRoles?.length
    ? checkoutUser.membershipRoles.map(formatStatus).join(', ')
    : null;
  const expectedScLabel = preview
    ? `${formatScAmount(preview.customerReward?.estimatedAmount)} ${coin.symbol}`
    : 'Calculating...';

  const updateShippingAddress = (field: keyof ShippingAddressFields, value: string) => {
    setShippingAddress((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const loadData = useCallback(async () => {
    if (!user?.id || !storeId) return;

    try {
      const storeResult = await api.getStore(storeId);
      const businessId = storeResult?.businessId || storeId;
      const readinessResult = await fetch(`${API_BASE_URL}/trpc/stripeConnect.getBusinessReadiness?input=${encodeURIComponent(JSON.stringify({ businessId }))}`)
        .then(res => res.json())
        .catch(() => null);

      setStore(storeResult);
      setBusinessReadiness(readinessResult?.result?.data);

      if (user.walletAddress) {
        const checkoutUserResult = await fetch(
          `${API_BASE_URL}/trpc/user.getUserByWallet?input=${encodeURIComponent(JSON.stringify({
            walletAddress: user.walletAddress,
            coopId,
          }))}`,
          {
            headers: createApiHeaders(user.walletAddress),
          }
        )
          .then(res => res.json())
          .catch(() => null);

        setCheckoutUser(checkoutUserResult?.result?.data ?? null);
      }

      // Get checkout preview
      if (subtotal > 0) {
        const previewResult = await fetch(
          `${API_BASE_URL}/trpc/commerce.previewCheckout?input=${encodeURIComponent(JSON.stringify({
            userId: user.id,
            coopId,
            businessId,
            listedAmountCents: Math.round(subtotal * 100),
            currency: 'USD',
          }))}`,
          {
            headers: createApiHeaders(user.walletAddress),
          }
        ).then(res => res.json());

        setPreview(previewResult?.result?.data);
      }
    } catch (error) {
      console.error('Failed to load checkout data:', error);
      Alert.alert('Error', 'Failed to load checkout information.');
    } finally {
      setLoading(false);
    }
  }, [user, storeId, subtotal, coopId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setPaymentSession(null);
  }, [storeId, subtotal]);

  const handlePaymentSuccess = () => {
    if (!paymentSession) return;

    clearStoreItems(storeId);

    let successMsg = `Your card payment for $${(paymentSession.totalCents / 100).toFixed(2)} was confirmed.`;

    if (preview?.customerReward?.eligible) {
      successMsg += `\n\nYou'll earn ${formatScAmount(preview.customerReward.estimatedAmount)} ${coin.symbol} when payment completes!`;
    } else if (businessReadiness?.scRewardEligible === false) {
      successMsg += `\n\nThis merchant is not yet eligible for ${coin.name} rewards, so no rewards for this purchase.`;
    }

    Alert.alert('Payment Confirmed', successMsg, [
      {
        text: 'My Orders',
        onPress: () => router.replace('/(authenticated)/orders' as any),
      },
      {
        text: 'View Order',
        onPress: () => router.replace(`/(authenticated)/order-detail?id=${paymentSession.transactionId}` as any),
      },
    ]);
  };

  const handleCheckout = async () => {
    if (!user?.id || !checkoutBusinessId || cartItems.length === 0) return;

    if (!user.walletAddress) {
      Alert.alert('Wallet Required', 'Your account needs a wallet before checkout can continue.');
      return;
    }

    const normalizedShippingAddress = normalizeShippingAddress(shippingAddress);
    if (
      !normalizedShippingAddress.line1 ||
      !normalizedShippingAddress.city ||
      !normalizedShippingAddress.state ||
      !normalizedShippingAddress.postalCode
    ) {
      Alert.alert('Shipping Address Required', 'Enter the street address, city, state, and ZIP code so the store owner knows where to send the order.');
      return;
    }
    const formattedShippingAddress = formatShippingAddress(normalizedShippingAddress);

    setProcessing(true);

    try {
      // Create commerce transaction
      const useHostedCheckout = Platform.OS !== 'web';
      const successUrl = useHostedCheckout ? buildStripeReturnUrl('/checkout/success') : undefined;
      const cancelUrl = useHostedCheckout ? buildStripeReturnUrl('/checkout/cancel') : undefined;
      const checkoutResult = await fetch(`${API_BASE_URL}/trpc/commerce.createMemberCheckout`, {
        method: 'POST',
        headers: {
          ...createApiHeaders(user.walletAddress),
          'X-Coop-Id': coopId,
        },
        body: JSON.stringify({
          coopId,
          businessId: checkoutBusinessId,
          listedAmountCents: Math.round(subtotal * 100),
          currency: 'USD',
          paymentUi: useHostedCheckout ? 'hosted_checkout' : 'payment_intent',
          successUrl,
          cancelUrl,
          metadata: {
            items: cartItems.map(item => ({
              productId: item.productId,
              name: item.name,
              quantity: item.quantity,
              priceUSD: item.priceUSD,
            })),
            shippingAddress: formattedShippingAddress,
            note: note || undefined,
          },
        }),
      }).then(res => res.json());

      if (checkoutResult.error) {
        throw new Error(checkoutResult.error.message);
      }

      const { transactionId, clientSecret, checkoutUrl, totalChargedCents } = checkoutResult.result.data;

      if (!clientSecret && !checkoutUrl) {
        throw new Error('Checkout did not return a payment method.');
      }

      setPaymentSession({
        transactionId,
        clientSecret,
        checkoutUrl,
        totalCents: totalChargedCents ?? totalCents,
      });
    } catch (error: any) {
      console.error('Checkout failed:', error);
      Alert.alert('Checkout Failed', error.message || 'An error occurred during checkout.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      </SafeAreaView>
    );
  }

  if (!store || cartItems.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center px-6">
          <ShoppingBag size={64} color="#9CA3AF" />
          <Text className="text-gray-500 text-center mt-4">
            Your cart is empty
          </Text>
          <TouchableOpacity
            className="mt-6 px-6 py-3 rounded-xl"
            style={{ backgroundColor: accentColor }}
            onPress={() => router.back()}
          >
            <Text className="text-white font-semibold">Continue Shopping</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
          <TouchableOpacity onPress={() => router.back()}>
            <ArrowLeft size={24} color="#374151" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-900">Checkout</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Store Info */}
        <View className="mx-6 mt-4 rounded-2xl overflow-hidden">
          <LinearGradient
            colors={['#111827', accentColor, primaryColor]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 18 }}
          >
            <Text className="text-lg font-bold text-white">{store.name}</Text>
          </LinearGradient>
        </View>

        {/* Commons Member Info */}
        <View className="mx-6 mt-4 rounded-2xl border border-gray-200 bg-white p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 text-base font-bold">
                {isActiveCoopMember ? 'Commons member checkout' : 'Guest checkout'}
              </Text>
              <Text className="text-gray-500 text-sm mt-1">
                {isActiveCoopMember
                  ? 'This purchase will use your commons membership for checkout.'
                  : 'Guest checkout has no commons membership status.'}
              </Text>
            </View>
            <View
              className="rounded-full border px-3 py-1"
              style={{
                backgroundColor: isActiveCoopMember ? withAlpha(accentColor, '12') : '#F9FAFB',
                borderColor: isActiveCoopMember ? withAlpha(accentColor, '35') : '#E5E7EB',
              }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: isActiveCoopMember ? accentColor : '#4B5563' }}
              >
                {formatStatus(coopStatus)}
              </Text>
            </View>
          </View>

          <View className="mt-4 gap-3">
            <View className="flex-row justify-between gap-4">
              <Text className="text-gray-500">Account</Text>
              <Text className="text-gray-900 font-semibold text-right flex-1" numberOfLines={1}>
                {displayName || 'Signed-in user'}
              </Text>
            </View>
            <View className="flex-row justify-between gap-4">
              <Text className="text-gray-500">Commons</Text>
              <Text className="text-gray-900 font-semibold text-right flex-1" numberOfLines={1}>
                {coopName}
              </Text>
            </View>
            {roleLabel ? (
              <View className="flex-row justify-between gap-4">
                <Text className="text-gray-500">Roles</Text>
                <Text className="text-gray-900 font-semibold text-right flex-1" numberOfLines={1}>
                  {roleLabel}
                </Text>
              </View>
            ) : null}
            <View className="flex-row justify-between gap-4">
              <Text className="text-gray-500">Expected treasury fee</Text>
              <Text className="text-gray-900 font-semibold">
                {formatCurrencyFromCents(displayedTreasuryFeeCents)}
              </Text>
            </View>
            <View className="flex-row justify-between gap-4">
              <Text className="text-gray-500">Expected {coin.symbol} reward</Text>
              <Text className="text-gray-900 font-semibold">{expectedScLabel}</Text>
            </View>
            {!isActiveCoopMember ? (
              <TouchableOpacity
                className="mt-1 rounded-xl border px-4 py-3"
                style={{ borderColor: withAlpha(accentColor, '35'), backgroundColor: withAlpha(accentColor, '08') }}
                onPress={() => router.push(user ? '/(authenticated)/home' as any : '/' as any)}
              >
                <Text className="text-center font-semibold" style={{ color: accentColor }}>
                  Apply on home
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Non-eligible merchant notice */}
        {businessReadiness && !businessReadiness.scRewardEligible && (
          <View className="mx-6 mt-4 p-4 border rounded-xl" style={{ backgroundColor: withAlpha(accentColor, '12'), borderColor: withAlpha(accentColor, '30') }}>
            <View className="flex-row items-start gap-3">
              <Info size={20} color={accentColor} />
              <View className="flex-1">
                <Text className="font-semibold" style={{ color: accentColor }}>No {coin.symbol} Rewards</Text>
                <Text className="text-gray-600 text-sm mt-1">
                  This merchant is not yet eligible for {coin.name} rewards.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Cart Items */}
        <View className="mx-6 mt-4 bg-white rounded-2xl p-4 border border-gray-100">
          <Text className="text-gray-900 font-semibold mb-3">Order Items</Text>
          {cartItems.map((item) => (
            <View key={item.productId} className="flex-row justify-between items-center py-3 border-b border-gray-100">
              <View className="flex-1">
                <Text className="text-gray-900 font-medium">{item.name}</Text>
                <Text className="text-gray-500 text-sm">Qty: {item.quantity}</Text>
              </View>
              <Text className="text-gray-900 font-semibold">
                ${(item.priceUSD * item.quantity).toFixed(2)}
              </Text>
            </View>
          ))}
        </View>

        {/* Price Breakdown */}
        {preview && (
          <View className="mx-6 mt-4 bg-white rounded-2xl p-4 border border-gray-100">
            <Text className="text-gray-900 font-semibold mb-3">Price Breakdown</Text>
            
            <View className="space-y-2">
              <View className="flex-row justify-between py-2">
                <Text className="text-gray-500">Items</Text>
                <Text className="text-gray-900">${(preview.listedAmountCents / 100).toFixed(2)}</Text>
              </View>
              
              {appliesTreasuryFee && (
                <View className="flex-row justify-between py-2">
                  <Text className="text-gray-500">Treasury fee</Text>
                  <Text className="text-gray-500">${(displayedTreasuryFeeCents / 100).toFixed(2)}</Text>
                </View>
              )}
              
              <View className="h-px bg-gray-100 my-2" />
              
              <View className="flex-row justify-between py-2">
                <Text className="text-gray-900 font-bold">Total due</Text>
                <Text className="font-bold text-lg" style={{ color: accentColor }}>
                  ${(displayTotalCents / 100).toFixed(2)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Reward Preview */}
        {preview?.customerReward?.eligible && (
          <View className="mx-6 mt-4 p-4 border rounded-xl" style={{ backgroundColor: withAlpha(accentColor, '12'), borderColor: withAlpha(accentColor, '30') }}>
            <View className="flex-row items-center gap-2 mb-2">
              <BadgeCheck size={20} color={accentColor} />
              <Text className="font-semibold" style={{ color: accentColor }}>{coin.symbol} Reward</Text>
            </View>
            <Text className="text-gray-900 text-lg font-bold">
              +{formatScAmount(preview.customerReward.estimatedAmount)} {coin.symbol}
            </Text>
            <Text className="text-gray-500 text-sm mt-1">
              {coin.name} earned from this purchase
            </Text>
          </View>
        )}

        {/* Cardholder Name */}
        <View className="px-6 pt-4 pb-2">
          <Text className="text-gray-900 font-semibold mb-2">Cardholder Name</Text>
          <TextInput
            className="bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
            placeholder="Name on card..."
            placeholderTextColor="#9CA3AF"
            value={cardholderName}
            onChangeText={setCardholderName}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!paymentSession}
            style={{ opacity: paymentSession ? 0.6 : 1 }}
          />
        </View>

        {/* Shipping Address */}
        <View className="px-6 py-4 gap-3">
          <Text className="text-gray-900 font-semibold">Shipping Address</Text>
          <TextInput
            className="bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
            placeholder="Street address..."
            placeholderTextColor="#9CA3AF"
            value={shippingAddress.line1}
            onChangeText={(value) => updateShippingAddress('line1', value)}
            autoComplete="street-address"
            editable={!paymentSession}
            style={{ opacity: paymentSession ? 0.6 : 1 }}
          />
          <TextInput
            className="bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
            placeholder="Apartment, suite, etc. (optional)"
            placeholderTextColor="#9CA3AF"
            value={shippingAddress.line2}
            onChangeText={(value) => updateShippingAddress('line2', value)}
            editable={!paymentSession}
            style={{ opacity: paymentSession ? 0.6 : 1 }}
          />
          <View className="flex-row gap-3">
            <TextInput
              className="flex-1 bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
              placeholder="City..."
              placeholderTextColor="#9CA3AF"
              value={shippingAddress.city}
              onChangeText={(value) => updateShippingAddress('city', value)}
              autoComplete="off"
              editable={!paymentSession}
              style={{ opacity: paymentSession ? 0.6 : 1 }}
            />
            <TextInput
              className="w-24 bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
              placeholder="State"
              placeholderTextColor="#9CA3AF"
              value={shippingAddress.state}
              onChangeText={(value) => updateShippingAddress('state', value)}
              autoComplete="off"
              autoCapitalize="characters"
              editable={!paymentSession}
              style={{ opacity: paymentSession ? 0.6 : 1 }}
            />
          </View>
          <View className="flex-row gap-3">
            <TextInput
              className="flex-1 bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
              placeholder="ZIP code..."
              placeholderTextColor="#9CA3AF"
              value={shippingAddress.postalCode}
              onChangeText={(value) => updateShippingAddress('postalCode', value)}
              autoComplete="postal-code"
              keyboardType="number-pad"
              editable={!paymentSession}
              style={{ opacity: paymentSession ? 0.6 : 1 }}
            />
            <TextInput
              className="w-24 bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
              placeholder="US"
              placeholderTextColor="#9CA3AF"
              value={shippingAddress.country}
              onChangeText={(value) => updateShippingAddress('country', value)}
              autoComplete="country"
              autoCapitalize="characters"
              editable={!paymentSession}
              style={{ opacity: paymentSession ? 0.6 : 1 }}
            />
          </View>
        </View>

        {/* Note */}
        <View className="px-6 py-4">
          <Text className="text-gray-900 font-semibold mb-2">Order Note (Optional)</Text>
          <TextInput
            className="bg-white text-gray-900 px-4 py-3 rounded-xl border border-gray-200"
            placeholder="Add a note for the merchant..."
            placeholderTextColor="#9CA3AF"
            value={note}
            onChangeText={setNote}
            multiline
            editable={!paymentSession}
            style={{ opacity: paymentSession ? 0.6 : 1 }}
          />
        </View>

        {paymentSession && (
          <CommercePaymentConfirmation
            clientSecret={paymentSession.clientSecret}
            checkoutUrl={paymentSession.checkoutUrl}
            merchantName={store.name}
            amountLabel={`$${(paymentSession.totalCents / 100).toFixed(2)}`}
            accentColor={accentColor}
            cardholderName={cardholderName || undefined}
            onSuccess={handlePaymentSuccess}
            onError={(message) => Alert.alert('Payment Error', message)}
          />
        )}
      </ScrollView>

      {/* Checkout Button */}
      <View className="px-6 py-4 border-t border-gray-200 bg-white">
        {paymentSession ? (
          <TouchableOpacity
            className="py-3 rounded-xl flex-row items-center justify-center border"
            style={{ borderColor: withAlpha(accentColor, '40') }}
            onPress={() => setPaymentSession(null)}
          >
            <CreditCard size={18} color={accentColor} />
            <Text className="font-bold ml-2" style={{ color: accentColor }}>
              Edit order details
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            className="py-4 rounded-xl flex-row items-center justify-center"
            style={{ backgroundColor: processing ? '#6B7280' : accentColor }}
            onPress={handleCheckout}
            disabled={processing}
          >
            {processing ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text className="text-white font-bold text-lg ml-2">Creating checkout...</Text>
              </>
            ) : (
              <>
                <Check size={20} color="#fff" />
                <Text className="text-white font-bold text-lg ml-2">
                  Continue to payment ${(totalCents / 100).toFixed(2)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
        
        <Text className="text-gray-500 text-xs text-center mt-3">
          Card payments are securely processed by Stripe
        </Text>
      </View>
    </SafeAreaView>
  );
}

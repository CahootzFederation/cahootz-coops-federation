import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Clock } from 'lucide-react-native';

import { LoadError } from '@/components/load-error';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import {
  api,
  formatPaymentReference,
  formatReceiptDateTime,
  type TransferReceipt,
} from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

/** The payment's status in plain words. */
function statusInWords(receipt: TransferReceipt): string {
  switch (receipt.status) {
    case 'COMPLETED':
      return receipt.direction === 'received' ? 'Received' : 'Paid';
    case 'PENDING':
    case 'PROCESSING':
      return 'Still going through';
    case 'FAILED':
      return "Didn't go through";
    case 'PENDING_CLAIM':
      return 'Waiting for them to accept it';
    case 'EXPIRED':
      return 'Not accepted in time';
    case 'CLAIMED_TO_BANK':
    case 'CLAIMED_TO_SOULAAN':
      return 'Accepted';
    default:
      return 'Unknown';
  }
}

function counterpartyLabel(receipt: TransferReceipt): string {
  return receipt.direction === 'received' ? 'From' : 'To';
}

function headline(receipt: TransferReceipt): string {
  const who = receipt.storeName || receipt.counterparty;
  if (receipt.direction === 'received') return `From ${who}`;
  if (receipt.status === 'COMPLETED') return `Paid to ${who}`;
  return `To ${who}`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      className="flex-row items-start justify-between border-b border-gray-100 py-3"
      style={{ minHeight: 44 }}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text className="text-base text-gray-600">{label}</Text>
      <Text className="ml-4 flex-1 text-right text-base font-semibold text-gray-900">{value}</Text>
    </View>
  );
}

export default function ReceiptScreen() {
  const { user, sessionToken } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const transferId = typeof params.id === 'string' ? params.id : '';

  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    if (!transferId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      let walletAddress = user.walletAddress;
      if (!walletAddress) {
        const walletResult = await api.getWalletInfo(user.id, user.walletAddress, sessionToken);
        if (walletResult?.hasWallet && walletResult?.address) walletAddress = walletResult.address;
      }
      setReceipt(await api.getTransferReceipt(transferId, walletAddress));
    } catch (err) {
      console.error('Error loading receipt:', err);
      if ((err as { code?: string })?.code === 'NOT_FOUND') {
        setNotFound(true);
      } else {
        setError(friendlyError(err, "We couldn't load this receipt."));
      }
    } finally {
      setLoading(false);
    }
  }, [transferId, user?.id, user?.walletAddress, sessionToken]);

  useEffect(() => {
    load();
  }, [load]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(authenticated)/history' as any);
    }
  };

  const failed = receipt?.status === 'FAILED' || receipt?.status === 'EXPIRED';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-gray-50">
        <View className="flex-row items-center border-b border-gray-100 bg-white px-4 pb-4 pt-14">
          <TouchableOpacity
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="mr-2 items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <ArrowLeft size={24} color="#111827" />
          </TouchableOpacity>
          <Text className="text-2xl font-bold text-gray-900">Receipt</Text>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#6B7280" />
          </View>
        ) : notFound ? (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-center text-lg font-semibold text-gray-900">
              We couldn&apos;t find this payment.
            </Text>
            <Text className="mt-2 text-center text-gray-600">
              It may not be one of yours. Go back to your payments and pick another one.
            </Text>
            <TouchableOpacity
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Go back to your payments"
              className="mt-6 items-center justify-center rounded-xl bg-gray-900 px-6"
              style={{ minHeight: 48 }}
            >
              <Text className="font-semibold text-white">Go back</Text>
            </TouchableOpacity>
          </View>
        ) : error || !receipt ? (
          <View className="p-4">
            <LoadError
              title="Your receipt didn't load"
              message={error ?? "We couldn't load this receipt. Please try again."}
              onRetry={load}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <View className="items-center rounded-2xl bg-white p-6">
              <View
                className={`mb-3 h-14 w-14 items-center justify-center rounded-full ${
                  receipt.direction === 'received' ? 'bg-green-100' : receipt.direction === 'pending' ? 'bg-yellow-100' : 'bg-gray-100'
                }`}
              >
                {receipt.direction === 'received' ? (
                  <ArrowDownLeft size={26} color="#16A34A" />
                ) : receipt.direction === 'pending' ? (
                  <Clock size={26} color="#CA8A04" />
                ) : (
                  <ArrowUpRight size={26} color="#374151" />
                )}
              </View>
              <Text
                className={`text-4xl font-bold ${failed ? 'text-gray-400' : receipt.direction === 'received' ? 'text-green-700' : 'text-gray-900'}`}
                accessibilityLabel={`Amount ${money(receipt.amount)}`}
              >
                {money(receipt.amount)}
              </Text>
              <Text className="mt-2 text-center text-lg text-gray-700">{headline(receipt)}</Text>
            </View>

            <View className="mt-4 rounded-2xl bg-white px-5 py-2">
              {receipt.storeName ? <ReceiptRow label="Store" value={receipt.storeName} /> : null}
              <ReceiptRow label={counterpartyLabel(receipt)} value={receipt.counterparty} />
              <ReceiptRow label="Amount" value={money(receipt.amount)} />
              <ReceiptRow label="Fee" value={money(receipt.fee)} />
              <ReceiptRow label="Date and time" value={formatReceiptDateTime(receipt.createdAt)} />
              <ReceiptRow label="Status" value={statusInWords(receipt)} />
              <ReceiptRow label="Reference" value={formatPaymentReference(receipt.id)} />
              {receipt.note ? <ReceiptRow label="Note" value={receipt.note} /> : null}
            </View>

            <Text className="mt-3 px-1 text-sm text-gray-500">
              If you need help with this payment, share the reference with support.
            </Text>

            <TouchableOpacity
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Done"
              className="mt-6 items-center justify-center rounded-xl bg-gray-900"
              style={{ minHeight: 52 }}
            >
              <Text className="text-lg font-semibold text-white">Done</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api, type StewardOffer } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { keyboardInsetScrollProps } from '@/lib/keyboard';
import { formatCents, formatOfferDateTime } from '@/lib/offers';

const colors = { paper: DESIGN.paper, ink: DESIGN.ink, muted: DESIGN.muted, line: DESIGN.border, orange: '#E85D04', forest: '#245B45', red: '#B42318' };

const STATUS: Record<string, string> = {
  PENDING_STEWARD: 'Needs your OK',
  LIVE: 'Live',
  PAUSED: 'Paused',
  AWAITING_VENDOR: 'Goal met',
  PAYMENT_OPEN: 'Members paying',
  CONFIRMED: 'Confirmed',
  ORDERED: 'Ordered',
  READY: 'Ready',
  FULFILLED: 'Finished',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  FAILED: 'Called off',
};

/**
 * Stewards approve offers before members see them, and follow how they went.
 * Totals only: this screen never shows who joined or what anyone paid.
 */
export default function CommonsOffersScreen() {
  const { coopId } = useLocalSearchParams<{ coopId: string }>();
  const { sessionToken } = useAuth();
  const [offers, setOffers] = useState<StewardOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!coopId || !sessionToken) return;
    try {
      setError(null);
      setOffers(await api.listStewardOffers(coopId, sessionToken));
    } catch (reason) {
      setError(friendlyError(reason, "We couldn't load offers for review."));
    }
  }, [coopId, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = (offers ?? []).filter((offer) => offer.status === 'PENDING_STEWARD');
  const others = (offers ?? []).filter((offer) => offer.status !== 'PENDING_STEWARD');

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: colors.paper }}>
      <View className="flex-row items-center px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="h-11 w-11 items-center justify-center">
          <ArrowLeft size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="ml-2 text-base font-black" style={{ color: colors.ink }}>Member deals</Text>
      </View>
      <ScrollView
        {...keyboardInsetScrollProps}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Text className="text-sm" style={{ color: colors.muted }}>
          Check each offer before members see it. You&apos;ll only ever see totals here, never who joined or paid.
        </Text>
        {error ? <Text className="mt-4 text-sm font-semibold" style={{ color: colors.red }}>{error}</Text> : null}
        {!offers && !error ? <ActivityIndicator className="mt-10" color={colors.orange} /> : null}

        {offers ? (
          <>
            <Text className="mt-5 text-lg font-black" style={{ color: colors.ink }}>Waiting for you</Text>
            {pending.length === 0 ? (
              <Text className="mt-2 text-sm" style={{ color: colors.muted }}>Nothing to review right now.</Text>
            ) : (
              pending.map((offer) => <PendingOffer key={offer.id} offer={offer} sessionToken={sessionToken!} onDone={load} />)
            )}
            {others.length > 0 ? (
              <>
                <Text className="mt-6 text-lg font-black" style={{ color: colors.ink }}>Live and past</Text>
                {others.map((offer) => <OfferResults key={offer.id} offer={offer} />)}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function OfferSummary({ offer }: { offer: StewardOffer }) {
  const isGroupBuy = offer.offerType === 'GROUP_BUY';
  const line = (label: string, value: string | null | undefined) =>
    value ? (
      <Text className="mt-1 text-xs" style={{ color: colors.ink }}>
        <Text className="text-xs font-black" style={{ color: colors.muted }}>{label}: </Text>
        {value}
      </Text>
    ) : null;
  return (
    <>
      <Text className="text-[11px] font-black" style={{ color: colors.orange }}>
        {isGroupBuy ? 'Group buy' : 'Member deal'} · {STATUS[offer.status] ?? offer.status}
      </Text>
      <Text className="mt-1 text-base font-black" style={{ color: colors.ink }}>{offer.title}</Text>
      <Text className="text-xs font-semibold" style={{ color: colors.muted }}>{offer.vendorName} · {offer.productName}</Text>
      <Text className="mt-2 text-sm" style={{ color: colors.ink }}>
        <Text className="text-sm line-through" style={{ color: colors.muted }}>{formatCents(offer.regularPriceCents)}</Text>{' '}
        <Text className="text-sm font-black">{formatCents(offer.memberPriceCents)}</Text>{' '}
        <Text className="text-sm font-black" style={{ color: colors.forest }}>saves {formatCents(offer.savingsCents)} ({offer.savingsPercent}%)</Text>
      </Text>
      {line('Regular price from', offer.regularPriceSource)}
      {line('Shares from the vendor', `Cahootz ${offer.federationFeeBps / 100}%, this Commons ${offer.commonsFeeBps / 100}%. Members pay no extra fees.`)}
      {isGroupBuy
        ? line('Goal', `${offer.minimumCommitments} committed by ${formatOfferDateTime(offer.commitmentDeadline)}, then ${offer.minimumPaidOrders} paid within ${offer.paymentWindowHours} hours`)
        : line('Ends', formatOfferDateTime(offer.expiresAt))}
      {line('Limit', `${offer.quantityPerMember} per household${offer.maximumQuantity ? `, ${offer.maximumQuantity} total` : ''}`)}
      {line(offer.fulfillmentMethod === 'PICKUP' ? 'Pickup' : 'Delivery', offer.pickupLocation)}
      {line('How to redeem', offer.redemptionRules)}
      {line('Refunds', offer.refundPolicy)}
      {line('Substitutions', offer.substitutionPolicy)}
      {line('Other terms', offer.terms)}
    </>
  );
}

function PendingOffer({ offer, sessionToken, onDone }: { offer: StewardOffer; sessionToken: string; onDone: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: 'approve' | 'sendBack') {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'approve') await api.approveOffer(offer.id, sessionToken);
      else await api.sendOfferBack(offer.id, note.trim(), sessionToken);
      await onDone();
    } catch (reason) {
      setError(friendlyError(reason, "That didn't go through. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="mt-3 rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }} accessibilityLabel={`Review ${offer.title}`}>
      <OfferSummary offer={offer} />
      {sendingBack ? (
        <>
          <TextInput
            accessibilityLabel="What needs to change"
            value={note}
            onChangeText={setNote}
            placeholder="What needs to change?"
            placeholderTextColor="#A6998A"
            multiline
            className="mt-3 min-h-[72px] rounded-xl border p-3 text-sm"
            style={{ borderColor: colors.line, color: colors.ink }}
          />
          <TouchableOpacity accessibilityRole="button" disabled={busy || note.trim().length < 3} onPress={() => act('sendBack')} className="mt-3 items-center justify-center rounded-xl border" style={{ borderColor: colors.line, minHeight: 44, opacity: busy || note.trim().length < 3 ? 0.5 : 1 }}>
            <Text className="font-black" style={{ color: colors.ink }}>Send back</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View className="mt-4 flex-row gap-2">
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => act('approve')} className="flex-1 items-center justify-center rounded-xl" style={{ backgroundColor: colors.ink, minHeight: 44, opacity: busy ? 0.6 : 1 }}>
            <Text className="font-black text-white">Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => setSendingBack(true)} className="flex-1 items-center justify-center rounded-xl border" style={{ borderColor: colors.line, minHeight: 44 }}>
            <Text className="font-black" style={{ color: colors.ink }}>Ask for changes</Text>
          </TouchableOpacity>
        </View>
      )}
      {error ? <Text className="mt-2 text-sm" style={{ color: colors.red }}>{error}</Text> : null}
    </View>
  );
}

function OfferResults({ offer }: { offer: StewardOffer }) {
  return (
    <View className="mt-3 rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }} accessibilityLabel={`Results for ${offer.title}`}>
      <OfferSummary offer={offer} />
      <View className="mt-3 flex-row flex-wrap gap-x-5 gap-y-1 border-t pt-3" style={{ borderColor: colors.line }}>
        <Text className="text-xs" style={{ color: colors.ink }}><Text className="text-xs font-black">{offer.householdCount}</Text> households</Text>
        <Text className="text-xs" style={{ color: colors.ink }}><Text className="text-xs font-black">{offer.committedQuantity}</Text> units</Text>
        <Text className="text-xs" style={{ color: colors.ink }}><Text className="text-xs font-black">{offer.paidOrders}</Text> paid orders</Text>
        <Text className="text-xs" style={{ color: colors.ink }}>Members saved <Text className="text-xs font-black">{formatCents(offer.verifiedSavingsCents)}</Text></Text>
        <Text className="text-xs" style={{ color: colors.ink }}>Commons share <Text className="text-xs font-black">{formatCents(offer.commonsRevenueCents)}</Text></Text>
      </View>
    </View>
  );
}

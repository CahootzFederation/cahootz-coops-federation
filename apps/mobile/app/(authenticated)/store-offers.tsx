import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, Phone } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api, type VendorOffer, type VendorRosterEntry } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { formatCents, formatOfferDateTime } from '@/lib/offers';

const colors = { paper: DESIGN.paper, ink: DESIGN.ink, muted: DESIGN.muted, line: DESIGN.border, orange: '#E85D04', forest: '#245B45', forestSoft: '#E7F3ED', red: '#B42318' };

const STATUS: Record<string, string> = {
  LIVE: 'Live',
  PAUSED: 'Paused',
  AWAITING_VENDOR: 'Goal met: confirm you can fill it',
  PAYMENT_OPEN: 'Members are paying',
  CONFIRMED: 'Confirmed: place the order',
  ORDERED: 'Ordered',
  READY: 'Ready',
  FULFILLED: 'Finished',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  FAILED: 'Called off',
};

const NEXT_STEP: Record<string, { status: 'ORDERED' | 'READY' | 'FULFILLED'; label: string } | undefined> = {
  CONFIRMED: { status: 'ORDERED', label: "I've placed the order" },
  ORDERED: { status: 'READY', label: "It's ready" },
  READY: { status: 'FULFILLED', label: 'Everyone has it' },
};

/** A shop owner's Member Deals and Group Buys: who joined, and the next step. */
export default function StoreOffersScreen() {
  const { offerId: focusId } = useLocalSearchParams<{ offerId?: string }>();
  const { sessionToken } = useAuth();
  const [offers, setOffers] = useState<VendorOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    try {
      setError(null);
      setOffers(await api.listVendorOffers(sessionToken));
    } catch (reason) {
      setError(friendlyError(reason, "We couldn't load your offers."));
    }
  }, [sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: colors.paper }}>
      <View className="flex-row items-center px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="h-11 w-11 items-center justify-center">
          <ArrowLeft size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="ml-2 text-base font-black" style={{ color: colors.ink }}>Deals and group buys</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {error ? <Text className="text-sm font-semibold" style={{ color: colors.red }}>{error}</Text> : null}
        {!offers && !error ? <ActivityIndicator className="mt-10" color={colors.orange} /> : null}
        {offers?.length === 0 ? (
          <Text className="text-sm" style={{ color: colors.muted }}>
            No offers yet. Cahootz sets these up with you; once a steward approves one, it shows here.
          </Text>
        ) : null}
        {offers?.map((offer) => (
          <VendorOfferCard key={offer.id} offer={offer} sessionToken={sessionToken!} startOpen={offer.id === focusId} onChanged={load} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function VendorOfferCard({ offer, sessionToken, startOpen, onChanged }: { offer: VendorOffer; sessionToken: string; startOpen: boolean; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(startOpen);
  const [roster, setRoster] = useState<VendorRosterEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isGroupBuy = offer.offerType === 'GROUP_BUY';
  const yourShare = offer.memberPriceCents - Math.round((offer.memberPriceCents * (offer.federationFeeBps + offer.commonsFeeBps)) / 10000);

  const loadRoster = useCallback(async () => {
    try {
      setRoster(await api.getVendorRoster(offer.id, sessionToken));
    } catch (reason) {
      setMessage(friendlyError(reason, "We couldn't load who joined."));
    }
  }, [offer.id, sessionToken]);

  useEffect(() => {
    if (open) void loadRoster();
  }, [open, loadRoster]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(done);
      await Promise.all([onChanged(), loadRoster()]);
    } catch (reason) {
      setMessage(friendlyError(reason, "That update didn't save. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const next = NEXT_STEP[offer.status];
  return (
    <View className="mb-3 rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${offer.title} details`} onPress={() => setOpen((v) => !v)}>
        <Text className="text-[11px] font-black" style={{ color: colors.orange }}>
          {isGroupBuy ? 'Group buy' : 'Member deal'} · {offer.status === 'LIVE' && isGroupBuy ? 'Taking commitments' : STATUS[offer.status] ?? offer.status}
        </Text>
        <Text className="mt-1 text-base font-black" style={{ color: colors.ink }}>{offer.title}</Text>
        <Text className="mt-1 text-xs" style={{ color: colors.muted }}>
          Members pay {formatCents(offer.memberPriceCents)}. You get {formatCents(yourShare)} each. Cahootz covers the card fee.
        </Text>
        <Text className="mt-2 text-sm font-black" style={{ color: colors.ink }}>
          {isGroupBuy ? `${offer.committedQuantity} of ${offer.minimumCommitments} committed` : `${offer.paidOrders} sold`}
          {isGroupBuy && offer.paidOrders ? ` · ${offer.paidOrders} paid` : ''}
        </Text>
        {offer.status === 'LIVE' && offer.commitmentDeadline ? (
          <Text className="text-xs" style={{ color: colors.muted }}>Commitments close {formatOfferDateTime(offer.commitmentDeadline)}</Text>
        ) : null}
        {offer.status === 'PAYMENT_OPEN' && offer.paymentDeadline ? (
          <Text className="text-xs" style={{ color: colors.muted }}>Payment closes {formatOfferDateTime(offer.paymentDeadline)}</Text>
        ) : null}
        <Text className="mt-1 text-xs" style={{ color: colors.muted }}>Paid so far: {formatCents(offer.vendorProceedsCents)} to you</Text>
      </TouchableOpacity>

      {offer.status === 'AWAITING_VENDOR' ? (
        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          onPress={() => run(() => api.confirmOfferCapacity(offer.id, sessionToken), 'Payment is open. Members have been asked to pay.')}
          className="mt-3 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.ink, minHeight: 48, opacity: busy ? 0.6 : 1 }}
        >
          <Text className="font-black text-white">I can fill {offer.committedQuantity}. Open payment</Text>
        </TouchableOpacity>
      ) : null}
      {next ? (
        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          onPress={() => run(() => api.updateOfferFulfillment(offer.id, next.status, sessionToken), 'Updated. Members who paid were told.')}
          className="mt-3 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.ink, minHeight: 48, opacity: busy ? 0.6 : 1 }}
        >
          <Text className="font-black text-white">{next.label}</Text>
        </TouchableOpacity>
      ) : null}
      {message ? <Text className="mt-2 text-sm" style={{ color: colors.ink }}>{message}</Text> : null}

      {open ? (
        <View className="mt-3 border-t pt-3" style={{ borderColor: colors.line }}>
          <Text className="text-sm font-black" style={{ color: colors.ink }}>Who joined</Text>
          <Text className="text-xs" style={{ color: colors.muted }}>Members agreed to share this so you can plan and hand off orders.</Text>
          {!roster ? <ActivityIndicator className="mt-3" color={colors.orange} /> : null}
          {roster?.length === 0 ? <Text className="mt-2 text-xs" style={{ color: colors.muted }}>Nobody yet.</Text> : null}
          {roster?.map((entry) => (
            <View key={entry.commitmentId} className="mt-2 flex-row items-center justify-between rounded-xl p-2" style={{ backgroundColor: entry.paid ? colors.forestSoft : '#F7F1E8' }}>
              <View className="flex-1">
                <Text className="text-sm font-black" style={{ color: colors.ink }}>{entry.name} · {entry.quantity}</Text>
                <Text className="text-xs" style={{ color: colors.muted }}>
                  {entry.pickedUp ? 'Picked up' : entry.paid ? 'Paid' : entry.status === 'LAPSED' ? "Didn't pay in time" : 'Not paid yet'}
                </Text>
              </View>
              {entry.phone ? (
                <TouchableOpacity accessibilityLabel={`Call ${entry.name}`} onPress={() => Linking.openURL(`tel:${entry.phone}`)} className="h-9 w-9 items-center justify-center">
                  <Phone size={16} color={colors.ink} />
                </TouchableOpacity>
              ) : null}
              {entry.paid && !entry.pickedUp && ['READY', 'ORDERED', 'CONFIRMED'].includes(offer.status) ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${entry.name} picked up`}
                  disabled={busy}
                  onPress={() => run(() => api.markOfferPickedUp(entry.commitmentId, sessionToken), `${entry.name} marked picked up.`)}
                  className="h-9 flex-row items-center rounded-lg px-2"
                  style={{ backgroundColor: colors.ink }}
                >
                  <Check size={14} color="#FFFFFF" />
                  <Text className="ml-1 text-xs font-black text-white">Picked up</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

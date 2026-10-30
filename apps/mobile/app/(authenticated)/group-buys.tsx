import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { OfferCard } from '@/components/offer-card';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api, type MarketplaceOffer } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

const colors = { paper: DESIGN.paper, ink: DESIGN.ink, muted: DESIGN.muted, orange: '#E85D04', red: '#B42318' };

type Offer = MarketplaceOffer & { commonsName: string | null };

const time = (value: string | Date | null | undefined) => (value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER);

/** Joined first when a payment is needed, then by the next deadline. */
function sortMine(a: Offer, b: Offer) {
  const needsPay = (o: Offer) => (o.myCommitment?.chargeError && o.canPay ? 0 : 1);
  return needsPay(a) - needsPay(b) || time(a.paymentDeadline ?? a.commitmentDeadline) - time(b.paymentDeadline ?? b.commitmentDeadline);
}

/** Every group buy from all of the member's Commons: the ones they joined, then the open ones. */
export default function GroupBuysScreen() {
  const { sessionToken } = useAuth();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    try {
      setOffers(await api.listAllOffers(sessionToken));
      setError(null);
    } catch (reason) {
      setError(friendlyError(reason, "We couldn't load group deals right now. Pull down to try again."));
    }
  }, [sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = (offers ?? []).filter((o) => o.myCommitment && o.myCommitment.status !== 'CANCELLED').sort(sortMine);
  const open = (offers ?? [])
    .filter((o) => o.status === 'LIVE' && !mine.includes(o))
    .sort((a, b) => time(a.commitmentDeadline) - time(b.commitmentDeadline));

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: colors.paper }}>
      <View className="flex-row items-center px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="h-11 w-11 items-center justify-center">
          <ArrowLeft size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="ml-2 text-base font-black" style={{ color: colors.ink }}>All group deals</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {error ? <Text className="mb-3 text-sm font-semibold" style={{ color: colors.red }}>{error}</Text> : null}
        {!offers && !error ? <ActivityIndicator className="mt-10" color={colors.orange} /> : null}
        {offers ? (
          <>
            <Text className="mb-4 text-xs font-semibold" style={{ color: colors.muted }}>
              From every Commons you&apos;re in. Nobody pays unless enough people join.
            </Text>
            {mine.length > 0 ? (
              <View accessibilityLabel="Group deals you joined">
                <Text className="mb-2 text-lg font-black" style={{ color: colors.ink }}>You joined</Text>
                {mine.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} commonsName={offer.commonsName} />
                ))}
              </View>
            ) : null}
            <View accessibilityLabel="Open group deals" className={mine.length > 0 ? 'mt-4' : ''}>
              <Text className="mb-2 text-lg font-black" style={{ color: colors.ink }}>Open now</Text>
              {open.length === 0 ? (
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {mine.length > 0 ? "That's all of them for now." : "No group deals are open in your Commons right now. We'll let you know when one starts."}
                </Text>
              ) : (
                open.map((offer) => <OfferCard key={offer.id} offer={offer} commonsName={offer.commonsName} />)
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

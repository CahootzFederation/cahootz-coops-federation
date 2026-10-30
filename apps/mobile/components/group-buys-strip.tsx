import React, { useCallback, useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight, Users } from 'lucide-react-native';

import { OfferImage } from '@/components/offer-image';
import { OfferPrice } from '@/components/offer-price';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api, type MarketplaceOffer } from '@/lib/api';
import { formatCents, formatOfferDate, offerStatusLine } from '@/lib/offers';

const colors = { ink: DESIGN.ink, muted: DESIGN.muted, line: DESIGN.border, orange: '#E85D04', forest: '#245B45', red: '#B42318' };

const ENDED = ['FULFILLED', 'EXPIRED', 'FAILED', 'CANCELLED'];

/** Joined group buys that still need watching, then open ones the member hasn't joined. */
export function stripOffers(offers: MarketplaceOffer[]) {
  const joined = offers.filter((o) => activeSpot(o) && !ENDED.includes(o.status));
  const open = offers
    .filter((o) => o.status === 'LIVE' && !joined.includes(o))
    .sort((a, b) => new Date(a.commitmentDeadline ?? 0).getTime() - new Date(b.commitmentDeadline ?? 0).getTime());
  return { joined, open };
}

/** The member's spot, unless they cancelled it. */
function activeSpot(offer: MarketplaceOffer) {
  return offer.myCommitment && offer.myCommitment.status !== 'CANCELLED' ? offer.myCommitment : null;
}

function cardLine(offer: MarketplaceOffer) {
  const mine = activeSpot(offer);
  if (mine && offer.status === 'LIVE') return `You're in · ${offer.committedQuantity} of ${offer.minimumCommitments} · deal ends ${formatOfferDate(offer.commitmentDeadline)}`;
  if (mine) return offerStatusLine(offer);
  return `${offer.committedQuantity} of ${offer.minimumCommitments} joined · deal ends ${formatOfferDate(offer.commitmentDeadline)}`;
}

/**
 * Group buys up front: the ones you joined and where they stand, then the ones
 * open now. Hidden when there's nothing to show.
 */
export function GroupBuysStrip({ style }: { style?: object }) {
  const { sessionToken } = useAuth();
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) return;
      let cancelled = false;
      api
        .listAllOffers(sessionToken)
        .then((result) => !cancelled && setOffers(result))
        .catch(() => undefined); // The full page shows errors; the strip just stays hidden.
      return () => {
        cancelled = true;
      };
    }, [sessionToken]),
  );

  const { joined, open } = stripOffers(offers);
  // Yours first, then open ones, so a group buy you cancel stays put and just loses its "You're in".
  const shown = [...joined, ...open].slice(0, 10);
  if (shown.length === 0) return null;
  const title = 'Group buys';

  return (
    <View accessibilityLabel={title} style={style}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Users size={16} color={colors.orange} />
          <Text className="ml-1.5 text-base font-black" style={{ color: colors.ink }}>
            {title}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel="See all group buys"
          onPress={() => router.push('/(authenticated)/group-buys' as any)}
          hitSlop={8}
          className="flex-row items-center"
          style={{ minHeight: 44 }}
        >
          <Text className="text-sm font-black" style={{ color: colors.orange }}>
            See all
          </Text>
          <ChevronRight size={16} color={colors.orange} />
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 20 }}>
        {shown.map((offer) => {
          const needsPay = !!activeSpot(offer)?.chargeError && offer.canPay;
          return (
            <TouchableOpacity
              key={offer.id}
              accessibilityRole="button"
              accessibilityLabel={`Group buy: ${offer.title}`}
              onPress={() => router.push(`/offer-detail?id=${offer.id}` as any)}
              className="rounded-2xl border bg-white p-3"
              style={{ width: 220, borderColor: needsPay ? colors.red : colors.line }}
            >
              <OfferImage uri={offer.imageUrl} height={100} radius={10} />
              <Text className="mt-2 text-sm font-black" style={{ color: colors.ink }} numberOfLines={1}>
                {offer.title}
              </Text>
              <View className="mt-1">
                <OfferPrice offer={offer} size="sm" />
              </View>
              <Text className="mt-1 text-xs font-semibold" style={{ color: needsPay ? colors.red : activeSpot(offer) ? colors.forest : colors.muted }} numberOfLines={2}>
                {cardLine(offer)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

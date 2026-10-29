import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Tag, Users } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import type { MarketplaceOffer } from '@/lib/api';
import { formatCents, offerStatusLine, offerTypeLabel } from '@/lib/offers';

const colors = {
  ink: DESIGN.ink,
  muted: DESIGN.muted,
  line: DESIGN.border,
  orange: '#E85D04',
  forest: '#245B45',
  forestSoft: '#E7F3ED',
  goldSoft: '#FFF1D6',
};

/**
 * A Group Buy in the marketplace, with the saving spelled out so nobody has to
 * work it out.
 */
export function OfferCard({ offer }: { offer: MarketplaceOffer }) {
  const isGroupBuy = offer.offerType === 'GROUP_BUY';
  const progress = isGroupBuy && offer.minimumCommitments ? Math.min(1, offer.committedQuantity / offer.minimumCommitments) : 0;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${offerTypeLabel(offer)}: ${offer.title}`}
      onPress={() => router.push(`/offer-detail?id=${offer.id}` as any)}
      className="mb-3 rounded-2xl border bg-white p-4"
      style={{ borderColor: colors.line }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ backgroundColor: isGroupBuy ? colors.goldSoft : colors.forestSoft }}>
          {isGroupBuy ? <Users size={13} color={colors.orange} /> : <Tag size={13} color={colors.forest} />}
          <Text className="ml-1 text-[11px] font-black" style={{ color: isGroupBuy ? colors.orange : colors.forest }}>
            {offerTypeLabel(offer)}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.muted} />
      </View>
      <Text className="mt-2 text-base font-black" style={{ color: colors.ink }} numberOfLines={2}>
        {offer.title}
      </Text>
      <Text className="mt-0.5 text-xs font-semibold" style={{ color: colors.muted }}>
        From {offer.vendor.name}
      </Text>
      <View className="mt-3 flex-row flex-wrap items-baseline">
        <Text className="text-xs font-semibold line-through" style={{ color: colors.muted }} accessibilityLabel={`Regular price ${formatCents(offer.regularPriceCents)}`}>
          {formatCents(offer.regularPriceCents)}
        </Text>
        <Text className="ml-2 text-xl font-black" style={{ color: colors.ink }} accessibilityLabel={`Member price ${formatCents(offer.memberPriceCents)}`}>
          {formatCents(offer.memberPriceCents)}
        </Text>
        <Text className="ml-2 text-xs font-black" style={{ color: colors.forest }}>
          You save {formatCents(offer.savingsCents)} ({offer.savingsPercent}%)
        </Text>
      </View>
      {isGroupBuy && offer.status === 'LIVE' ? (
        <View className="mt-3 h-2 overflow-hidden rounded-full" style={{ backgroundColor: '#EEE3D3' }} accessibilityLabel={`${offer.committedQuantity} of ${offer.minimumCommitments} committed`}>
          <View className="h-full rounded-full" style={{ width: `${progress * 100}%`, backgroundColor: colors.orange }} />
        </View>
      ) : null}
      <Text className="mt-2 text-xs font-semibold" style={{ color: colors.muted }}>
        {offerStatusLine(offer)}
      </Text>
    </TouchableOpacity>
  );
}

import React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import type { MarketplaceOffer } from '@/lib/api';
import { formatCents } from '@/lib/offers';

const colors = { ink: DESIGN.ink, muted: DESIGN.muted, forest: '#245B45', forestSoft: '#E7F3ED' };

/**
 * The regular price struck through, the group price, and the saving in dollars.
 * Dollars, not a percent, because "Save $6.00" is easier to read than "25%".
 */
export function OfferPrice({ offer, size = 'md' }: { offer: Pick<MarketplaceOffer, 'regularPriceCents' | 'memberPriceCents' | 'savingsCents'>; size?: 'sm' | 'md' }) {
  const small = size === 'sm';
  return (
    <View className="flex-row flex-wrap items-center" style={{ gap: small ? 6 : 8 }}>
      <Text
        className={`${small ? 'text-xs' : 'text-sm'} font-semibold line-through`}
        style={{ color: colors.muted }}
        accessibilityLabel={`Regular price ${formatCents(offer.regularPriceCents)}`}
      >
        {formatCents(offer.regularPriceCents)}
      </Text>
      <Text
        className={`${small ? 'text-base' : 'text-xl'} font-black`}
        style={{ color: colors.ink }}
        accessibilityLabel={`Group price ${formatCents(offer.memberPriceCents)}`}
      >
        {formatCents(offer.memberPriceCents)}
      </Text>
      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.forestSoft }}>
        <Text className={`${small ? 'text-[11px]' : 'text-xs'} font-black`} style={{ color: colors.forest }}>
          Save {formatCents(offer.savingsCents)}
        </Text>
      </View>
    </View>
  );
}

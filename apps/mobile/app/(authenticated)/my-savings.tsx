import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, PiggyBank } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { track } from '@/lib/analytics';
import { api, type MemberSavings } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { formatCents, formatOfferDate } from '@/lib/offers';

const colors = { paper: DESIGN.paper, ink: DESIGN.ink, muted: DESIGN.muted, line: DESIGN.border, orange: '#E85D04', forest: '#245B45', forestSoft: '#E7F3ED', red: '#B42318' };

/** What a member has saved through deals and group buys they actually paid for. */
export default function MySavingsScreen() {
  const { sessionToken } = useAuth();
  const [savings, setSavings] = useState<MemberSavings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const result = await api.getMySavings(sessionToken);
      setSavings(result);
      track('my_savings_viewed', { offer_count: result.offers.length });
    } catch (reason) {
      setError(friendlyError(reason, "We couldn't load your savings."));
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
        <Text className="ml-2 text-base font-black" style={{ color: colors.ink }}>My savings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {error ? <Text className="text-sm font-semibold" style={{ color: colors.red }}>{error}</Text> : null}
        {!savings && !error ? <ActivityIndicator className="mt-10" color={colors.orange} /> : null}
        {savings ? (
          <>
            <View className="items-center rounded-2xl p-6" style={{ backgroundColor: colors.forestSoft }}>
              <PiggyBank size={30} color={colors.forest} />
              <Text className="mt-2 text-3xl font-black" style={{ color: colors.forest }} accessibilityLabel={`Total saved ${formatCents(savings.totalSavingsCents)}`}>
                {formatCents(savings.totalSavingsCents)}
              </Text>
              <Text className="mt-1 text-center text-xs font-semibold" style={{ color: colors.forest }}>
                saved with group deals. Only paid orders count, and refunds come off.
              </Text>
            </View>
            {savings.offers.length === 0 ? (
              <Text className="mt-5 text-center text-sm" style={{ color: colors.muted }}>
                Nothing yet. Look for Group deals in the marketplace.
              </Text>
            ) : (
              savings.offers.map((item) => (
                <TouchableOpacity
                  key={item.offerId}
                  onPress={() => router.push(`/offer-detail?id=${item.offerId}` as any)}
                  className="mt-3 rounded-2xl border bg-white p-4"
                  style={{ borderColor: colors.line }}
                >
                  <Text className="font-black" style={{ color: colors.ink }}>{item.title}</Text>
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    {item.vendorName} · {item.quantity} × · paid {formatCents(item.paidCents)}
                    {item.paidAt ? ` on ${formatOfferDate(item.paidAt)}` : ''}
                  </Text>
                  <Text className="mt-1 text-sm font-black" style={{ color: colors.forest }}>Saved {formatCents(item.savingsCents)}</Text>
                </TouchableOpacity>
              ))
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

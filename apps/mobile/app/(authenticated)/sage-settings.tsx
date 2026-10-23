import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DetailHeader } from '@/components/detail-header';
import { LoadError } from '@/components/load-error';
import { DESIGN } from '@/constants/design';

import { PreferenceSwitch } from '@/components/preference-switch';
import { SageIntro } from '@/components/sage-intro';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const LABEL = 'Show how Sage decides';

export default function SageSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { sessionToken } = useAuth();
  const client = useQueryClient();
  const queryKey = ['sage-trail-settings', sessionToken];
  const query = useQuery({
    queryKey,
    queryFn: () => api.getSageTrailSettings(sessionToken!),
    enabled: !!sessionToken,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (value: boolean) => api.setSageTrailSettings(value, sessionToken!),
    onSuccess: (saved) => client.setQueryData(queryKey, saved),
  });
  const enabled = mutation.isPending ? !!mutation.variables : !!query.data?.showSageDecisionTrails;

  return (
    <View style={{ flex: 1, backgroundColor: DESIGN.paper }}>
      <DetailHeader title="Sage settings" parent="You" onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet')} />
      <ScrollView contentContainerStyle={{ padding: DESIGN.gutter, paddingBottom: insets.bottom + 32, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
      <Text style={{ fontSize: 15, lineHeight: 22, color: DESIGN.muted }}>Choose what you see from Sage.</Text>
      {query.isPending ? <ActivityIndicator accessibilityLabel="Loading Sage settings" color={DESIGN.actionText} /> : null}
      {query.isError ? <LoadError title="Sage settings couldn’t load" message="Try again to see your saved preference." retrying={query.isFetching} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: DESIGN.border, backgroundColor: DESIGN.paper, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontWeight: '800', color: DESIGN.ink }}>{LABEL}</Text>
            <Text style={{ fontSize: 13, color: DESIGN.muted }}>
              See how Sage decided what to do with posts and circle conversations: what it read, what it considered,
              which rules it checked, what it did, and what happened next.
            </Text>
          </View>
          <PreferenceSwitch
            label={LABEL}
            value={enabled}
            disabled={!query.data || mutation.isPending}
            onChange={(value) => mutation.mutate(value)}
          />
        </View>
        <Text style={{ fontSize: 12, color: DESIGN.muted }}>
          You&apos;ll only see trails for posts and circles you can already see. Introductions and anything Sage flags for an
          admin stay private to platform admins.
        </Text>
        {mutation.isError ? (
          <Text accessibilityRole="alert" style={{ color: DESIGN.danger }}>We couldn&apos;t save that. Nothing changed, so try again.</Text>
        ) : mutation.isSuccess && !mutation.isPending ? (
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 13, color: DESIGN.success }}>Saved.</Text>
        ) : null}
      </View>

      ) : null}
      <SageIntro dismissible={false} collapsible />
    </ScrollView>
    </View>
  );
}

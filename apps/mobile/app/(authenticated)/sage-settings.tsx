import React from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';

import { PreferenceSwitch } from '@/components/preference-switch';
import { SageIntro } from '@/components/sage-intro';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const LABEL = 'Show Sage decision trails';

export default function SageSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { sessionToken } = useAuth();
  const client = useQueryClient();
  const queryKey = ['sage-trail-settings', sessionToken];
  const query = useQuery({
    queryKey,
    queryFn: () => api.getSageTrailSettings(sessionToken!),
    enabled: !!sessionToken,
  });
  const mutation = useMutation({
    mutationFn: (value: boolean) => api.setSageTrailSettings(value, sessionToken!),
    onSuccess: (saved) => client.setQueryData(queryKey, saved),
  });
  const enabled = mutation.isPending ? !!mutation.variables : !!query.data?.showSageDecisionTrails;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#FAFAF9' }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, gap: 16 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(authenticated)/profile' as any))}
          style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeft size={22} color="#C2410C" />
        </TouchableOpacity>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1C1917' }}>Sage settings</Text>
      </View>

      <SageIntro dismissible={false} />

      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: '#E7E5E4', backgroundColor: '#FFFFFF', padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontWeight: '800', color: '#1C1917' }}>{LABEL}</Text>
            <Text style={{ fontSize: 13, color: '#57534E' }}>
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
        <Text style={{ fontSize: 12, color: '#78716C' }}>
          You&apos;ll only see trails for posts and circles you can already see. Ride matches and anything Sage flags for an
          admin stay private to platform admins.
        </Text>
        {mutation.isError ? (
          <Text accessibilityRole="alert" style={{ color: '#B91C1C' }}>Could not save. Your previous choice is still active.</Text>
        ) : mutation.isSuccess && !mutation.isPending ? (
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 13, color: '#047857' }}>Saved.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

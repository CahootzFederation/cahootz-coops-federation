import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { sageStatusMeta } from '@/lib/sage-status';
import { ArrowLeft, Sparkles } from 'lucide-react-native';

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  ink: '#111827',
};

const TABS = [
  { key: 'NEEDS_YOU', label: 'Needs you' },
  { key: 'WAITING', label: 'Waiting' },
  { key: 'DONE', label: 'Done' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

type Suggestion = { id: string; title: string; circleId: string | null; status: string; createdAt: string };

export default function SageSuggestionsScreen() {
  const { isLoading, isAuthenticated, sessionToken } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<TabKey>('NEEDS_YOU');
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [isLoadingList, setIsLoadingList] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;
    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  const load = React.useCallback(() => {
    if (!sessionToken) return;
    setIsLoadingList(true);
    setError(null);
    api
      .listSageSuggestions(activeTab, sessionToken)
      .then((result) => setSuggestions(result.suggestions))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load Sage suggestions.'))
      .finally(() => setIsLoadingList(false));
  }, [activeTab, sessionToken]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!sessionToken) return;
    api
      .markSageSuggestionsSeen(sessionToken)
      .then(() => queryClient.invalidateQueries({ queryKey: ['unread-notifications-badge', sessionToken] }))
      .catch((err) => console.warn('Could not mark Sage alerts as seen:', err));
  }, [sessionToken, queryClient]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.paper }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/notifications'))}
          style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeft size={22} color={THEME.primary} />
        </TouchableOpacity>
        <Sparkles size={22} color={THEME.primary} />
        <Text style={{ fontSize: 20, fontWeight: '800', color: THEME.ink }}>Sage suggestions</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ maxHeight: 56 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
      >
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: activeTab === tab.key }}
            onPress={() => setActiveTab(tab.key)}
            style={{
              height: 34, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center',
              backgroundColor: activeTab === tab.key ? THEME.primary : '#FFFFFF',
              borderWidth: activeTab === tab.key ? 0 : 1, borderColor: THEME.border,
            }}
          >
            <Text style={{ color: activeTab === tab.key ? '#FFFFFF' : THEME.muted, fontWeight: '700', fontSize: 13 }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={isLoadingList} onRefresh={load} />}
      >
        {isLoadingList && suggestions.length === 0 ? (
          <ActivityIndicator accessibilityLabel="Loading Sage suggestions" color={THEME.primary} />
        ) : error ? (
          <Text style={{ color: '#B91C1C' }}>{error}</Text>
        ) : suggestions.length === 0 ? (
          <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border }}>
            <Text style={{ fontWeight: '700', color: THEME.ink }}>Nothing here yet</Text>
            <Text style={{ color: THEME.muted, marginTop: 4 }}>
              {activeTab === 'NEEDS_YOU'
                ? "Sage will show a suggestion here as soon as it has one for you."
                : activeTab === 'WAITING'
                  ? 'Nothing is waiting on someone else right now.'
                  : "Suggestions you've finished, dismissed, or that expired will show up here."}
            </Text>
          </View>
        ) : (
          suggestions.map((suggestion) => {
            const status = sageStatusMeta(suggestion.status);
            return (
              <TouchableOpacity
                key={suggestion.id}
                onPress={() => router.push(`/(authenticated)/sage/${suggestion.id}` as any)}
                style={{ borderRadius: 14, padding: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 8 }}
              >
                <Text style={{ fontWeight: '700', color: THEME.ink }}>{suggestion.title}</Text>
                <View style={{ alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: status.bg }}>
                  <Text style={{ color: status.fg, fontSize: 12, fontWeight: '700' }}>{status.label}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

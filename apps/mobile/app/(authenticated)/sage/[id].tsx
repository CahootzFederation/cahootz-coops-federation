import React from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { sageStatusMeta } from '@/lib/sage-status';
import { ArrowLeft } from 'lucide-react-native';

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  border: '#E5E7EB',
  muted: '#64748B',
  ink: '#111827',
  danger: '#B91C1C',
};

type Detail = Awaited<ReturnType<typeof api.getSageSuggestion>>;
type ReviewRow = Detail['reviews'][number];

function labelForReviewType(reviewType: string) {
  if (reviewType === 'PROVIDE_CONTEXT') return 'Sage needs a few details from you';
  if (reviewType === 'CONSENT_TO_SHARE') return 'Confirm what to share';
  if (reviewType === 'ACCEPT_MATCH') return 'A member could use your help';
  if (reviewType === 'APPROVE_SUGGESTION') return 'Sage has an idea';
  return 'Confirm details';
}

export default function SageSuggestionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoading, isAuthenticated, sessionToken } = useAuth();
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isResponding, setIsResponding] = React.useState(false);
  const [area, setArea] = React.useState('');
  const [timeWindow, setTimeWindow] = React.useState('');
  const [shareScope, setShareScope] = React.useState('');

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;
    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  const load = React.useCallback(() => {
    if (!sessionToken || !id) return;
    setIsLoadingDetail(true);
    setError(null);
    api
      .getSageSuggestion(id, sessionToken)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this suggestion.'))
      .finally(() => setIsLoadingDetail(false));
  }, [id, sessionToken]);

  React.useEffect(() => {
    load();
  }, [load]);

  const pendingReview: ReviewRow | undefined = detail?.reviews.find((review) => review.status === 'PENDING');

  const respond = async (response: 'APPROVE' | 'DECLINE' | 'ESCALATE') => {
    if (!sessionToken || !pendingReview || isResponding) return;
    setIsResponding(true);
    setError(null);
    try {
      const payload = pendingReview.reviewType === 'PROVIDE_CONTEXT' ? { area, timeWindow, shareScope } : undefined;
      await api.respondToSageReview(pendingReview.id, response, sessionToken, payload);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your response.');
    } finally {
      setIsResponding(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.paper }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(authenticated)/sage'))}
          style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeft size={22} color={THEME.primary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '800', color: THEME.ink }}>Sage suggestion</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {isLoadingDetail && !detail ? (
          <ActivityIndicator accessibilityLabel="Loading Sage suggestion" color={THEME.primary} />
        ) : !detail ? (
          <Text style={{ color: THEME.danger }}>{error || 'Not found.'}</Text>
        ) : (
          <>
            <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>Sage suggestion</Text>
              <Text style={{ color: THEME.ink }}>{detail.suggestion.title}</Text>
              {detail.suggestion.evidence ? (
                <Text style={{ color: THEME.muted, fontStyle: 'italic', marginTop: 6 }}>&ldquo;{detail.suggestion.evidence}&rdquo;</Text>
              ) : null}
              {(() => {
                const status = sageStatusMeta(detail.suggestion.status);
                return (
                  <View style={{ alignSelf: 'flex-start', marginTop: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: status.bg }}>
                    <Text style={{ color: status.fg, fontSize: 12, fontWeight: '700' }}>{status.label}</Text>
                  </View>
                );
              })()}
            </View>

            {detail.auditEvents.length > 0 ? (
              <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>Timeline</Text>
                {detail.auditEvents.map((event, index) => (
                  <Text key={`${event.description}-${index}`} style={{ color: THEME.muted, fontSize: 13 }}>
                    {event.description}
                  </Text>
                ))}
              </View>
            ) : null}

            {pendingReview ? (
              <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 10 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: THEME.ink }}>{labelForReviewType(pendingReview.reviewType)}</Text>
                {typeof pendingReview.presentationData?.body === 'string' ? (
                  <View style={{ gap: 4 }}>
                    {typeof pendingReview.presentationData?.title === 'string' ? (
                      <Text style={{ fontWeight: '700', color: THEME.ink }}>{pendingReview.presentationData.title as string}</Text>
                    ) : null}
                    <Text style={{ color: THEME.muted }}>{pendingReview.presentationData.body as string}</Text>
                  </View>
                ) : typeof pendingReview.presentationData?.message === 'string' ? (
                  <Text style={{ color: THEME.muted }}>{pendingReview.presentationData.message as string}</Text>
                ) : typeof pendingReview.presentationData?.summary === 'string' ? (
                  <Text style={{ color: THEME.muted }}>{pendingReview.presentationData.summary as string}</Text>
                ) : null}

                {pendingReview.reviewType === 'PROVIDE_CONTEXT' ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      accessibilityLabel="General area"
                      placeholder="General area (e.g. Downtown)"
                      value={area}
                      onChangeText={setArea}
                      style={{ borderWidth: 1, borderColor: THEME.border, borderRadius: 10, padding: 10 }}
                    />
                    <TextInput
                      accessibilityLabel="Time window"
                      placeholder="Time window (e.g. Saturday morning)"
                      value={timeWindow}
                      onChangeText={setTimeWindow}
                      style={{ borderWidth: 1, borderColor: THEME.border, borderRadius: 10, padding: 10 }}
                    />
                    <TextInput
                      accessibilityLabel="What's OK to share"
                      placeholder="What's OK to share with a match?"
                      value={shareScope}
                      onChangeText={setShareScope}
                      style={{ borderWidth: 1, borderColor: THEME.border, borderRadius: 10, padding: 10 }}
                    />
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Approve"
                    disabled={isResponding}
                    onPress={() => respond('APPROVE')}
                    style={{ flex: 1, backgroundColor: THEME.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: isResponding ? 0.6 : 1 }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Decline"
                    disabled={isResponding}
                    onPress={() => respond('DECLINE')}
                    style={{ flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: isResponding ? 0.6 : 1 }}
                  >
                    <Text style={{ color: THEME.ink, fontWeight: '700' }}>Decline</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Ask an admin"
                  disabled={isResponding}
                  onPress={() => respond('ESCALATE')}
                  style={{ alignItems: 'center', paddingVertical: 8, opacity: isResponding ? 0.6 : 1 }}
                >
                  <Text style={{ color: THEME.muted, fontSize: 13, fontWeight: '600' }}>Not sure? Ask an admin to take a look</Text>
                </TouchableOpacity>
                {error ? <Text style={{ color: THEME.danger }}>{error}</Text> : null}
              </View>
            ) : (
              <Text style={{ color: THEME.muted }}>Nothing to review on this suggestion right now.</Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

import React from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text';
import { friendlyError } from '@/lib/friendly-error';
import { SAGE_ONE_LINER } from '@/components/sage-intro';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { sageStatusMeta } from '@/lib/sage-status';
import { SageDecisionTrails } from '@/components/sage-decision-trail';
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
type SuggestionContext = NonNullable<Detail['context']>;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Where the suggestion came from, so a leader can judge it against the real conversation before acting. */
function SuggestionContextCard({ context, coopId }: { context: SuggestionContext; coopId: string }) {
  const card = { borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 8 } as const;
  return (
    <View style={card}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>Circle</Text>
      <TouchableOpacity
        accessibilityRole="link"
        accessibilityLabel={`Open circle ${context.circle.name}`}
        onPress={() => router.push({ pathname: '/[coopId]/posts', params: { coopId, circleId: context.circle.id } } as any)}
      >
        <Text style={{ color: THEME.primary, fontWeight: '700' }}>{context.circle.name}</Text>
      </TouchableOpacity>

      {context.targetPost ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted, marginTop: 6 }}>Replying to</Text>
          <TouchableOpacity
            accessibilityRole="link"
            accessibilityLabel="Open the post Sage is replying to"
            onPress={() => router.push({ pathname: '/[coopId]/posts/[postId]', params: { coopId, postId: context.targetPost!.id } } as any)}
            style={{ borderLeftWidth: 3, borderLeftColor: THEME.primary, paddingLeft: 10, gap: 2 }}
          >
            <Text style={{ fontSize: 12, color: THEME.muted }}>
              {context.targetPost.author} · {formatWhen(context.targetPost.createdAt)}
            </Text>
            <Text style={{ color: THEME.ink }}>{context.targetPost.content}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted, marginTop: 6 }}>Conversation Sage read</Text>
      {context.conversation.length ? (
        <View style={{ gap: 8 }}>
          {context.conversation.map((entry, index) => (
            <View key={`${entry.createdAt}-${index}`} style={{ gap: 1 }}>
              <Text style={{ fontSize: 12, color: THEME.muted }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.ink }}>{entry.author}</Text> · {formatWhen(entry.createdAt)}
              </Text>
              <Text style={{ color: THEME.ink }}>{entry.content}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ color: THEME.muted, fontSize: 13 }}>The conversation is no longer available.</Text>
      )}
    </View>
  );
}

function labelForReviewType(reviewType: string, capability: string | null) {
  if (reviewType === 'PROVIDE_CONTEXT') return 'Sage needs a few details from you';
  if (reviewType === 'CONSENT_TO_SHARE') return 'Confirm what to share';
  if (reviewType === 'ACCEPT_MATCH') return 'A member could use your help';
  if (reviewType === 'ACCEPT_INTRODUCTION') return 'Sage can introduce you';
  if (reviewType === 'INVITE_PERSON') return 'Someone keeps coming up';
  if (reviewType === 'APPROVE_SUGGESTION') {
    if (capability === 'comment_on_post') return 'Sage recommends commenting';
    if (capability === 'draft_proposal') return 'Sage recommends a proposal';
    return 'Sage has an idea';
  }
  return 'Confirm details';
}

// What approving actually does, stated before the member taps Approve.
function approvalConsequence(capability: string | null) {
  if (capability === 'comment_on_post') return 'Approving posts this comment as Sage on that post. It will not speak for you.';
  if (capability === 'draft_proposal') return 'Approving saves an editable draft for you. Nothing is submitted until you submit it.';
  return null;
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
  const [inviteName, setInviteName] = React.useState('');
  const [invitePhone, setInvitePhone] = React.useState('');
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);

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
      .catch((err) => setError(friendlyError(err, "We couldn't load this suggestion.")))
      .finally(() => setIsLoadingDetail(false));
  }, [id, sessionToken]);

  React.useEffect(() => {
    load();
  }, [load]);

  const pendingReview: ReviewRow | undefined = detail?.reviews.find((review) => review.status === 'PENDING');
  const isInvite = pendingReview?.reviewType === 'INVITE_PERSON';

  // Start the name field with how the family has been referring to them.
  const suggestedName = isInvite && typeof pendingReview?.presentationData?.name === 'string' ? (pendingReview.presentationData.name as string) : '';
  React.useEffect(() => {
    if (suggestedName) setInviteName((current) => current || suggestedName);
  }, [suggestedName]);

  const respond = async (response: 'APPROVE' | 'DECLINE' | 'ESCALATE') => {
    if (!sessionToken || !pendingReview || isResponding) return;
    setIsResponding(true);
    setError(null);
    try {
      if (isInvite && response === 'APPROVE' && !invitePhone.trim() && !inviteEmail.trim()) {
        setError('Add a phone number or email so the invitation can reach them.');
        return;
      }
      const payload = pendingReview.reviewType === 'PROVIDE_CONTEXT'
        ? { area, timeWindow, shareScope }
        : isInvite && response === 'APPROVE' ? { name: inviteName, phone: invitePhone, email: inviteEmail } : undefined;
      const result = await api.respondToSageReview(pendingReview.id, response, sessionToken, payload);
      if (result.invitation) {
        setNotice(result.invitation.alreadyInvited
          ? 'They already have an invitation waiting.'
          : result.invitation.sentDirectly
            ? 'Invitation sent. They decide whether to join.'
            : 'Sent to a steward. They can send the invitation with one tap.');
      }
      load();
    } catch (err) {
      setError(friendlyError(err, "We couldn't send your answer."));
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
        <Text style={{ color: THEME.muted, fontSize: 15 }}>{SAGE_ONE_LINER}</Text>
        {isLoadingDetail && !detail ? (
          <ActivityIndicator accessibilityLabel="Loading Sage suggestion" color={THEME.primary} />
        ) : !detail ? (
          <Text style={{ color: THEME.danger }}>{error || 'Not found.'}</Text>
        ) : (
          <>
            <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>Sage suggestion</Text>
              <Text style={{ color: THEME.ink }}>{detail.suggestion.title}</Text>
              {detail.suggestion.reason ? (
                <View style={{ marginTop: 6, gap: 2 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>Why Sage suggests this</Text>
                  <Text style={{ color: THEME.ink }}>{detail.suggestion.reason}</Text>
                </View>
              ) : null}
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

            {detail.context ? <SuggestionContextCard context={detail.context} coopId={detail.suggestion.coopId} /> : null}

            {!pendingReview && detail.suggestion.capability === 'comment_on_post' && detail.suggestion.proposedText ? (
              <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>
                  {detail.suggestion.status === 'PUBLISHED' || detail.suggestion.status === 'APPROVED' ? "Sage's comment" : 'Proposed comment'}
                </Text>
                <Text style={{ color: THEME.ink }}>{detail.suggestion.proposedText}</Text>
              </View>
            ) : null}

            {detail.suggestion.result?.entityType === 'CommonsProposalDraft' ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Edit proposal draft"
                onPress={() =>
                  router.push({
                    pathname: '/(authenticated)/commons-proposal-drafts',
                    params: { coopId: detail.suggestion.coopId },
                  } as any)
                }
                style={{ borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: THEME.primary }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Edit proposal draft</Text>
              </TouchableOpacity>
            ) : null}

            <SageDecisionTrails filter={{ actionId: detail.suggestion.id }} sessionToken={sessionToken} refreshKey={detail.suggestion.status} />

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
                <Text style={{ fontSize: 16, fontWeight: '700', color: THEME.ink }}>{labelForReviewType(pendingReview.reviewType, detail.suggestion.capability)}</Text>
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

                {pendingReview.reviewType === 'APPROVE_SUGGESTION' && approvalConsequence(detail.suggestion.capability) ? (
                  <Text style={{ color: THEME.muted, fontSize: 13 }}>{approvalConsequence(detail.suggestion.capability)}</Text>
                ) : null}

                {isInvite ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      accessibilityLabel="Their name"
                      placeholder="Their name"
                      value={inviteName}
                      onChangeText={setInviteName}
                      style={{ borderWidth: 1, borderColor: THEME.border, borderRadius: 10, padding: 10 }}
                    />
                    <TextInput
                      accessibilityLabel="Their phone number"
                      placeholder="Phone number"
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      value={invitePhone}
                      onChangeText={setInvitePhone}
                      style={{ borderWidth: 1, borderColor: THEME.border, borderRadius: 10, padding: 10 }}
                    />
                    <TextInput
                      accessibilityLabel="Their email"
                      placeholder="Email (optional if you added a phone)"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      value={inviteEmail}
                      onChangeText={setInviteEmail}
                      style={{ borderWidth: 1, borderColor: THEME.border, borderRadius: 10, padding: 10 }}
                    />
                    <Text style={{ color: THEME.muted, fontSize: 13 }}>
                      Sage won&apos;t contact them. Their details go only into the invitation.
                    </Text>
                  </View>
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
                    accessibilityLabel={isInvite ? 'Send invite' : 'Approve'}
                    disabled={isResponding}
                    onPress={() => respond('APPROVE')}
                    style={{ flex: 1, backgroundColor: THEME.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: isResponding ? 0.6 : 1 }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{isInvite ? 'Send invite' : 'Approve'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={isInvite ? 'Not now' : 'Decline'}
                    disabled={isResponding}
                    onPress={() => respond('DECLINE')}
                    style={{ flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: isResponding ? 0.6 : 1 }}
                  >
                    <Text style={{ color: THEME.ink, fontWeight: '700' }}>{isInvite ? 'Not now' : 'Decline'}</Text>
                  </TouchableOpacity>
                </View>
                {isInvite ? null : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Ask an admin"
                    disabled={isResponding}
                    onPress={() => respond('ESCALATE')}
                    style={{ alignItems: 'center', paddingVertical: 8, opacity: isResponding ? 0.6 : 1 }}
                  >
                    <Text style={{ color: THEME.muted, fontSize: 13, fontWeight: '600' }}>Not sure? Ask an admin to take a look</Text>
                  </TouchableOpacity>
                )}
                {error ? <Text style={{ color: THEME.danger }}>{error}</Text> : null}
              </View>
            ) : notice ? (
              <Text style={{ color: THEME.ink, fontWeight: '600' }}>{notice}</Text>
            ) : (
              <Text style={{ color: THEME.muted }}>Nothing to review on this suggestion right now.</Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

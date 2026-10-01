import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Check, Clock, Lock, Mail } from 'lucide-react-native';

import { IconAvatar } from '@/components/icon-avatar';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { markAnonymousProfileIntroSeen } from '@/lib/anonymous-id';
import { api, type CommonsInvitationDetail } from '@/lib/api';
import { secureStorage } from '@/lib/secure-storage';

const THEME = {
  paper: '#F6F7F8',
  ink: '#111827',
  muted: '#6B7280',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  border: '#E5E7EB',
  blueSoft: '#EFF6FF',
  blue: '#1D4ED8',
};

function invitationHeading(invitation: CommonsInvitationDetail) {
  const name = invitation.commons.name;
  if (invitation.purpose === 'APPLY') {
    return `${invitation.inviterName} invited you to apply to ${name}`;
  }
  if (invitation.purpose === 'REQUEST_ACCESS') {
    return `You've been sent a link to ${name}`;
  }
  return `${invitation.inviterName} invited you to join ${name}`;
}

/** Where a new member lands: the pinned welcome post, else the commons feed. */
export function openJoinedCommons(coopId: string, welcomePostId: string | null) {
  if (welcomePostId) {
    router.replace({
      pathname: '/[coopId]/posts/[postId]',
      params: { coopId, postId: welcomePostId },
    } as any);
    return;
  }
  router.replace(`/${coopId}/posts?coopId=${coopId}` as any);
}

/**
 * One invitation, opened from a link (`token`) or from the signed-in
 * member's own invitations (`invitationId`). Shows the commons, who invited
 * them and its privacy notice, and offers only what the invitation allows:
 * join (named family invitation, verified email), request access (shareable
 * link or unverified contact), or apply (normal commons).
 */
export function CommonsInvitationView({
  token,
  invitationId,
}: {
  token?: string;
  invitationId?: string;
}) {
  const { user, sessionToken, isLoading: authLoading } = useAuth();
  const [invitation, setInvitation] = useState<CommonsInvitationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [requested, setRequested] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = token
        ? await api.previewCommonsInvitation(token, sessionToken)
        : invitationId && sessionToken
          ? await api.getMyCommonsInvitation(invitationId, sessionToken)
          : null;
      if (!result) throw new Error('Sign in to see this invitation.');
      setInvitation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this invitation.');
    } finally {
      setLoading(false);
    }
  }, [token, invitationId, sessionToken]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  // Opened while signed in: nothing left to resume after sign-in.
  useEffect(() => {
    if (user && token) {
      void secureStorage.removeItem(secureStorage.keys.PENDING_INVITATION);
    }
  }, [user, token]);

  const signInToContinue = async () => {
    if (token) {
      await secureStorage.setItem(secureStorage.keys.PENDING_INVITATION, token);
    }
    // They came for this invitation, so skip the app-intro carousel before
    // signing in; the profile step still runs afterwards.
    await markAnonymousProfileIntroSeen();
    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  };

  const accept = async () => {
    if (!invitation || !sessionToken || submitting) return;
    const needsRules = invitation.purpose !== 'APPLY';
    if (needsRules && !agreed) {
      setActionError(`Agree to ${invitation.commons.name}'s rules to continue.`);
      return;
    }

    setSubmitting(true);
    setActionError('');
    try {
      const result = await api.acceptCommonsInvitation(
        {
          ...(token ? { token } : { invitationId: invitation.invitationId! }),
          acceptRules: needsRules ? agreed : false,
          note: note.trim() || undefined,
        },
        sessionToken,
      );
      if (result.outcome === 'JOINED' || result.outcome === 'ALREADY_MEMBER') {
        openJoinedCommons(result.coopId, result.welcomePostId);
      } else if (result.outcome === 'APPLY') {
        router.replace({
          pathname: '/commons/[coopId]',
          params: {
            coopId: result.coopId,
            apply: '1',
            ...(token ? { invitationToken: token } : { invitationId: result.invitationId }),
          },
        } as any);
      } else {
        setRequested(true);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as any);
  };

  const header = (
    <View className="mb-4 flex-row items-center">
      <TouchableOpacity
        onPress={goBack}
        className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
        accessibilityLabel="Go back"
      >
        <ArrowLeft size={20} color={THEME.ink} />
      </TouchableOpacity>
      <Text className="ml-3 text-xs font-black uppercase text-gray-500">Invitation</Text>
    </View>
  );

  if (loading || authLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: THEME.paper }}>
        <ActivityIndicator color={THEME.primary} />
      </SafeAreaView>
    );
  }

  if (error || !invitation) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
        <View className="px-4 pt-2">
          {header}
          <View className="rounded-2xl border border-gray-200 bg-white p-5">
            <Text className="text-lg font-black text-gray-950">This invitation can&apos;t be opened</Text>
            <Text className="mt-2 text-sm leading-5 text-gray-600">
              {error || 'Ask the person who invited you to send a new one.'}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { commons, viewer } = invitation;
  const inactive =
    invitation.status === 'EXPIRED' ||
    invitation.status === 'REVOKED' ||
    (invitation.status === 'ACCEPTED' && !viewer.isMember);
  const requestPending =
    requested || viewer.requestStatus === 'SUBMITTED' || viewer.requestStatus === 'UNDER_REVIEW';
  const canJoinDirectly =
    invitation.purpose === 'DIRECT_JOIN' && viewer.contactMatch === 'EMAIL';
  const needsReview = invitation.purpose !== 'APPLY' && !canJoinDirectly;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 }}>
        {header}

        <View className="rounded-2xl border border-gray-200 bg-white p-5">
          <IconAvatar
            emoji={commons.iconEmoji}
            color={commons.iconColor || THEME.primary}
            fallbackText={commons.name}
            size={56}
          />
          <Text className="mt-4 text-2xl font-black leading-8 text-gray-950">
            {invitationHeading(invitation)}
          </Text>
          {commons.description ? (
            <Text className="mt-2 text-base leading-6 text-gray-700">{commons.description}</Text>
          ) : null}
          {invitation.message ? (
            <View className="mt-4 rounded-xl bg-gray-50 p-3">
              <Text className="text-sm italic leading-5 text-gray-700">
                “{invitation.message}” — {invitation.inviterName}
              </Text>
            </View>
          ) : null}

          {commons.privacyNotice ? (
            <View
              className="mt-4 flex-row gap-3 rounded-xl border p-3"
              style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}
            >
              <Lock size={18} color={THEME.primary} />
              <Text className="min-w-0 flex-1 text-sm leading-5 text-gray-800">
                {commons.privacyNotice}
              </Text>
            </View>
          ) : null}

          {invitation.purpose === 'APPLY' ? (
            <Text className="mt-4 text-sm leading-5 text-gray-600">
              Everyone applies to {commons.name}, and a steward reviews each application. This
              invitation doesn&apos;t skip that.
            </Text>
          ) : null}
        </View>

        <View className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
          {inactive ? (
            <>
              <Text className="text-lg font-black text-gray-950">
                {invitation.status === 'EXPIRED'
                  ? 'This invitation has expired'
                  : invitation.status === 'REVOKED'
                    ? 'This invitation was cancelled'
                    : 'This invitation has already been used'}
              </Text>
              <Text className="mt-2 text-sm leading-5 text-gray-600">
                Ask {invitation.inviterName} to send you a new one.
              </Text>
            </>
          ) : viewer.isMember ? (
            <>
              <Text className="text-lg font-black text-gray-950">You&apos;re already in {commons.name}</Text>
              <TouchableOpacity
                onPress={() => openJoinedCommons(commons.id, null)}
                className="mt-4 items-center rounded-xl py-3"
                style={{ backgroundColor: THEME.primary }}
              >
                <Text className="font-black text-white">Open {commons.name}</Text>
              </TouchableOpacity>
            </>
          ) : !user || !sessionToken ? (
            <>
              <View className="flex-row items-center gap-2">
                <Mail size={18} color={THEME.primary} />
                <Text className="text-lg font-black text-gray-950">Sign in to continue</Text>
              </View>
              <Text className="mt-2 text-sm leading-5 text-gray-600">
                {invitation.recipientHint
                  ? `Sign in or create an account with ${invitation.recipientHint}, the address this invitation was sent to.`
                  : 'Sign in or create an account, then ask to join.'}
              </Text>
              <TouchableOpacity
                onPress={signInToContinue}
                className="mt-4 items-center rounded-xl py-3"
                style={{ backgroundColor: THEME.primary }}
              >
                <Text className="font-black text-white">Sign in or create an account</Text>
              </TouchableOpacity>
            </>
          ) : requestPending ? (
            <>
              <View className="flex-row items-center gap-2">
                <Clock size={18} color={THEME.blue} />
                <Text className="text-lg font-black text-gray-950">Request sent</Text>
              </View>
              <Text className="mt-2 text-sm leading-5 text-gray-600">
                A steward of {commons.name} will review your request. We&apos;ll let you know when they do.
              </Text>
            </>
          ) : (
            <>
              {needsReview ? (
                <View className="mb-4 rounded-xl p-3" style={{ backgroundColor: THEME.blueSoft }}>
                  <Text className="text-sm leading-5" style={{ color: THEME.blue }}>
                    {invitation.purpose === 'REQUEST_ACCESS'
                      ? `This link lets you ask to join. A steward of ${commons.name} reviews every request.`
                      : viewer.contactMatch === 'PHONE'
                        ? "This invitation was sent to your phone number, which we can't verify, so a steward will confirm it's you."
                        : `This invitation was sent to ${invitation.recipientHint ?? 'someone else'}. You're signed in with a different account, so a steward needs to confirm it's you.`}
                  </Text>
                </View>
              ) : null}

              {commons.rules && invitation.purpose !== 'APPLY' ? (
                <View className="mb-4">
                  <Text className="text-xs font-black uppercase text-gray-500">{commons.name} rules</Text>
                  <Text className="mt-2 text-sm leading-6 text-gray-700">
                    {commons.rules.replace(/^#.*\n+/, '')}
                  </Text>
                </View>
              ) : null}

              {invitation.purpose !== 'APPLY' ? (
                <TouchableOpacity
                  onPress={() => setAgreed((value) => !value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  accessibilityLabel={`I agree to ${commons.name}'s rules`}
                  className="mb-4 flex-row items-center gap-3"
                >
                  <View
                    className="h-6 w-6 items-center justify-center rounded-md border"
                    style={{
                      borderColor: agreed ? THEME.primary : THEME.border,
                      backgroundColor: agreed ? THEME.primary : '#FFFFFF',
                    }}
                  >
                    {agreed ? <Check size={16} color="#FFFFFF" /> : null}
                  </View>
                  <Text className="min-w-0 flex-1 text-sm font-semibold text-gray-800">
                    I agree to {commons.name}&apos;s rules
                  </Text>
                </TouchableOpacity>
              ) : null}

              {needsReview ? (
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Add a note so they know it's you (optional)"
                  placeholderTextColor={THEME.muted}
                  multiline
                  maxLength={500}
                  className="mb-4 min-h-20 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                  style={{ textAlignVertical: 'top' }}
                />
              ) : null}

              {actionError ? (
                <Text className="mb-3 text-sm font-semibold text-red-700">{actionError}</Text>
              ) : null}

              <TouchableOpacity
                onPress={accept}
                disabled={submitting}
                className="items-center rounded-xl py-3"
                style={{ backgroundColor: THEME.primary, opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="font-black text-white">
                    {invitation.purpose === 'APPLY'
                      ? `Apply to ${commons.name}`
                      : canJoinDirectly
                        ? `Join ${commons.name}`
                        : 'Request access'}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

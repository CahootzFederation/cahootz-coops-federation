import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { ArrowLeft, Link2, Lock, Send, Shield } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsInvitationOverview } from '@/lib/api';

const THEME = {
  paper: '#F6F7F8',
  ink: '#111827',
  muted: '#6B7280',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  border: '#E5E7EB',
  green: '#047857',
  greenSoft: '#ECFDF5',
  red: '#B91C1C',
};

function personLabel(person: { name: string | null; handle: string | null }) {
  return person.name || (person.handle ? `@${person.handle}` : 'Member');
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-5">
      <Text className="mb-2 text-xs font-black uppercase tracking-wide text-gray-500">{title}</Text>
      <View className="gap-2">{children}</View>
    </View>
  );
}

function SmallButton({
  label,
  onPress,
  tone = 'neutral',
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'neutral' | 'danger';
  disabled?: boolean;
}) {
  const colors =
    tone === 'primary'
      ? { bg: THEME.primary, fg: '#FFFFFF', border: THEME.primary }
      : tone === 'danger'
        ? { bg: '#FFFFFF', fg: THEME.red, border: '#FECACA' }
        : { bg: '#FFFFFF', fg: THEME.ink, border: THEME.border };
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className="rounded-lg border px-3 py-2"
      style={{ backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }}
    >
      <Text className="text-sm font-black" style={{ color: colors.fg }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Invite people to a commons and, for stewards, everything that follows:
 * approve members' recommendations, review access requests, manage the
 * shareable request link, and manage members and stewards.
 *
 * What an invitation means depends on the commons: in an invite-only family
 * a steward's invitation lets that person join; in a normal commons every
 * invitation is only an invitation to apply.
 */
export default function CommonsInvitesScreen() {
  const { coopId } = useLocalSearchParams<{ coopId?: string }>();
  const { sessionToken } = useAuth();
  const [overview, setOverview] = useState<CommonsInvitationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [contactType, setContactType] = useState<'EMAIL' | 'PHONE'>('EMAIL');
  const [contact, setContact] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [formNotice, setFormNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!coopId || !sessionToken) return;
    try {
      setOverview(await api.getCommonsInvitationOverview(coopId, sessionToken));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invitations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coopId, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  const sendInvitation = async () => {
    if (!coopId || !sessionToken || sending) return;
    const value = contact.trim();
    if (!value) {
      setFormError(contactType === 'EMAIL' ? 'Add their email address.' : 'Add their phone number.');
      return;
    }
    setSending(true);
    setFormError('');
    setFormNotice('');
    try {
      const result = await api.inviteToCommons(
        {
          coopId,
          ...(contactType === 'EMAIL' ? { email: value } : { phone: value }),
          recipientName: recipientName.trim() || undefined,
          message: message.trim() || undefined,
        },
        sessionToken,
      );
      setFormNotice(
        result.alreadyInvited
          ? 'They already have a pending invitation.'
          : result.status === 'PENDING_APPROVAL'
            ? 'Recommendation sent. A steward will review it before the invitation goes out.'
            : 'Invitation sent.',
      );
      setContact('');
      setRecipientName('');
      setMessage('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not send the invitation.');
    } finally {
      setSending(false);
    }
  };

  const createShareLink = () =>
    run('share-link', async () => {
      const result = await api.createCommonsShareLink(coopId!, sessionToken!);
      setShareLink(Linking.createURL(`invite/${result.token}`));
      setCopied(false);
    });

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/commons/${coopId}` as any);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: THEME.paper }}>
        <ActivityIndicator color={THEME.primary} />
      </SafeAreaView>
    );
  }

  if (!overview) {
    return (
      <SafeAreaView className="flex-1 px-4 pt-2" style={{ backgroundColor: THEME.paper }}>
        <TouchableOpacity onPress={goBack} accessibilityLabel="Go back" className="mb-4 h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white">
          <ArrowLeft size={20} color={THEME.ink} />
        </TouchableOpacity>
        <Text className="text-base font-semibold text-gray-700">{error || 'Only members can invite people here.'}</Text>
      </SafeAreaView>
    );
  }

  const { commons, isSteward } = overview;
  const isFamily = commons.joinPolicy === 'INVITE_ONLY';
  const awaitingApproval = overview.invitations.filter((item) => item.status === 'PENDING_APPROVAL');
  const pending = overview.invitations.filter((item) => item.status === 'PENDING');
  const accepted = overview.invitations.filter((item) => item.status === 'ACCEPTED');
  const sendLabel = !isFamily ? 'Invite to apply' : isSteward ? 'Send invitation' : 'Recommend';

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        <View className="mb-4 flex-row items-center">
          <TouchableOpacity
            onPress={goBack}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={THEME.ink} />
          </TouchableOpacity>
          <View className="ml-3 min-w-0 flex-1">
            <Text className="text-xs font-black uppercase text-gray-500">
              {isSteward ? 'Steward tools' : 'Invite'}
            </Text>
            <Text className="text-2xl font-black text-gray-950" numberOfLines={1}>
              {commons.name}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push(`/${commons.id}/posts?coopId=${commons.id}` as any)}
            className="rounded-full border border-gray-200 bg-white px-4 py-2"
          >
            <Text className="text-sm font-bold text-gray-800">Open</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View className="mb-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
            <Text className="text-sm font-semibold text-orange-800">{error}</Text>
          </View>
        ) : null}

        <View className="rounded-2xl border border-gray-200 bg-white p-4">
          <Text className="text-lg font-black text-gray-950">
            {isFamily ? (isSteward ? 'Invite family' : 'Recommend someone') : 'Invite someone to apply'}
          </Text>
          <Text className="mt-1 text-sm leading-5 text-gray-600">
            {!isFamily
              ? `Everyone applies to ${commons.name}. Your invitation is a recommendation; a steward still reviews their application.`
              : isSteward
                ? "They join as soon as they sign in with this email and accept. Phone invitations are confirmed by a steward, since phone numbers aren't verified."
                : 'A steward reviews your recommendation before the invitation is sent.'}
          </Text>

          <View className="mt-3 flex-row rounded-xl border border-gray-200 p-1">
            {(['EMAIL', 'PHONE'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                onPress={() => setContactType(type)}
                className="flex-1 items-center rounded-lg py-2"
                style={{ backgroundColor: contactType === type ? THEME.primary : 'transparent' }}
                accessibilityState={{ selected: contactType === type }}
              >
                <Text className="text-sm font-black" style={{ color: contactType === type ? '#FFFFFF' : THEME.muted }}>
                  {type === 'EMAIL' ? 'Email' : 'Phone'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            value={recipientName}
            onChangeText={setRecipientName}
            placeholder="Their name (optional)"
            placeholderTextColor={THEME.muted}
            maxLength={80}
            accessibilityLabel="Their name"
            className="mt-3 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
          />
          <TextInput
            value={contact}
            onChangeText={setContact}
            placeholder={contactType === 'EMAIL' ? 'name@email.com' : '(555) 555-5555'}
            placeholderTextColor={THEME.muted}
            keyboardType={contactType === 'EMAIL' ? 'email-address' : 'phone-pad'}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={contactType === 'EMAIL' ? 'Their email' : 'Their phone number'}
            className="mt-2 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
          />
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Add a personal note (optional)"
            placeholderTextColor={THEME.muted}
            maxLength={500}
            multiline
            accessibilityLabel="Personal note"
            className="mt-2 min-h-16 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
            style={{ textAlignVertical: 'top' }}
          />
          {formError ? <Text className="mt-3 text-sm font-semibold text-red-700">{formError}</Text> : null}
          {formNotice ? (
            <Text className="mt-3 text-sm font-semibold" style={{ color: THEME.green }}>
              {formNotice}
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={sendInvitation}
            disabled={sending}
            className="mt-3 flex-row items-center justify-center gap-2 rounded-xl py-3"
            style={{ backgroundColor: THEME.primary, opacity: sending ? 0.6 : 1 }}
          >
            {sending ? <ActivityIndicator color="#FFFFFF" /> : <Send size={16} color="#FFFFFF" />}
            <Text className="font-black text-white">{sendLabel}</Text>
          </TouchableOpacity>
        </View>

        {isSteward && overview.requests.length > 0 ? (
          <Section title="Requests to join">
            {overview.requests.map((request) => (
              <View key={request.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <Text className="text-base font-black text-gray-950">{personLabel(request.applicant)}</Text>
                <Text className="text-sm text-gray-600">
                  {request.applicant.handle ? `@${request.applicant.handle} · ` : ''}
                  {request.applicant.email}
                </Text>
                <Text className="mt-2 text-sm leading-5 text-gray-700">
                  {request.reason === 'SHARE_LINK'
                    ? 'Asked to join from your shareable link.'
                    : request.reason === 'UNVERIFIED_PHONE'
                      ? `Invited by phone${request.invitedByName ? ` by ${request.invitedByName}` : ''}${request.invitedAs ? ` as "${request.invitedAs}"` : ''}. Confirm it's them.`
                      : `Opened an invitation${request.invitedByName ? ` from ${request.invitedByName}` : ''} sent to a different contact. Confirm it's them.`}
                </Text>
                {request.note ? (
                  <Text className="mt-2 text-sm italic text-gray-700">“{request.note}”</Text>
                ) : null}
                <View className="mt-3 flex-row gap-2">
                  <SmallButton
                    label="Approve"
                    tone="primary"
                    disabled={busyId === request.id}
                    onPress={() =>
                      run(request.id, () =>
                        api.reviewCommonsRequest({ applicationId: request.id, decision: 'APPROVE' }, sessionToken!),
                      )
                    }
                  />
                  <SmallButton
                    label="Decline"
                    tone="danger"
                    disabled={busyId === request.id}
                    onPress={() =>
                      run(request.id, () =>
                        api.reviewCommonsRequest({ applicationId: request.id, decision: 'DECLINE' }, sessionToken!),
                      )
                    }
                  />
                </View>
              </View>
            ))}
          </Section>
        ) : null}

        {awaitingApproval.length > 0 ? (
          <Section title={isSteward ? 'Recommendations to review' : 'Waiting for a steward'}>
            {awaitingApproval.map((item) => (
              <View key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <Text className="text-base font-black text-gray-950">{item.recipientName || item.contact}</Text>
                <Text className="text-sm text-gray-600">
                  {item.recipientName ? `${item.contact} · ` : ''}Recommended by {item.isMine ? 'you' : item.inviterName}
                </Text>
                <View className="mt-3 flex-row gap-2">
                  {isSteward ? (
                    <SmallButton
                      label="Approve and send"
                      tone="primary"
                      disabled={busyId === item.id}
                      onPress={() => run(item.id, () => api.approveCommonsRecommendation(item.id, sessionToken!))}
                    />
                  ) : null}
                  <SmallButton
                    label={isSteward && !item.isMine ? 'Decline' : 'Cancel'}
                    tone="danger"
                    disabled={busyId === item.id}
                    onPress={() => run(item.id, () => api.revokeCommonsInvitation(item.id, sessionToken!))}
                  />
                </View>
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="Pending invitations">
          {pending.length === 0 ? (
            <Text className="text-sm text-gray-500">No pending invitations.</Text>
          ) : (
            pending.map((item) => (
              <View key={item.id} className="flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-black text-gray-950" numberOfLines={1}>
                    {item.recipientName || item.contact}
                  </Text>
                  <Text className="text-sm text-gray-600" numberOfLines={1}>
                    {item.recipientName ? `${item.contact} · ` : ''}
                    {item.purpose === 'APPLY' ? 'Invited to apply' : 'Invited'} by {item.isMine ? 'you' : item.inviterName}
                  </Text>
                </View>
                {isSteward || item.isMine ? (
                  <SmallButton
                    label="Cancel"
                    tone="danger"
                    disabled={busyId === item.id}
                    onPress={() => run(item.id, () => api.revokeCommonsInvitation(item.id, sessionToken!))}
                  />
                ) : null}
              </View>
            ))
          )}
        </Section>

        {accepted.length > 0 ? (
          <Section title="Recently accepted">
            {accepted.map((item) => (
              <View key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <Text className="text-base font-black text-gray-950">{item.acceptedByName || item.recipientName || item.contact}</Text>
                <Text className="text-sm" style={{ color: THEME.green }}>
                  {item.purpose === 'APPLY' ? 'Applied' : 'Joined'}
                </Text>
              </View>
            ))}
          </Section>
        ) : null}

        {isSteward && isFamily ? (
          <Section title="Shareable link">
            <View className="rounded-2xl border border-gray-200 bg-white p-4">
              <View className="flex-row gap-2">
                <Link2 size={18} color={THEME.primary} />
                <Text className="min-w-0 flex-1 text-sm leading-5 text-gray-700">
                  Anyone with this link can ask to join, but no one gets in until a steward approves
                  their request. Links expire after 14 days.
                </Text>
              </View>
              {shareLink ? (
                <View className="mt-3 rounded-xl bg-gray-50 p-3">
                  <Text selectable className="text-xs text-gray-800" accessibilityLabel="Shareable link">
                    {shareLink}
                  </Text>
                  <View className="mt-2 flex-row gap-2">
                    <SmallButton
                      label={copied ? 'Copied' : 'Copy link'}
                      onPress={async () => {
                        await Clipboard.setStringAsync(shareLink);
                        setCopied(true);
                      }}
                    />
                    <SmallButton
                      label="Share"
                      onPress={() =>
                        void Share.share({
                          message: `Ask to join ${commons.name} on Cahootz: ${shareLink}`,
                        }).catch(() => undefined)
                      }
                    />
                  </View>
                  <Text className="mt-2 text-xs text-gray-500">
                    Save it now: for security, the full link is only shown once.
                  </Text>
                </View>
              ) : null}
              <View className="mt-3 flex-row">
                <SmallButton
                  label="Create a shareable link"
                  tone="primary"
                  disabled={busyId === 'share-link'}
                  onPress={createShareLink}
                />
              </View>
              {overview.shareLinks.map((link) => (
                <View key={link.id} className="mt-3 flex-row items-center justify-between border-t border-gray-100 pt-3">
                  <Text className="min-w-0 flex-1 text-sm text-gray-600">
                    Link by {link.createdByName} · expires {new Date(link.expiresAt).toLocaleDateString()}
                  </Text>
                  <SmallButton
                    label="Turn off"
                    tone="danger"
                    disabled={busyId === link.id}
                    onPress={() => run(link.id, () => api.revokeCommonsInvitation(link.id, sessionToken!))}
                  />
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {isSteward && overview.members.length > 0 ? (
          <Section title="Members">
            {overview.members.map((member) => (
              <View key={member.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <View className="flex-row items-center gap-2">
                  <Text className="min-w-0 flex-1 text-base font-black text-gray-950" numberOfLines={1}>
                    {personLabel(member)}
                    {member.isYou ? ' (you)' : ''}
                  </Text>
                  {member.isSteward ? (
                    <View className="flex-row items-center gap-1 rounded-full px-2 py-1" style={{ backgroundColor: THEME.greenSoft }}>
                      <Shield size={11} color={THEME.green} />
                      <Text className="text-xs font-black" style={{ color: THEME.green }}>Steward</Text>
                    </View>
                  ) : null}
                </View>
                {member.isYou ? null : (
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    <SmallButton
                      label={member.isSteward ? 'Remove as steward' : 'Make steward'}
                      disabled={busyId === member.id}
                      onPress={() =>
                        run(member.id, () =>
                          api.setCommonsSteward(commons.id, member.id, !member.isSteward, sessionToken!),
                        )
                      }
                    />
                    {confirmRemoveId === member.id ? (
                      <SmallButton
                        label={`Confirm remove ${personLabel(member)}`}
                        tone="danger"
                        disabled={busyId === member.id}
                        onPress={() =>
                          run(member.id, async () => {
                            await api.removeCommonsMember(commons.id, member.id, sessionToken!);
                            setConfirmRemoveId(null);
                          })
                        }
                      />
                    ) : (
                      <SmallButton label="Remove" tone="danger" onPress={() => setConfirmRemoveId(member.id)} />
                    )}
                  </View>
                )}
              </View>
            ))}
          </Section>
        ) : null}

        {isFamily ? (
          <View className="mt-5 flex-row gap-2 rounded-2xl border p-4" style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}>
            <Lock size={16} color={THEME.primary} />
            <Text className="min-w-0 flex-1 text-xs leading-4 text-gray-700">
              {commons.name} is private and never listed in Explore. Removing someone ends their
              access right away.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

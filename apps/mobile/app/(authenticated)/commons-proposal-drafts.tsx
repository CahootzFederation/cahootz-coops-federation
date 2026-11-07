import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Save, Send } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { LoadError } from '@/components/load-error';
import { api, type CommonsProposalDraft } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { proposalHubHref } from '@/lib/proposal-navigation';
import { keyboardInsetScrollProps } from '@/lib/keyboard';

const PRIMARY = '#FF6B00';

export default function CommonsProposalDrafts() {
  const { coopId = 'cahootz', coopName, draftId: focusDraftId } = useLocalSearchParams<{ coopId?: string; coopName?: string; draftId?: string }>();
  const { sessionToken, user } = useAuth();
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, { title: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['commons-proposal-drafts', sessionToken],
    queryFn: () => api.getCommonsProposalDrafts(sessionToken!),
    enabled: !!sessionToken,
  });
  // The draft someone just took on goes first.
  const drafts = useMemo(() => (query.data || []).filter((draft) => draft.coopId === coopId)
    .sort((a, b) => Number(b.id === focusDraftId) - Number(a.id === focusDraftId)), [coopId, focusDraftId, query.data]);
  const commonsLabel = coopName || 'this commons';

  async function save(id: string, title: string, body: string) {
    if (!sessionToken) return;
    setBusy(id); setMessage('');
    try {
      await api.saveCommonsProposalDraft(id, title, body, sessionToken);
      await client.invalidateQueries({ queryKey: ['commons-proposal-drafts', sessionToken] });
      setMessage('Draft saved.');
    } catch (error) {
      console.error('Failed to save proposal draft:', error);
      setMessage(friendlyError(error, "We couldn't save your draft."));
    } finally { setBusy(null); }
  }

  async function submit(draft: CommonsProposalDraft, title: string, body: string) {
    const id = draft.id;
    if (!user?.walletAddress || !sessionToken) { setMessage('Connect a wallet before you send a proposal.'); return; }
    setBusy(id); setMessage('');
    try {
      await api.saveCommonsProposalDraft(id, title, body, sessionToken);
      const proposal = await api.createProposal(`Proposal Title: ${title}\n\n${body}${changeText(draft)}`, user.walletAddress, coopId, id);
      if (!proposal?.id) throw new Error('Proposal was created, but its receipt was unavailable. Check your proposals before trying again.');
      await api.markCommonsProposalDraftSubmitted(id, proposal.id, sessionToken);
      await client.invalidateQueries({ queryKey: ['commons-proposal-drafts', sessionToken] });
      router.replace({ pathname: '/(tabs)/proposal-detail', params: { id: proposal.id, coopId } } as any);
    } catch (error) {
      console.error('Failed to submit proposal draft:', error);
      setMessage(friendlyError(error, "We couldn't send your proposal. Try again."));
    } finally { setBusy(null); }
  }

  return (
    <ScrollView {...keyboardInsetScrollProps} className="flex-1 bg-stone-50" contentContainerStyle={{ padding: 20, paddingTop: 56, paddingBottom: 40 }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Back to ${commonsLabel} proposals and votes`} onPress={() => router.replace(proposalHubHref(coopId) as any)} className="mb-6 h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white">
        <ArrowLeft size={19} color="#1F2937" />
      </TouchableOpacity>
      <View className="mb-6">
        <Text className="text-xs font-black uppercase tracking-wider text-orange-600">{commonsLabel}</Text>
        <Text className="mt-1 text-3xl font-black text-gray-950">Proposal drafts</Text>
        <Text className="mt-2 text-base leading-6 text-gray-600">Ideas you took on from Sage, and drafts saved from discussions. Nothing goes to a vote until you send it.</Text>
      </View>
      {message ? <View accessibilityRole="alert" className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4"><Text className="font-semibold text-orange-900">{message}</Text></View> : null}
      {query.isLoading ? (
        <View className="items-center py-16"><ActivityIndicator color={PRIMARY} /><Text className="mt-3 font-semibold text-gray-500">Loading drafts…</Text></View>
      ) : query.isError && drafts.length === 0 ? (
        <LoadError
          message={friendlyError(query.error, "We couldn't load your drafts.")}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : drafts.length === 0 ? (
        <View className="rounded-[28px] border border-dashed border-stone-300 bg-white p-6">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-orange-50"><FileText size={25} color={PRIMARY} /></View>
          <Text className="text-xl font-black text-gray-950">No drafts in this commons</Text>
          <Text className="mt-2 text-base leading-6 text-gray-600">Drafts from {commonsLabel} conversations, and Sage ideas you take on, will be waiting here.</Text>
        </View>
      ) : (
        <View className="gap-4">
          {drafts.map((draft) => {
            const edit = edits[draft.id] ?? { title: draft.title, body: draft.body };
            const disabled = busy === draft.id;
            return <View key={draft.id} className="rounded-3xl border border-stone-200 bg-white p-4">
              <Text className="mb-2 text-xs font-black uppercase tracking-wide text-stone-500">{KIND_LABEL[draft.kind] ?? 'Working draft'}</Text>
              <TextInput accessibilityLabel="Proposal title" value={edit.title} onChangeText={(title) => setEdits((current) => ({ ...current, [draft.id]: { ...edit, title } }))} className="rounded-xl border border-stone-300 px-3 py-3 text-base font-bold text-gray-950" />
              <TextInput accessibilityLabel="Proposal body" multiline value={edit.body} onChangeText={(body) => setEdits((current) => ({ ...current, [draft.id]: { ...edit, body } }))} className="mt-3 min-h-44 rounded-xl border border-stone-300 px-3 py-3 text-base leading-6 text-gray-900" style={{ textAlignVertical: 'top' }} />
              <ProposedChange draft={draft} />
              <View className="mt-4 flex-row gap-3">
                <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={() => void save(draft.id, edit.title, edit.body)} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-stone-100 py-3"><Save size={16} color="#44403C" /><Text className="font-black text-stone-700">Save</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={() => void submit(draft, edit.title, edit.body)} className="flex-1 flex-row items-center justify-center gap-2 rounded-xl py-3" style={{ backgroundColor: PRIMARY, opacity: disabled ? 0.6 : 1 }}><Send size={16} color="#FFFFFF" /><Text className="font-black text-white">Send to a vote</Text></TouchableOpacity>
              </View>
            </View>;
          })}
        </View>
      )}
    </ScrollView>
  );
}

const KIND_LABEL: Record<string, string> = {
  PROGRAM: "Sage's idea · program",
  SPENDING: "Sage's idea · spending",
  CHARTER_AMENDMENT: "Sage's idea · charter change",
  GOALS_AMENDMENT: "Sage's idea · goals change",
};

/** The exact change voters are deciding on, added to the proposal text so it can't get lost. */
function changeText(draft: CommonsProposalDraft): string {
  const change = draft.proposedChanges;
  if (draft.kind === 'CHARTER_AMENDMENT' && change?.find && change.replace) {
    return `\n\nCharter change members are voting on:\nReplace: "${change.find}"\nWith: "${change.replace}"`;
  }
  if (draft.kind === 'GOALS_AMENDMENT' && change?.missionGoals?.length) {
    const goals = change.missionGoals.map((goal) => `- ${goal.label} (${Math.round(goal.priorityWeight * 100)}%)`).join('\n');
    return `\n\nNew goals members are voting on:\n${goals}`;
  }
  return '';
}

/** Charter and goals changes are fixed: the member edits the reasons, not the change itself. */
function ProposedChange({ draft }: { draft: CommonsProposalDraft }) {
  const change = draft.proposedChanges;
  if (draft.kind === 'CHARTER_AMENDMENT' && change?.find && change.replace) {
    return (
      <View className="mt-3 rounded-xl bg-stone-100 p-3" accessibilityLabel="Charter change">
        <Text className="text-xs font-black uppercase tracking-wide text-stone-500">The change members vote on</Text>
        <Text className="mt-2 text-sm font-bold text-stone-500">Now</Text>
        <Text className="text-sm leading-5 text-gray-800">{change.find}</Text>
        <Text className="mt-2 text-sm font-bold text-stone-500">Would become</Text>
        <Text className="text-sm leading-5 text-gray-950">{change.replace}</Text>
        <Text className="mt-2 text-xs text-stone-500">If members vote yes, a steward applies it to the charter.</Text>
      </View>
    );
  }
  if (draft.kind === 'GOALS_AMENDMENT' && change?.missionGoals?.length) {
    return (
      <View className="mt-3 rounded-xl bg-stone-100 p-3" accessibilityLabel="Goals change">
        <Text className="text-xs font-black uppercase tracking-wide text-stone-500">The new goals members vote on</Text>
        {change.missionGoals.map((goal) => (
          <Text key={goal.label} className="mt-1 text-sm text-gray-900">{goal.label} · {Math.round(goal.priorityWeight * 100)}%</Text>
        ))}
        <Text className="mt-2 text-xs text-stone-500">If members vote yes, a steward applies it to our goals.</Text>
      </View>
    );
  }
  if (draft.kind === 'SPENDING' && draft.budgetAmount) {
    return <Text className="mt-3 text-sm font-semibold text-stone-600">Cost a member already gave: ${draft.budgetAmount.toLocaleString()}</Text>;
  }
  return null;
}

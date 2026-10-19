import React, { useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HandHeart } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

const PRIMARY = '#FF6B00';

/**
 * Shown under one of Sage's proposal posts. Usually Sage already put the proposal up for a vote, so this
 * opens it. When the review sent it back, it's an open idea: the first member to tap "Take this on" owns
 * it, edits it in their drafts, and decides whether to send it to a vote.
 */
export function ProposalIdeaCard({ postId, coopId, sessionToken, canAct }: { postId: string; coopId: string; sessionToken: string | null; canAct: boolean }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['proposal-idea', postId, sessionToken],
    queryFn: () => api.getProposalIdeaForPost(postId, sessionToken!),
    enabled: !!sessionToken,
  });
  const idea = query.data;
  if (!sessionToken || query.isLoading || !idea) return null;

  const openDrafts = (draftId: string) => router.push({ pathname: '/(authenticated)/commons-proposal-drafts', params: { coopId, draftId } } as any);

  async function takeOn() {
    setBusy(true); setMessage('');
    try {
      const result = await api.claimProposalIdea(postId, sessionToken!);
      await client.invalidateQueries({ queryKey: ['proposal-idea', postId] });
      await client.invalidateQueries({ queryKey: ['commons-proposal-drafts'] });
      openDrafts(result.draftId);
    } catch (error) {
      setMessage(friendlyError(error, "We couldn't give you this idea. Try again."));
      await query.refetch();
    } finally { setBusy(false); }
  }

  return (
    <View className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4" accessibilityLabel="Proposal idea from Sage">
      <View className="flex-row items-center gap-2">
        <HandHeart size={18} color={PRIMARY} />
        <Text className="text-base font-black text-gray-950">
          {idea.submittedProposalId && !idea.takenBy ? 'Up for a vote' : idea.takenByMe ? "You're taking this on" : idea.takenBy ? `${idea.takenBy} is taking this on` : 'Up for grabs'}
        </Text>
      </View>
      <Text className="mt-1 text-sm leading-5 text-gray-700">
        {idea.submittedProposalId && !idea.takenBy
          ? 'Sage wrote this proposal and put it up for a vote. Read it, comment, and vote. It only happens if members say yes.'
          : idea.submittedProposalId
            ? 'It went to a vote. Open it to see where it stands.'
          : idea.takenByMe
            ? 'It\'s in your drafts. Change anything you like, then send it to a vote when it\'s ready.'
            : idea.takenBy
              ? 'They can change it and send it to a vote. Share your thoughts in the comments.'
              : 'Anyone can take this on. You\'ll get the draft to change however you like, and nothing goes to a vote until you send it.'}
      </Text>
      {message ? <Text accessibilityRole="alert" className="mt-2 text-sm font-semibold text-red-700">{message}</Text> : null}
      {idea.submittedProposalId ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: '/(authenticated)/proposal-detail', params: { id: idea.submittedProposalId!, coopId } } as any)} className="mt-3 self-start rounded-full px-4 py-2" style={{ backgroundColor: PRIMARY }}>
          <Text className="font-black text-white">Read and vote</Text>
        </TouchableOpacity>
      ) : idea.takenByMe ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => openDrafts(idea.draftId)} className="mt-3 self-start rounded-full px-4 py-2" style={{ backgroundColor: PRIMARY }}>
          <Text className="font-black text-white">Open my draft</Text>
        </TouchableOpacity>
      ) : !idea.takenBy && canAct ? (
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void takeOn()} className="mt-3 flex-row items-center gap-2 self-start rounded-full px-4 py-2" style={{ backgroundColor: PRIMARY, opacity: busy ? 0.6 : 1 }}>
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text className="font-black text-white">Take this on</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

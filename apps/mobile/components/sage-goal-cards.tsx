import React, { useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, ScrollText } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api, type GoalSignals, type VotedAmendment } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

const PRIMARY = '#FF6B00';

/**
 * What Sage counts to see how we're doing on each goal. Members see it; a steward can change a goal's
 * picks (up to three) from the fixed list. A goal with nothing picked is one Sage can't count honestly.
 */
export function GoalSignalsCard({ coopId, sessionToken }: { coopId: string; sessionToken: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['goal-signals', coopId, sessionToken],
    queryFn: () => api.getGoalSignals(coopId, sessionToken),
  });
  const data: GoalSignals | undefined = query.data;
  if (!data) return null;

  async function save(goalKey: string) {
    setBusy(true); setMessage('');
    try {
      await api.setGoalSignals(coopId, goalKey, picked, sessionToken);
      await client.invalidateQueries({ queryKey: ['goal-signals', coopId] });
      setEditing(null);
      setMessage('Saved. Sage will use this at its next goal check.');
    } catch (error) {
      setMessage(friendlyError(error, "We couldn't save that. Try again."));
    } finally { setBusy(false); }
  }

  return (
    <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4" accessibilityLabel="What Sage counts for our goals">
      <View className="flex-row items-center gap-2">
        <Gauge size={19} color={PRIMARY} />
        <Text className="text-lg font-black text-gray-950">What Sage counts</Text>
      </View>
      <Text className="mt-1 text-sm leading-5 text-gray-600">
        Twice a week Sage checks each goal against how things usually go here. If one falls behind or hasn't started, Sage may write a proposal and put it up for a vote.
      </Text>
      {!data.goals ? (
        <Text className="mt-3 text-sm text-gray-600">Sage hasn't matched our goals yet. It will at its next check.</Text>
      ) : (
        <View className="mt-3 gap-3">
          {data.goals.map((goal) => (
            <View key={goal.key}>
              <Text className="font-bold text-gray-900">{goal.label}</Text>
              {editing === goal.key ? (
                <View className="mt-2">
                  <View className="flex-row flex-wrap gap-2">
                    {data.catalog.map((signal) => {
                      const on = picked.includes(signal.key);
                      return (
                        <TouchableOpacity
                          key={signal.key}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          aria-checked={on}
                          accessibilityLabel={`${signal.label}: ${signal.measures}`}
                          onPress={() => setPicked((current) => on ? current.filter((key) => key !== signal.key) : current.length >= 3 ? current : [...current, signal.key])}
                          className="rounded-full border px-3 py-1.5"
                          style={{ borderColor: on ? PRIMARY : '#D6D3D1', backgroundColor: on ? '#FFF7ED' : '#FFFFFF' }}
                        >
                          <Text className="text-xs font-bold" style={{ color: on ? PRIMARY : '#44403C' }}>{signal.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text className="mt-2 text-xs text-gray-500">Pick up to 3. Pick none if nothing here really shows this goal.</Text>
                  <View className="mt-2 flex-row gap-2">
                    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void save(goal.key)} className="rounded-full px-4 py-2" style={{ backgroundColor: PRIMARY, opacity: busy ? 0.6 : 1 }}>
                      <Text className="text-xs font-black text-white">Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" onPress={() => setEditing(null)} className="rounded-full bg-stone-100 px-4 py-2">
                      <Text className="text-xs font-black text-stone-700">Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View className="mt-1 flex-row flex-wrap items-center gap-2">
                  <Text className="text-sm text-gray-700">
                    {goal.signals.length ? goal.signals.map((signal) => signal.label).join(' · ') : "Nothing Sage can count honestly yet"}
                    {goal.chosenBy === 'steward' ? ' (picked by a steward)' : ''}
                  </Text>
                  {data.canEdit ? (
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Change what Sage counts for ${goal.label}`} onPress={() => { setEditing(goal.key); setPicked(goal.signals.map((signal) => signal.key)); setMessage(''); }}>
                      <Text className="text-xs font-black" style={{ color: PRIMARY }}>Change</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>
          ))}
        </View>
      )}
      {message ? <Text accessibilityRole="alert" className="mt-3 text-sm font-semibold text-gray-700">{message}</Text> : null}
    </View>
  );
}

function amendmentText(amendment: VotedAmendment): { before: string; after: string } {
  const goals = (value: unknown) => Array.isArray(value)
    ? value.map((goal) => (goal as { label?: string }).label).filter(Boolean).join(', ')
    : '';
  return amendment.section === 'charterText'
    ? { before: String(amendment.before ?? ''), after: String(amendment.after ?? '') }
    : { before: goals(amendment.before), after: goals(amendment.after) };
}

/** Steward-only: charter and goals changes members voted yes on, ready to apply with one tap. */
export function VotedAmendmentsCard({ coopId, sessionToken }: { coopId: string; sessionToken: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['voted-amendments', coopId, sessionToken],
    queryFn: () => api.getPendingVotedAmendments(coopId, sessionToken),
  });
  const amendments = query.data ?? [];
  if (!amendments.length && !message) return null;

  async function apply(id: string) {
    setBusy(id); setMessage('');
    try {
      await api.applyVotedAmendment(coopId, id, sessionToken);
      await client.invalidateQueries({ queryKey: ['voted-amendments', coopId] });
      await client.invalidateQueries({ queryKey: ['goal-signals', coopId] });
      setMessage("Done. It's live in our charter now.");
    } catch (error) {
      setMessage(friendlyError(error, "We couldn't apply that change. Try again."));
    } finally { setBusy(null); }
  }

  return (
    <View className="mb-3 rounded-2xl border border-orange-200 bg-orange-50 p-4" accessibilityLabel="Changes members passed">
      <View className="flex-row items-center gap-2">
        <ScrollText size={19} color={PRIMARY} />
        <Text className="text-lg font-black text-gray-950">Changes members passed</Text>
      </View>
      <Text className="mt-1 text-sm leading-5 text-gray-700">Members voted yes on these. As a steward, you apply them.</Text>
      {amendments.map((amendment) => {
        const text = amendmentText(amendment);
        return (
          <View key={amendment.id} className="mt-3 rounded-xl bg-white p-3">
            <Text className="font-bold text-gray-950">{amendment.reason}</Text>
            <Text className="mt-2 text-xs font-black uppercase text-stone-500">{amendment.section === 'charterText' ? 'Charter now' : 'Goals now'}</Text>
            <Text className="text-sm leading-5 text-gray-700" numberOfLines={6}>{text.before || 'Nothing yet'}</Text>
            <Text className="mt-2 text-xs font-black uppercase text-stone-500">After</Text>
            <Text className="text-sm leading-5 text-gray-950" numberOfLines={8}>{text.after}</Text>
            <View className="mt-3 flex-row gap-2">
              <TouchableOpacity accessibilityRole="button" disabled={busy === amendment.id} onPress={() => void apply(amendment.id)} className="flex-row items-center gap-2 rounded-full px-4 py-2" style={{ backgroundColor: PRIMARY, opacity: busy === amendment.id ? 0.6 : 1 }}>
                {busy === amendment.id ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                <Text className="text-xs font-black text-white">Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: '/(authenticated)/proposal-detail', params: { id: amendment.proposalId, coopId } } as any)} className="rounded-full bg-stone-100 px-4 py-2">
                <Text className="text-xs font-black text-stone-700">See the vote</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
      {message ? <Text accessibilityRole="alert" className="mt-3 text-sm font-semibold text-gray-800">{message}</Text> : null}
    </View>
  );
}

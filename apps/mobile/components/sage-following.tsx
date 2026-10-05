import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/ui/text';
import { friendlyError } from '@/lib/friendly-error';
import { api, type SageTaskView } from '@/lib/api';

const THEME = { primary: '#FF6B00', border: '#E5E7EB', muted: '#64748B', ink: '#111827', done: '#047857', danger: '#B91C1C' };

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const CLOSED_LABEL: Record<string, string> = { DONE: 'Done', DISMISSED: 'Dismissed', ABANDONED: 'Stopped following' };

/**
 * What Sage is following up on with this member: each open task says why it exists, what Sage is
 * waiting for, when it will check back, and what happens next. The member can dismiss any of them.
 */
export function SageFollowing({ sessionToken, coopId = 'cahootz' }: { sessionToken: string; coopId?: string }) {
  const [data, setData] = React.useState<{ open: SageTaskView[]; closed: SageTaskView[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    api.listSageTasks(sessionToken, coopId).then(setData).catch((err) => setError(friendlyError(err, "We couldn't load Sage's follow-ups.")));
  }, [sessionToken, coopId]);
  React.useEffect(() => { load(); }, [load]);

  const dismiss = async (taskId: string) => {
    setBusy(taskId);
    try {
      await api.dismissSageTask(taskId, sessionToken);
      load();
    } catch (err) {
      setError(friendlyError(err, "We couldn't dismiss this follow-up."));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return error ? <Text style={{ color: THEME.danger }}>{error}</Text> : <ActivityIndicator accessibilityLabel="Loading follow-ups" color={THEME.primary} />;

  return (
    <View style={{ gap: 10 }}>
      {error ? <Text style={{ color: THEME.danger }}>{error}</Text> : null}
      {data.open.length === 0 ? (
        <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border }}>
          <Text style={{ fontWeight: '700', color: THEME.ink }}>Sage isn&apos;t following up on anything with you</Text>
          <Text style={{ color: THEME.muted, marginTop: 4 }}>
            When Sage asks you for something or offers a next step, it shows up here with when Sage will check back.
          </Text>
        </View>
      ) : (
        data.open.map((task) => (
          <View key={task.id} testID={`sage-task-${task.id}`} style={{ borderRadius: 14, padding: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 6 }}>
            <Text style={{ fontWeight: '700', color: THEME.ink }}>{task.title}</Text>
            {task.expected ? <Text style={{ color: THEME.ink }}>Waiting for you to {task.expected.replace(/\.$/, '')}.</Text> : null}
            <Text style={{ fontSize: 12, color: THEME.muted }}>Why: {task.reason}</Text>
            <Text style={{ fontSize: 12, color: THEME.muted }}>
              Sage checks back {when(task.nextWakeAt)}{task.attempts > 0 ? ' one last time' : ''}.
              {task.offer ? ` After that: ${task.offer.replace(/^I can/i, 'Sage can')}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              {task.postId ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Open the discussion for ${task.title}`}
                  onPress={() => router.push({ pathname: '/[coopId]/posts/[postId]', params: { coopId, postId: task.postId } } as any)}
                  style={{ borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: THEME.primary }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Open</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Dismiss follow-up ${task.title}`}
                disabled={busy === task.id}
                onPress={() => dismiss(task.id)}
                style={{ borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: THEME.border, opacity: busy === task.id ? 0.6 : 1 }}
              >
                <Text style={{ color: THEME.ink, fontWeight: '700' }}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      {data.closed.length ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: THEME.muted }}>RECENTLY CLOSED</Text>
          {data.closed.map((task) => (
            <View key={task.id} style={{ borderRadius: 12, padding: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 2 }}>
              <Text style={{ fontWeight: '700', color: THEME.ink }}>{task.title}</Text>
              <Text style={{ fontSize: 12, color: task.status === 'DONE' ? THEME.done : THEME.muted }}>
                {CLOSED_LABEL[task.status] ?? task.status}{task.outcome ? ` · ${task.outcome}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

import React from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type SageAlertView } from '@/lib/api';

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  border: '#E5E7EB',
  muted: '#64748B',
  ink: '#111827',
  danger: '#B91C1C',
  done: '#047857',
};

const SEVERITY: Record<SageAlertView['severity'], { label: string; color: string }> = {
  HIGH: { label: 'Needs a look soon', color: '#B91C1C' },
  MEDIUM: { label: 'Worth a look', color: '#B45309' },
  LOW: { label: 'For your awareness', color: '#64748B' },
};

const STATUS_NOTE: Record<string, string> = {
  ACKNOWLEDGED: "You've marked this as handled.",
  REROUTED: 'You passed this on. Sage sent it to the next person responsible.',
  EXPIRED: 'This alert has expired.',
};

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * A routed Sage alert: what Sage noticed, the evidence, why this person got it, and what Sage recommends.
 * "Got it" closes it; "Not for me" sends it to the next person responsible and teaches the directory.
 * Sage never takes a disciplinary step here; it only asks a person to take a look.
 */
export default function SageAlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessionToken } = useAuth();
  const [alert, setAlert] = React.useState<SageAlertView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [showFeedback, setShowFeedback] = React.useState(false);
  const [feedback, setFeedback] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!sessionToken || !id) return;
    api.getSageAlert(id, sessionToken).then(setAlert).catch((err) => setError(err instanceof Error ? err.message : 'Could not load this alert.'));
  }, [id, sessionToken]);
  React.useEffect(() => { load(); }, [load]);

  const act = async (kind: 'ack' | 'reroute') => {
    if (!sessionToken || !alert) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'ack') {
        await api.acknowledgeSageAlert(alert.id, sessionToken);
        setNotice('Thanks. Sage marked this as handled.');
      } else {
        const result = await api.sageAlertNotForMe(alert.id, sessionToken, feedback.trim() || undefined);
        setNotice(result.to ? "Thanks. Sage passed this to the next person responsible and won't send you this kind of alert for a while." : 'Thanks. Sage sent this to the platform team.');
        setShowFeedback(false);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const card = { borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 6 } as const;
  const open = alert?.status === 'SENT' || alert?.status === 'QUEUED';

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
        <Text style={{ fontSize: 20, fontWeight: '800', color: THEME.ink }}>Sage alert</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {!alert ? (
          error ? <Text style={{ color: THEME.danger }}>{error}</Text> : <ActivityIndicator accessibilityLabel="Loading alert" color={THEME.primary} />
        ) : (
          <>
            <View style={card}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: SEVERITY[alert.severity].color }}>{SEVERITY[alert.severity].label.toUpperCase()}</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: THEME.ink }}>{alert.title}</Text>
              <Text style={{ color: THEME.ink }}>{alert.body}</Text>
              {alert.dueAt ? <Text style={{ fontSize: 12, color: THEME.muted }}>Best handled by {formatDay(alert.dueAt)}</Text> : null}
            </View>

            <View style={card}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>What Sage saw</Text>
              <Text style={{ color: THEME.ink }}>{alert.evidence.source}</Text>
              {alert.evidence.quote ? (
                <Text style={{ color: THEME.muted, fontStyle: 'italic', borderLeftWidth: 3, borderLeftColor: THEME.border, paddingLeft: 10 }}>
                  “{alert.evidence.quote}”
                </Text>
              ) : null}
            </View>

            <View style={card}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>Why you</Text>
              <Text style={{ color: THEME.ink }}>{alert.evidence.why}</Text>
            </View>

            <View style={card}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: THEME.muted }}>What Sage recommends</Text>
              <Text style={{ color: THEME.ink }}>{alert.evidence.recommendation}</Text>
            </View>

            {notice ? <Text style={{ color: THEME.done, fontWeight: '700' }}>{notice}</Text> : null}
            {!notice && !open && STATUS_NOTE[alert.status] ? <Text style={{ color: THEME.muted }}>{STATUS_NOTE[alert.status]}</Text> : null}
            {error ? <Text style={{ color: THEME.danger }}>{error}</Text> : null}

            {alert.postId ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open the post"
                onPress={() => router.push({ pathname: '/[coopId]/posts/[postId]', params: { coopId: alert.coopId, postId: alert.postId } } as any)}
                style={{ borderRadius: 12, padding: 12, borderWidth: 1, borderColor: THEME.primary, alignItems: 'center' }}
              >
                <Text style={{ color: THEME.primary, fontWeight: '700' }}>Open the post</Text>
              </TouchableOpacity>
            ) : null}

            {open ? (
              <View style={{ gap: 10 }}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Got it"
                  disabled={busy}
                  onPress={() => act('ack')}
                  style={{ borderRadius: 12, padding: 14, backgroundColor: THEME.primary, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Got it</Text>
                </TouchableOpacity>
                {showFeedback ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      accessibilityLabel="Who should get this instead (optional)"
                      placeholder="Who should get this instead? (optional)"
                      value={feedback}
                      onChangeText={setFeedback}
                      maxLength={500}
                      multiline
                      style={{ minHeight: 60, borderRadius: 12, borderWidth: 1, borderColor: THEME.border, padding: 12, backgroundColor: '#FFFFFF', color: THEME.ink }}
                    />
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Pass it on"
                      disabled={busy}
                      onPress={() => act('reroute')}
                      style={{ borderRadius: 12, padding: 12, borderWidth: 1, borderColor: THEME.border, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
                    >
                      <Text style={{ color: THEME.ink, fontWeight: '700' }}>Pass it on</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Not for me"
                    onPress={() => setShowFeedback(true)}
                    style={{ borderRadius: 12, padding: 12, borderWidth: 1, borderColor: THEME.border, alignItems: 'center' }}
                  >
                    <Text style={{ color: THEME.ink, fontWeight: '700' }}>Not for me</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { SageAvatar } from '@/components/sage-avatar';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommunityPulseObservation, type HumanAIFeedbackResponse } from '@/lib/api';
import { LoadError } from '@/components/load-error';
import { DESIGN } from '@/constants/design';

interface PulseButtonProps {
  children: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  expanded?: boolean;
}

function PulseButton({ children, onPress, selected, disabled, expanded }: PulseButtonProps) {
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={{ checked: selected, disabled, expanded }}
      aria-checked={selected}
      aria-expanded={expanded}
      disabled={disabled}
      style={{ minHeight: DESIGN.controlHeight, borderColor: selected ? DESIGN.ink : DESIGN.border, backgroundColor: selected ? DESIGN.ink : DESIGN.paper }}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-xl border px-3 py-3 web:focus-visible:outline web:focus-visible:outline-2 web:focus-visible:outline-offset-2 web:focus-visible:outline-gray-900 ${
        disabled ? 'border-gray-200 bg-gray-100 opacity-60'
          : selected ? 'border-gray-900 bg-gray-900 active:opacity-80'
          : 'border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100'
      }`}
    >
      <Text className={`text-sm font-bold ${selected ? 'text-white' : 'text-gray-800'}`}>{children}</Text>
    </Pressable>
  );
}

/** Reads only explicitly published Commons Pulse observations, never private memory. */
export function CommunityPulse({ coopId }: { coopId: string }) {
  const { sessionToken } = useAuth();
  // A changed account must not inherit another member's response state.
  return sessionToken ? <PulseContent key={`${coopId}:${sessionToken}`} coopId={coopId} sessionToken={sessionToken} /> : null;
}

function PulseContent({ coopId, sessionToken }: { coopId: string; sessionToken: string }) {
  const [observations, setObservations] = useState<CommunityPulseObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.getCommunityPulse(coopId, sessionToken)
      .then((result) => { if (active) setObservations(result.observations); })
      .catch(() => { if (active) setError("We couldn't load the community pulse. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [coopId, sessionToken, reload]);
  return (
    <View testID="community-pulse" style={{ borderRadius: DESIGN.radius, borderColor: DESIGN.border, backgroundColor: DESIGN.paper }} className="mb-3 overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <View className="p-4">
        <View className="flex-row items-center gap-3">
          <SageAvatar size={44} />
          <View className="min-w-0 flex-1">
            <Text accessibilityRole="header" className="text-xl font-black text-gray-950">Community Pulse</Text>
            <Text className="text-sm text-gray-600">A shared perspective from Sage</Text>
          </View>
        </View>
        {loading ? <View className="mt-4"><ActivityIndicator accessibilityLabel="Loading community pulse" /></View>
          : error ? <View className="mt-4"><LoadError message={error} onRetry={() => setReload(reload + 1)} /></View>
          : observations.length === 0 ? <Text className="mt-4 text-base leading-6 text-gray-600">No community observations to share yet. When Sage publishes one, you can tell us whether it feels right.</Text>
          : null}
      </View>
      {!loading && !error && observations.map((observation) => (
        <PulseObservation key={observation.id} observation={observation} coopId={coopId} sessionToken={sessionToken} />
      ))}
      <Text className="border-t border-gray-200 p-4 text-sm leading-5 text-gray-600">About the community, together. Private chats and personal notes don’t belong in this view.</Text>
    </View>
  );
}

const CHOICES: { value: HumanAIFeedbackResponse; label: string }[] = [
  { value: 'YES', label: 'Yes' }, { value: 'PARTLY', label: 'Partly' }, { value: 'DIFFERENT_TAKE', label: 'Different take' },
];

function PulseObservation({ observation, coopId, sessionToken }: {
  observation: CommunityPulseObservation; coopId: string; sessionToken: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedback, setFeedback] = useState(observation.feedback);
  const [comment, setComment] = useState(observation.feedback?.comment ?? '');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  async function save(response: HumanAIFeedbackResponse, includeComment = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await api.saveHumanAIFeedback({
        coopId, observationId: observation.id, response,
        ...(includeComment ? { comment: comment.trim() || null } : {}),
      }, sessionToken);
      setFeedback(saved);
      if (includeComment) setComment(saved.comment ?? '');
    } catch {
      setError("Your response didn't save. Please try again. If this pulse has changed, reload the page.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const dirty = comment.trim() !== (feedback?.comment ?? '');
  return (
    <View testID={`pulse-observation-${observation.id}`} className="border-t border-gray-200 p-4">
      <Text className="mb-2 text-sm font-bold text-gray-600">What Sage is noticing</Text>
      {!!observation.title && <Text accessibilityRole="header" className="mb-3 text-2xl font-bold leading-8 text-gray-950">{observation.title}</Text>}
      <Text className="text-base leading-6 text-gray-700">{observation.summary}</Text>
      <Text className="mb-3 mt-3 text-sm text-gray-600">Sage’s perspective · {new Date(observation.createdAt).toLocaleDateString()} · open to correction</Text>
      <PulseButton expanded={evidenceOpen} onPress={() => setEvidenceOpen(!evidenceOpen)}>{evidenceOpen ? 'Hide the basis' : 'What led to this?'}</PulseButton>
      {evidenceOpen && <View className="mt-3 gap-3 rounded-xl bg-gray-50 p-3">
        <Text className="text-base leading-6 text-gray-700">{observation.basis || 'No further explanation was published with this observation.'}</Text>
        {!!observation.uncertainty && <><Text className="font-bold text-gray-900">What we don’t know</Text><Text className="text-base text-gray-700">{observation.uncertainty}</Text></>}
      </View>}
      <Text className="mb-3 mt-5 font-bold text-gray-900">Does this feel right?</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Does this feel right?" className="flex-row flex-wrap gap-2">
        {CHOICES.map((choice) => <PulseButton key={choice.value} disabled={saving} selected={feedback?.response === choice.value} onPress={() => void save(choice.value)}>{choice.label}</PulseButton>)}
      </View>
      {saving && <Text accessibilityLiveRegion="polite" className="mt-3 text-sm text-gray-600">Saving response…</Text>}
      {!!error && <Text accessibilityRole="alert" className="mt-3 text-sm text-red-700">{error}</Text>}
      {feedback && <View className="mt-3 gap-3">
        {!saving && !error && <Text accessibilityLiveRegion="polite" className="text-sm text-gray-600">Your response is saved. You can change it anytime while this pulse is open.</Text>}
        <Text className="font-semibold text-gray-900">Anything to add? (optional)</Text>
        <TextInput accessibilityLabel="Your perspective on the community" placeholder="What is Sage missing?" multiline maxLength={500}
          value={comment} onChangeText={setComment} editable={!saving} textAlignVertical="top"
          className="min-h-24 rounded-xl border border-gray-300 bg-white p-3 text-base text-gray-900 web:focus:outline-2 web:focus:outline-gray-900" />
        <PulseButton disabled={saving || !dirty} onPress={() => void save(feedback.response, true)}>Save explanation</PulseButton>
        {dirty && <Text className="text-sm text-gray-600">Your explanation has unsaved changes.</Text>}
      </View>}
      <Text className="mt-3 text-sm leading-5 text-gray-600">Your answer and explanation aren’t shown to other members.</Text>
    </View>
  );
}

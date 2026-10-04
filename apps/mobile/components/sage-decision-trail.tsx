import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api, type SageDecisionTrail, type SageTrailFilter, type SageTrailStage } from '@/lib/api';

const STAGES: { stage: SageTrailStage; label: string }[] = [
  { stage: 'OBSERVED', label: 'Observed' },
  { stage: 'EVIDENCE', label: 'Evidence gathered' },
  { stage: 'CONSIDERED', label: 'Action considered' },
  { stage: 'POLICY', label: 'Policy check' },
  { stage: 'TAKEN', label: 'Action taken' },
  { stage: 'RESULT', label: 'Result' },
  { stage: 'FOLLOW_UP', label: 'Follow-up' },
];

const MARK = { PASS: '✓', FAIL: '✗', INFO: '•' } as const;
const MARK_COLOR = { PASS: '#047857', FAIL: '#B91C1C', INFO: '#64748B' } as const;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function TrailCard({ trail }: { trail: SageDecisionTrail }) {
  const [open, setOpen] = React.useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View style={{ borderWidth: 1, borderColor: '#E7E5E4', borderRadius: 12, backgroundColor: '#FFFFFF' }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Hide' : 'Show'} Sage decision: ${trail.outcome}`}
        onPress={() => setOpen((value) => !value)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 }}
      >
        <Chevron size={16} color="#57534E" />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#C2410C' }}>{trail.agentLabel}</Text>
          <Text style={{ fontWeight: '700', color: '#1C1917' }}>{trail.outcome}</Text>
          <Text style={{ fontSize: 12, color: '#78716C' }}>
            {trail.triggerLabel} · {formatWhen(trail.createdAt)}
          </Text>
        </View>
      </TouchableOpacity>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 12 }}>
          {STAGES.map(({ stage, label }) => {
            const steps = trail.steps.filter((step) => step.stage === stage);
            const observed = stage === 'OBSERVED' ? trail.observed : null;
            if (!steps.length && !observed) return null;
            return (
              <View key={stage} style={{ gap: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.5, color: '#C2410C', textTransform: 'uppercase' }}>
                  {label}
                </Text>
                {steps.map((step, index) => (
                  <View key={`${stage}-${index}`} style={{ flexDirection: 'row', gap: 6 }}>
                    <Text style={{ color: MARK_COLOR[step.outcome ?? 'INFO'], fontWeight: '800' }}>{MARK[step.outcome ?? 'INFO']}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#1C1917' }}>{step.label}</Text>
                      {step.detail ? <Text style={{ fontSize: 12, color: '#57534E' }}>{step.detail}</Text> : null}
                    </View>
                  </View>
                ))}
                {observed ? <ObservedContent observed={observed} /> : null}
              </View>
            );
          })}
          {trail.hiddenSteps > 0 ? (
            <Text style={{ fontSize: 12, color: '#78716C' }}>
              {trail.hiddenSteps} {trail.hiddenSteps === 1 ? 'step is' : 'steps are'} visible only to platform admins.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ObservedContent({ observed }: { observed: SageDecisionTrail['observed'] }) {
  const quote = { borderLeftWidth: 3, borderLeftColor: '#FED7AA', paddingLeft: 8, gap: 2 } as const;
  if (observed.items?.length) {
    return (
      <View style={{ gap: 6 }}>
        {observed.items.map((item, index) => (
          <View key={`${item.at}-${index}`} style={quote}>
            <Text style={{ fontSize: 12, color: '#78716C' }}>
              {item.author} · {formatWhen(item.at)}
            </Text>
            <Text style={{ color: '#1C1917' }}>{item.content}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (!observed.content) return null;
  return (
    <View style={quote}>
      {observed.title ? <Text style={{ fontWeight: '700', color: '#1C1917' }}>{observed.title}</Text> : null}
      <Text style={{ color: '#1C1917' }}>{observed.content}</Text>
      {observed.context ? <Text style={{ fontSize: 12, color: '#78716C' }}>On: {observed.context}</Text> : null}
    </View>
  );
}

/**
 * Sage's decision trails for a post (and its comments), a suggestion, a proposal, or a conversation. Renders nothing unless
 * the member has turned on "Show Sage decision trails" in Sage settings; the API enforces who may see
 * which trail.
 */
export function SageDecisionTrails({
  filter,
  sessionToken,
  refreshKey,
  hideWhenEmpty = false,
}: {
  filter: SageTrailFilter;
  sessionToken: string | null | undefined;
  refreshKey?: unknown;
  /** For places where most items never involve Sage (a direct message with a person). */
  hideWhenEmpty?: boolean;
}) {
  const [state, setState] = React.useState<{ enabled: boolean; trails: SageDecisionTrail[] } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const key = JSON.stringify(filter);

  React.useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setFailed(false);
    api
      .listSageTrails(filter, sessionToken)
      .then((result) => { if (!cancelled) setState(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // filter is identified by key; refreshKey lets the parent reload after a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sessionToken, refreshKey]);

  // Nothing renders while loading or when the setting is off, so members who don't use it never see it.
  if (failed || !state?.enabled) return null;
  if (hideWhenEmpty && !state.trails.length) return null;

  return (
    <View testID="sage-decision-trails" style={{ marginTop: 16, gap: 8 }}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: '#1C1917' }}>Sage decision trail</Text>
      {state.trails.length ? (
        state.trails.map((trail) => <TrailCard key={trail.id} trail={trail} />)
      ) : (
        <Text style={{ fontSize: 13, color: '#78716C' }}>Sage hasn&apos;t analyzed this yet.</Text>
      )}
    </View>
  );
}

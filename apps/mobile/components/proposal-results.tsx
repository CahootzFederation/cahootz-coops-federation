import React, { useState } from 'react';
import { ActivityIndicator, TextInput, TouchableOpacity, View } from 'react-native';
import { History, Target } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

type Unit = 'USD' | 'UC' | 'jobs' | 'percent' | 'count';
type Outcome = 'MET' | 'PARTLY_MET' | 'MISSED' | 'NO_REPORT';

export interface ProposalKpi {
  id?: string;
  name: string;
  target: number;
  unit: Unit;
  higherIsBetter?: boolean;
  measureAfterDays?: number;
  measureBy?: string | null;
  outcome?: Outcome | null;
  actualValue?: number | null;
  outcomeNote?: string | null;
  verification?: 'OWNER_REPORTED' | 'NONE' | null;
}

export interface PriorOutcome {
  text: string;
  sourceIds?: string[];
  ageDays: number;
}

const CARD_SHADOW = { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 };

const OUTCOME_STYLE: Record<Outcome, { label: string; bg: string; text: string }> = {
  MET: { label: 'Met', bg: '#F0FDF4', text: '#15803D' },
  PARTLY_MET: { label: 'Partly met', bg: '#FFFBEB', text: '#B45309' },
  MISSED: { label: 'Missed', bg: '#FEF2F2', text: '#DC2626' },
  NO_REPORT: { label: 'No report', bg: '#F3F4F6', text: '#4B5563' },
};

export function formatKpiValue(value: number, unit: Unit) {
  const number = value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (unit === 'USD') return `$${number}`;
  if (unit === 'percent') return `${number}%`;
  if (unit === 'UC') return `${number} coin`;
  if (unit === 'jobs') return `${number} ${value === 1 ? 'job' : 'jobs'}`;
  return number;
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function KpiRow({ kpi, canReport, walletAddress, onUpdated }: {
  kpi: ProposalKpi;
  canReport: boolean;
  walletAddress?: string | null;
  onUpdated: (proposal: unknown) => void;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<'value' | 'none' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const goal = `${kpi.higherIsBetter === false ? 'At most' : 'At least'} ${formatKpiValue(kpi.target, kpi.unit)}`;
  const due = kpi.measureBy ? new Date(kpi.measureBy) : null;
  const isDue = !!due && due.getTime() <= Date.now();
  const outcome = kpi.outcome ? OUTCOME_STYLE[kpi.outcome] : null;

  async function save(actual: number | null) {
    if (!kpi.id || !walletAddress) return;
    setSaving(actual === null ? 'none' : 'value');
    setError(null);
    try {
      const updated = await api.reportKpiOutcome(kpi.id, actual, note.trim() || undefined, walletAddress);
      onUpdated(updated);
    } catch (e: unknown) {
      setError(friendlyError(e, "We couldn't save the result."));
    } finally {
      setSaving(null);
    }
  }

  const parsed = Number(value.replace(/[$,%\s]/g, ''));
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <View testID={kpi.id ? `kpi-${kpi.id}` : undefined} className="p-3 bg-cream-50 rounded-xl">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-charcoal-800 font-medium text-sm">{kpi.name}</Text>
          <Text className="text-charcoal-500 text-xs mt-0.5">Goal: {goal}</Text>
        </View>
        {outcome && (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: outcome.bg }}>
            <Text style={{ color: outcome.text, fontSize: 11, fontWeight: '600' }}>{outcome.label}</Text>
          </View>
        )}
      </View>

      {kpi.outcome ? (
        <View className="mt-2">
          {kpi.actualValue !== null && kpi.actualValue !== undefined && (
            <Text className="text-charcoal-700 text-sm">
              Result: {formatKpiValue(kpi.actualValue, kpi.unit)} of {formatKpiValue(kpi.target, kpi.unit)}
            </Text>
          )}
          <Text className="text-charcoal-400 text-xs mt-0.5">
            {kpi.verification === 'OWNER_REPORTED'
              ? 'Reported by the proposal’s author. Not checked by anyone else.'
              : kpi.outcome === 'NO_REPORT' && kpi.actualValue === null
                ? 'No result was reported.'
                : ''}
          </Text>
          {!!kpi.outcomeNote && <Text className="text-charcoal-600 text-xs mt-1">“{kpi.outcomeNote}”</Text>}
        </View>
      ) : !due ? (
        <Text className="text-charcoal-400 text-xs mt-2">
          Checked {kpi.measureAfterDays ?? 90} days after the proposal is approved.
        </Text>
      ) : !isDue ? (
        <Text className="text-charcoal-400 text-xs mt-2">Sage asks the author for the result on {formatDay(due.toISOString())}.</Text>
      ) : canReport ? (
        <View className="mt-3 gap-2">
          <Text className="text-charcoal-600 text-xs">
            How did it go? Your answer is shown on this proposal for everyone in the commons.
          </Text>
          <TextInput
            accessibilityLabel={`Result for ${kpi.name}`}
            placeholder={`Result (${kpi.unit === 'USD' ? 'dollars' : kpi.unit === 'percent' ? 'percent' : 'number'})`}
            keyboardType="decimal-pad"
            value={value}
            onChangeText={setValue}
            className="bg-white border border-cream-300 rounded-xl px-3 text-charcoal-800"
            style={{ minHeight: 44 }}
          />
          <TextInput
            accessibilityLabel={`Note about ${kpi.name}`}
            placeholder="Anything members should know (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
            className="bg-white border border-cream-300 rounded-xl px-3 py-2 text-charcoal-800"
            style={{ minHeight: 44 }}
          />
          {error && <Text className="text-red-600 text-xs">{error}</Text>}
          <View className="flex-row gap-2">
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Save result for ${kpi.name}`}
              disabled={!valid || saving !== null}
              onPress={() => save(parsed)}
              className="flex-1 bg-primary rounded-xl items-center justify-center"
              style={{ minHeight: 44, opacity: !valid || saving !== null ? 0.5 : 1 }}
            >
              {saving === 'value' ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-sm">Save result</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Couldn't measure ${kpi.name}`}
              disabled={saving !== null}
              onPress={() => save(null)}
              className="flex-1 bg-white border border-cream-300 rounded-xl items-center justify-center"
              style={{ minHeight: 44 }}
            >
              {saving === 'none' ? <ActivityIndicator color="#FF6B00" /> : <Text className="text-charcoal-700 text-sm">Couldn’t measure it</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text className="text-charcoal-400 text-xs mt-2">Waiting for the author to report the result.</Text>
      )}
    </View>
  );
}

/** The proposal's goals and, once measured, what happened. The author reports results here. */
export function ProposalResults({ kpis, status, isProposer, walletAddress, onUpdated }: {
  kpis: ProposalKpi[];
  status: string;
  isProposer: boolean;
  walletAddress?: string | null;
  onUpdated: (proposal: unknown) => void;
}) {
  if (!kpis.length) return null;
  const decided = status === 'approved' || status === 'funded';
  return (
    <View className="bg-white rounded-2xl p-4" style={CARD_SHADOW}>
      <View className="flex-row items-center gap-2 mb-1">
        <Target size={16} color="#FF6B00" />
        <Text className="text-charcoal-800 font-semibold text-base">Goals and results</Text>
      </View>
      <Text className="text-charcoal-500 text-xs mb-3">
        {decided
          ? 'When each goal is due, Sage privately asks the author how it went and records the result here.'
          : 'If this proposal is approved, Sage will ask the author how each goal turned out.'}
      </Text>
      <View className="gap-2">
        {kpis.map((kpi, index) => (
          <KpiRow
            key={kpi.id ?? index}
            kpi={kpi}
            canReport={isProposer && decided}
            walletAddress={walletAddress}
            onUpdated={onUpdated}
          />
        ))}
      </View>
    </View>
  );
}

/** Results of similar past proposals that Sage remembered while reviewing this one. */
export function PriorProposalOutcomes({ items }: { items: PriorOutcome[] }) {
  if (!items.length) return null;
  return (
    <View className="bg-white rounded-2xl p-4" style={CARD_SHADOW}>
      <View className="flex-row items-center gap-2 mb-1">
        <History size={16} color="#FF6B00" />
        <Text className="text-charcoal-800 font-semibold text-base">How similar proposals went</Text>
      </View>
      <Text className="text-charcoal-500 text-xs mb-3">
        Sage remembered these when reviewing this proposal. They are what each author reported, not checked facts.
      </Text>
      <View className="gap-2">
        {items.map((item, index) => (
          <View key={index} className="p-3 bg-cream-50 rounded-xl">
            <Text className="text-charcoal-700 text-sm">{item.text.replace(/^\[PROPOSAL OUTCOME\] · \d{4}-\d{2}-\d{2} · /, '')}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

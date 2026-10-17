import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PreferenceSwitch } from '@/components/preference-switch';
import { Text } from '@/components/ui/text';
import { api, type SageRhythmCategory, type SageRhythmMode, type SageRhythmSettings } from '@/lib/api';

const CATEGORIES: Array<{ key: SageRhythmCategory; title: string; body: string }> = [
  { key: 'weekly_priorities', title: 'Monday priorities', body: "This week's three priorities: votes closing, events coming up, open requests and goals." },
  { key: 'midweek_open_work', title: 'Midweek open requests', body: 'Requests nobody has answered yet and conversations waiting on a next step. Never says who asked.' },
  { key: 'friday_appreciation', title: 'Friday appreciation', body: 'What members did for each other this week, counted from records in the app, and progress on our goals.' },
  { key: 'monthly_review', title: 'Monthly review', body: 'What improved, what stalled and what could stop, compared with the month before.' },
  { key: 'before_decisions', title: 'Before decisions', body: 'A balanced summary of agreement, disagreement, missing facts and groups not yet heard before a vote closes.' },
];

const MODES: Array<{ value: SageRhythmMode; label: string }> = [
  { value: 'NOTIFY', label: 'Notify me' },
  { value: 'FEED', label: 'Show quietly' },
  { value: 'MUTED', label: 'Mute' },
];

const NAMING_LABEL = "Name me in Sage's Friday appreciation";

/**
 * Sage's regular community rhythm. Show quietly (default) shows the item with no alert; Notify me adds
 * an alert and push; Mute hides that kind of item and never alerts you.
 */
export function SageRhythmSettings({ sessionToken }: { sessionToken: string }) {
  const client = useQueryClient();
  const queryKey = ['sage-rhythm-settings', sessionToken];
  const query = useQuery({ queryKey, queryFn: () => api.getSageRhythmSettings(sessionToken) });
  const setData = (patch: Partial<SageRhythmSettings>) =>
    client.setQueryData<SageRhythmSettings>(queryKey, (previous) => (previous ? { ...previous, ...patch } : previous));
  const modeMutation = useMutation({
    mutationFn: (input: { category: SageRhythmCategory; mode: SageRhythmMode }) => api.setSageRhythmMode(input.category, input.mode, sessionToken),
    // The feed reads the saved choice the next time it loads.
    onSuccess: (saved) => setData({ modes: saved.modes }),
  });
  const namingMutation = useMutation({
    mutationFn: (value: boolean) => api.setSageAppreciationNaming(value, sessionToken),
    onSuccess: (saved) => setData({ nameInAppreciation: saved.nameInAppreciation }),
  });
  const busy = !query.data || modeMutation.isPending || namingMutation.isPending;
  const modeFor = (category: SageRhythmCategory) =>
    modeMutation.isPending && modeMutation.variables?.category === category
      ? modeMutation.variables.mode
      : query.data?.modes[category] ?? 'FEED';
  const naming = namingMutation.isPending ? !!namingMutation.variables : !!query.data?.nameInAppreciation;
  const failed = modeMutation.isError || namingMutation.isError;
  const saved = (modeMutation.isSuccess || namingMutation.isSuccess) && !busy;

  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: '#E7E5E4', backgroundColor: '#FFFFFF', padding: 16, gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ fontWeight: '800', color: '#1C1917' }}>Sage&apos;s community rhythm</Text>
        <Text style={{ fontSize: 13, color: '#57534E' }}>
          Choose an alert, see the item without an alert, or mute each ritual. Muting hides that kind of item and stops its alerts.
        </Text>
      </View>

      {CATEGORIES.map((category) => {
        const current = modeFor(category.key);
        return (
          <View key={category.key} style={{ gap: 8 }}>
            <View style={{ gap: 2 }}>
              <Text style={{ fontWeight: '700', color: '#1C1917' }}>{category.title}</Text>
              <Text style={{ fontSize: 13, color: '#57534E' }}>{category.body}</Text>
            </View>
            <View accessibilityRole="radiogroup" accessibilityLabel={category.title} style={{ flexDirection: 'row', gap: 6 }}>
              {MODES.map((mode) => {
                const selected = current === mode.value;
                return (
                  <TouchableOpacity
                    key={mode.value}
                    accessibilityRole="radio"
                    accessibilityLabel={`${category.title}: ${mode.label}`}
                    accessibilityState={{ checked: selected, disabled: busy }}
                    aria-checked={selected}
                    disabled={busy}
                    onPress={() => !selected && modeMutation.mutate({ category: category.key, mode: mode.value })}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1,
                      borderColor: selected ? '#C2410C' : '#E7E5E4', backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: selected ? '800' : '600', color: selected ? '#C2410C' : '#44403C' }}>{mode.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}

      <View style={{ height: 1, backgroundColor: '#E7E5E4' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontWeight: '700', color: '#1C1917' }}>{NAMING_LABEL}</Text>
          <Text style={{ fontSize: 13, color: '#57534E' }}>
            Off by default. When it&apos;s on, Sage may thank you by name for help, hosting, sharing a resource or keeping a
            commitment the app recorded. It never names anyone who asked for help.
          </Text>
        </View>
        <PreferenceSwitch label={NAMING_LABEL} value={naming} disabled={busy} onChange={(value) => namingMutation.mutate(value)} />
      </View>

      {failed ? (
        <Text accessibilityRole="alert" style={{ color: '#B91C1C' }}>Could not save. Your previous choice is still active.</Text>
      ) : saved ? (
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 13, color: '#047857' }}>Saved.</Text>
      ) : null}
    </View>
  );
}

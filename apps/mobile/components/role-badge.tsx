import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { circleRoleLabel, platformRoleLabels } from '@/lib/role-labels';

const COLORS: Record<string, { bg: string; fg: string }> = {
  Admin: { bg: '#EDE9FE', fg: '#6D28D9' },
  Governor: { bg: '#DBEAFE', fg: '#1D4ED8' },
  Business: { bg: '#DCFCE7', fg: '#15803D' },
  Sage: { bg: '#FFF7ED', fg: '#C2410C' },
  Guide: { bg: '#FEF3C7', fg: '#B45309' },
  Newcomer: { bg: '#F1F5F9', fg: '#475569' },
};

function Pill({ label }: { label: string }) {
  const colors = COLORS[label] ?? { bg: '#F1F5F9', fg: '#475569' };
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.bg }}>
      <Text style={{ color: colors.fg, fontSize: 10, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** Small tags next to a member's name - platform roles (Admin/Governor/Business/Sage) and/or their
 * role in the current circle (Guide/Newcomer). Renders nothing for a plain member, on purpose. */
export function RoleBadge({ roles, circleRole }: { roles?: string[] | null; circleRole?: string | null }) {
  const platformLabels = platformRoleLabels(roles);
  const circleLabel = circleRoleLabel(circleRole);
  if (platformLabels.length === 0 && !circleLabel) return null;

  return (
    <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
      {platformLabels.map((label) => (
        <Pill key={label} label={label} />
      ))}
      {circleLabel ? <Pill label={circleLabel} /> : null}
    </View>
  );
}

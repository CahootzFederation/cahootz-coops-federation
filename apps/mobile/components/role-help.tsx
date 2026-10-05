import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp, Info } from 'lucide-react-native';

import { Text } from '@/components/ui/text';

/**
 * What a commons steward can do, in one place so every screen uses the same
 * words. Keep it true to the server: stewards are members with the
 * "steward" (or "admin") role on a commons (`STEWARD_ROLES` in
 * packages/trpc/src/services/commons-membership.ts). Only they can review
 * join requests and applications, approve recommendations, cancel others'
 * invitations, make share links, make or remove stewards, and remove members.
 */
export const STEWARD_EXPLANATION =
  'Stewards look after this commons. They approve or decline people who ask to join, manage invitations, and can make others stewards or remove members.';

/** What someone will be able to do once they're made a steward. */
export function stewardPowersFor(name: string) {
  return `${name} will be able to approve or decline people who ask to join, manage invitations, make others stewards, and remove members.`;
}

/**
 * A small "What's a steward?" link that opens a one-line explanation.
 * Put it next to the first place a screen uses the word "steward".
 */
export function StewardHelp({ color = '#FF6B00' }: { color?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel="What's a steward?"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-2 self-start"
        style={{ minHeight: 44 }}
      >
        <Info size={18} color={color} />
        <Text className="text-sm font-bold" style={{ color }}>
          What&apos;s a steward?
        </Text>
        {open ? <ChevronUp size={16} color={color} /> : <ChevronDown size={16} color={color} />}
      </TouchableOpacity>
      {open ? (
        <Text className="mb-1 text-sm leading-5 text-gray-700">{STEWARD_EXPLANATION}</Text>
      ) : null}
    </View>
  );
}

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { secureStorage } from '@/lib/secure-storage';

const DISMISSED_KEY = 'cahootz.sageIntroDismissed';

export const SAGE_ONE_LINER = "Sage is your commons' AI helper. It's a computer program, not a person.";

// Kept in step with the autonomy boundaries in AGENT.md ("Sage —
// Constitutional Operating Agent"): low-risk, reversible actions may happen
// automatically; money, membership, proposals, and group decisions always
// wait for a person.
const SECTIONS = [
  {
    title: 'What Sage does',
    body: 'Reads posts in your commons to notice what people need, connects people who can help each other, and suggests next steps.',
  },
  {
    title: 'What Sage can do on its own',
    body: 'Reply with helpful information, send you reminders and alerts, and check back on plans.',
  },
  {
    title: 'What always waits for a person',
    body: 'Submitting a proposal, spending or moving money, changing who is a member, and making decisions for the group.',
  },
] as const;

const THEME = {
  primary: '#C2410C',
  primarySoft: '#FFF7ED',
  border: '#FED7AA',
  ink: '#1C1917',
  body: '#44403C',
};

/**
 * Explains who Sage is in plain words. With `dismissible`, the full card
 * shows until the member taps "Got it" (remembered on this device), then
 * shrinks to one line with a "What is Sage?" link that opens it again.
 */
export function SageIntro({ dismissible = true }: { dismissible?: boolean }) {
  const [expanded, setExpanded] = React.useState<boolean | null>(dismissible ? null : true);

  React.useEffect(() => {
    if (!dismissible) return;
    secureStorage
      .getItem(DISMISSED_KEY)
      .then((value) => setExpanded(value !== 'true'))
      .catch(() => setExpanded(true));
  }, [dismissible]);

  if (expanded === null) return null;

  if (!expanded) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 6 }}>
        <Text style={{ color: THEME.body, fontSize: 15 }}>Sage is your commons&apos; AI helper.</Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setExpanded(true)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: THEME.primary, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' }}>
            What is Sage?
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const dismiss = () => {
    setExpanded(false);
    void secureStorage.setItem(DISMISSED_KEY, 'true').catch(() => {});
  };

  return (
    <View
      accessibilityLabel="About Sage"
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: THEME.border,
        backgroundColor: THEME.primarySoft,
        padding: 16,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Sparkles size={20} color={THEME.primary} />
        <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: THEME.ink }}>
          Meet Sage
        </Text>
      </View>
      <Text style={{ fontSize: 16, color: THEME.ink, lineHeight: 22 }}>{SAGE_ONE_LINER}</Text>
      {SECTIONS.map((section) => (
        <View key={section.title} style={{ gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: THEME.ink }}>{section.title}</Text>
          <Text style={{ fontSize: 15, color: THEME.body, lineHeight: 21 }}>{section.body}</Text>
        </View>
      ))}
      <Text style={{ fontSize: 15, color: THEME.body, lineHeight: 21 }}>
        Sage can make mistakes. Check what it says before you act on it.
      </Text>
      {dismissible ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={dismiss}
          style={{
            minHeight: 44,
            borderRadius: 12,
            backgroundColor: THEME.primary,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Got it</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';

import { IconAvatar } from '@/components/icon-avatar';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsInvitationDetail } from '@/lib/api';

export type OnboardingFamily =
  | { kind: 'member'; coopId: string; name: string; iconEmoji?: string | null; iconColor?: string | null; isFamily: boolean }
  | { kind: 'invited'; invitation: CommonsInvitationDetail };

/** A family (invite-only commons) invitation that admits someone, not one that asks them to apply. */
export function isFamilyInvitation(invitation: CommonsInvitationDetail) {
  return invitation.purpose === 'DIRECT_JOIN' && invitation.commons.joinPolicy === 'INVITE_ONLY';
}

/**
 * The newcomer's existing commons, shown on their first sign-in so
 * someone admitted before signing in lands with their community.
 * Memberships open directly; a
 * pending invitation opens it, where they still agree to the family's
 * rules before joining. Renders nothing when there are none, and stays
 * quiet on a failed load (the other ways in still work, and the regular
 * invitations card below reports its own errors).
 */
export function OnboardingFamilyChoices({
  disabled,
  onGoToFamily,
  onOpenInvitation,
}: {
  disabled?: boolean;
  onGoToFamily: (coopId: string) => void;
  onOpenInvitation: (invitationId: string) => void;
}) {
  const { sessionToken } = useAuth();
  const [families, setFamilies] = useState<OnboardingFamily[]>([]);

  useEffect(() => {
    if (!sessionToken) return;
    let active = true;

    Promise.allSettled([
      api.listCommonsDirectory(sessionToken),
      api.listMyCommonsInvitations(sessionToken),
    ]).then(([directory, invitations]) => {
      if (!active) return;
      const next: OnboardingFamily[] = [];
      if (directory.status === 'fulfilled') {
        for (const coop of directory.value.coops) {
          if (coop.accessStatus === 'ACTIVE') {
            next.push({
              kind: 'member',
              isFamily: coop.joinPolicy === 'INVITE_ONLY',
              coopId: coop.id,
              name: coop.name,
              iconEmoji: coop.iconEmoji,
              iconColor: coop.iconColor,
            });
          }
        }
      }
      if (invitations.status === 'fulfilled') {
        for (const invitation of invitations.value.invitations) {
          if (isFamilyInvitation(invitation) && invitation.invitationId) {
            next.push({ kind: 'invited', invitation });
          }
        }
      }
      setFamilies(next);
    });

    return () => {
      active = false;
    };
  }, [sessionToken]);

  if (families.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Your commons</Text>
      {families.map((family) => {
        const isMember = family.kind === 'member';
        const name = isMember ? family.name : family.invitation.commons.name;
        const label = isMember ? `Go to ${name}` : `Join ${name}`;
        const detail = isMember
          ? family.isFamily ? 'Private family · You’re a member' : 'Commons · You’re a member'
          : `${family.invitation.inviterName} invited you. You'll see the family's rules before you join.`;

        return (
          <Pressable
            key={isMember ? family.coopId : family.invitation.invitationId}
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={() =>
              isMember ? onGoToFamily(family.coopId) : onOpenInvitation(family.invitation.invitationId!)
            }
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed, disabled && styles.cardDisabled]}
          >
            <IconAvatar
              emoji={isMember ? family.iconEmoji : family.invitation.commons.iconEmoji}
              color={(isMember ? family.iconColor : family.invitation.commons.iconColor) || palette.avatar}
              foregroundColor={(isMember ? family.iconColor : family.invitation.commons.iconColor) ? undefined : palette.ink}
              fallbackText={name}
              size={48}
            />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{name}</Text>
              <Text style={styles.cardText}>{detail}</Text>
            </View>
            <View style={styles.action}><Text style={styles.actionText}>{isMember ? "Open" : "View invite"}</Text><ArrowRight color={palette.accent} size={18} strokeWidth={2.2} /></View>
          </Pressable>
        );
      })}
    </View>
  );
}

// Hallmark · component: commons row · playful · Cahootz palette
// Pre-emit critique: philosophy 4, hierarchy 5, execution 4, specificity 5, restraint 5, variety 4.
const palette = { ink: '#17251B', muted: '#57645A', surface: '#F0F5ED', border: '#DCE6D7', pressed: '#E1ECDB', accent: '#A43B12', avatar: '#E4ECD9' };
const styles = StyleSheet.create({
  section: {
    gap: 8,
    marginBottom: 8,
  },
  heading: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    minHeight: 96,
  },
  cardPressed: { backgroundColor: palette.pressed },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { color: palette.accent, fontSize: 13, fontWeight: '800' },
  cardDisabled: {
    opacity: 0.55,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  cardText: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});

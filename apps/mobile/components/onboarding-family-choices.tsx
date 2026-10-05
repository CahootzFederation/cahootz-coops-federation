import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';

import { IconAvatar } from '@/components/icon-avatar';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsInvitationDetail } from '@/lib/api';

export type OnboardingFamily =
  | { kind: 'member'; coopId: string; name: string; iconEmoji?: string | null; iconColor?: string | null }
  | { kind: 'invited'; invitation: CommonsInvitationDetail };

/** A family (invite-only commons) invitation that admits someone, not one that asks them to apply. */
export function isFamilyInvitation(invitation: CommonsInvitationDetail) {
  return invitation.purpose === 'DIRECT_JOIN' && invitation.commons.joinPolicy === 'INVITE_ONLY';
}

/**
 * The newcomer's own families, shown first on onboarding's last step so
 * someone invited by family lands with them instead of in the wider
 * Cahootz Commons. Families they already belong to go straight in; a
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
          if (coop.accessStatus === 'ACTIVE' && coop.joinPolicy === 'INVITE_ONLY') {
            next.push({
              kind: 'member',
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
      <Text style={styles.heading}>{families.length === 1 ? 'Your family' : 'Your families'}</Text>
      {families.map((family) => {
        const isMember = family.kind === 'member';
        const name = isMember ? family.name : family.invitation.commons.name;
        const label = isMember ? `Go to ${name}` : `Join ${name}`;
        const detail = isMember
          ? "You're already in. Head to your family's private space."
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
            style={[styles.card, disabled && styles.cardDisabled]}
          >
            <IconAvatar
              emoji={isMember ? family.iconEmoji : family.invitation.commons.iconEmoji}
              color={(isMember ? family.iconColor : family.invitation.commons.iconColor) || '#FF6B00'}
              fallbackText={name}
              size={48}
            />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{label}</Text>
              <Text style={styles.cardText}>{detail}</Text>
            </View>
            <ArrowRight color="#FFFFFF" size={20} strokeWidth={2.6} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
    marginBottom: 8,
  },
  heading: {
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    backgroundColor: '#FF6B00',
    padding: 14,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  cardText: {
    color: '#FFF7ED',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});

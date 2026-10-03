import { useCallback, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight, Mail } from 'lucide-react-native';

import { IconAvatar } from '@/components/icon-avatar';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type CommonsInvitationDetail } from '@/lib/api';

/**
 * Invitations waiting for the signed-in account (matched by its email or
 * phone), so a recipient finds theirs just by signing in - no link needed.
 * Renders nothing when there aren't any.
 */
export function CommonsInvitationsCard({
  onOpen,
}: {
  /** Overrides navigation, e.g. to finish the onboarding wizard first. */
  onOpen?: (invitation: CommonsInvitationDetail) => void;
}) {
  const { sessionToken } = useAuth();
  const [invitations, setInvitations] = useState<CommonsInvitationDetail[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!sessionToken) {
        setInvitations([]);
        return;
      }
      let active = true;
      api
        .listMyCommonsInvitations(sessionToken)
        .then((result) => {
          if (active) setInvitations(result.invitations);
        })
        .catch((error) => console.warn('Could not load commons invitations:', error));
      return () => {
        active = false;
      };
    }, [sessionToken]),
  );

  if (invitations.length === 0) return null;

  return (
    <View className="gap-2">
      {invitations.map((invitation) => (
        <TouchableOpacity
          key={invitation.invitationId}
          onPress={() =>
            onOpen
              ? onOpen(invitation)
              : router.push(`/invitations/${invitation.invitationId}` as any)
          }
          className="flex-row items-center gap-3 rounded-2xl border bg-white p-4"
          style={{ borderColor: '#FED7AA' }}
          accessibilityLabel={`Open invitation to ${invitation.commons.name}`}
        >
          <IconAvatar
            emoji={invitation.commons.iconEmoji}
            color={invitation.commons.iconColor || '#FF6B00'}
            fallbackText={invitation.commons.name}
            size={44}
          />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-1">
              <Mail size={12} color="#FF6B00" />
              <Text className="text-xs font-black uppercase" style={{ color: '#FF6B00' }}>
                {invitation.purpose === 'APPLY' ? 'Invited to apply' : "You're invited"}
              </Text>
            </View>
            <Text className="mt-0.5 text-base font-black text-gray-950">
              {invitation.inviterName} invited you to{' '}
              {invitation.purpose === 'APPLY' ? 'apply to' : 'join'} {invitation.commons.name}
            </Text>
          </View>
          <ChevronRight size={18} color="#FF6B00" />
        </TouchableOpacity>
      ))}
    </View>
  );
}

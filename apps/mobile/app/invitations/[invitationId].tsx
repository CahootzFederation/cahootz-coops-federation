import { useLocalSearchParams } from 'expo-router';

import { CommonsInvitationView } from '@/components/commons-invitation-view';

// An invitation addressed to the signed-in account (from Circle View, the
// onboarding wizard or an alert), opened without needing the link.
export default function MyInvitationScreen() {
  const { invitationId } = useLocalSearchParams<{ invitationId?: string }>();
  return <CommonsInvitationView invitationId={invitationId} />;
}

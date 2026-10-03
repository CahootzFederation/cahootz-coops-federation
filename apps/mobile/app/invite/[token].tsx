import { useLocalSearchParams } from 'expo-router';

import { CommonsInvitationView } from '@/components/commons-invitation-view';

// Opened from an invitation link (commons://invite/<token>). Works signed
// out too: the recipient sees the invitation, then signs in to act on it.
export default function InviteLinkScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return <CommonsInvitationView token={token} />;
}

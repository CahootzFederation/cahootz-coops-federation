import { useLocalSearchParams } from 'expo-router';

import CircleView from '@/components/circle-view';

export default function CommonsScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || 'cahootz';

  // Circle View is the Commons tab's landing for everyone. Signed-in members
  // see their circles, chatting counts, and the welcome lounge; a signed-out
  // visitor sees just the General card (CircleView skips the authenticated
  // circles fetch when there's no session) - tapping it opens the same
  // general feed with its own sign-in prompt, exactly as before.
  return <CircleView coopId={coopId} />;
}

import { router, useLocalSearchParams } from 'expo-router';

import CommonsAiEntry from '@/components/commons-ai-entry';

export default function CommonsPostsScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || 'cahootz';

  return (
    <CommonsAiEntry
      feedCoopId={coopId}
      onMessagesPress={() => router.push('/(tabs)/messages' as any)}
      onSignInPress={() => router.push({ pathname: '/', params: { entry: 'sign-in' } } as any)}
    />
  );
}

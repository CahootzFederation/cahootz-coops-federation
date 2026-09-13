import { router, useLocalSearchParams } from 'expo-router';

import CommonsAiEntry from '@/components/commons-ai-entry';

export default function CommonsScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();

  return (
    <CommonsAiEntry
      feedCoopId={params.coopId || 'cahootz'}
      onMessagesPress={() => router.push('/(tabs)/messages')}
      onSignInPress={() => router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any)}
    />
  );
}

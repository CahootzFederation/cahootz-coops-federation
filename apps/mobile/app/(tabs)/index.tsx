import { router } from 'expo-router';

import CommonsAiEntry from '@/components/commons-ai-entry';

export default function CommonsScreen() {
  return (
    <CommonsAiEntry
      onMessagesPress={() => router.push('/(tabs)/messages')}
      onSignInPress={() => router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any)}
    />
  );
}

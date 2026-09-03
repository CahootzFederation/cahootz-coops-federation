import { router } from 'expo-router';

import CommonsAiEntry from '@/components/commons-ai-entry';

export default function CommonsScreen() {
  return (
    <CommonsAiEntry
      onMessagesPress={() => router.push('/(tabs)/messages')}
      onSignInPress={() => router.push({ pathname: '/', params: { entry: 'sign-in' } })}
    />
  );
}

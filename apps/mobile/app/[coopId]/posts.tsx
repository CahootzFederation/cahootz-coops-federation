import { router, useLocalSearchParams } from 'expo-router';
import CommonsAiEntry from '@/components/commons-ai-entry';

export default function CommonsPostsScreen() {
  const params = useLocalSearchParams<{ coopId?: string; circleId?: string }>();
  const coopId = params.coopId || 'cahootz';

  return (
    <CommonsAiEntry
      feedCoopId={coopId}
      feedCircleId={params.circleId}
      onMessagesPress={() => router.push('/(tabs)/messages' as any)}
      onSignInPress={() =>
        router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any)
      }
    />
  );
}

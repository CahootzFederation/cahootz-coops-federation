import { router, useLocalSearchParams } from 'expo-router';
import CommonsAiEntry from '@/components/commons-ai-entry';
import { useAuth } from '@/contexts/auth-context';
import { useCirclePresence } from '@/lib/use-circle-presence';

export default function CommonsPostsScreen() {
  const params = useLocalSearchParams<{ coopId?: string; circleId?: string }>();
  const coopId = params.coopId || 'cahootz';
  const { sessionToken } = useAuth();

  const isGeneralFeed = !params.circleId || params.circleId === `general:${coopId}`;
  useCirclePresence(isGeneralFeed ? undefined : params.circleId, sessionToken);

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

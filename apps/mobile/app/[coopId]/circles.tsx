import { router, useLocalSearchParams } from 'expo-router';

import CircleView from '@/components/circle-view';

// Inside the Circle Hall: every circle in this Commons (the circles screen
// that used to be the Commons tab). The street links here.
export default function CircleHallScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || 'cahootz';
  return (
    <CircleView
      coopId={coopId}
      onBackToStreet={() => router.replace({ pathname: '/(tabs)', params: { coopId } } as any)}
    />
  );
}

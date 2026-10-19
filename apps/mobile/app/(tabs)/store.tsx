import { Redirect } from 'expo-router';

export default function LegacyStoreRoute() {
  return <Redirect href={{ pathname: '/(tabs)/board', params: { lane: 'marketplace' } } as any} />;
}

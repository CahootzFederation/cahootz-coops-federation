import { Redirect } from 'expo-router';

export default function BuyScreen() {
  return <Redirect href={{ pathname: '/(tabs)/board', params: { lane: 'marketplace' } } as any} />;
}

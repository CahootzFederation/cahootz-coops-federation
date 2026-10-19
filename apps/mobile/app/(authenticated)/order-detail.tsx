import { useLocalSearchParams } from 'expo-router';
import OrderDetailHybrid from '@/components/order-detail-hybrid';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams();
  return <OrderDetailHybrid orderId={id as string} />;
}

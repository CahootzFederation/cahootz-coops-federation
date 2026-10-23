import { View, TouchableOpacity } from 'react-native';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';

/** Empty results are distinct from loading and failure. Actions must be real. */
export function EmptyState({ title, message, action }: {
  title: string; message: string; action?: { label: string; onPress: () => void };
}) {
  return <View style={{ padding: 24, borderWidth: 1, borderColor: DESIGN.border, borderRadius: DESIGN.radius, backgroundColor: DESIGN.paper, gap: 8 }}>
    <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700', color: DESIGN.ink }}>{title}</Text>
    <Text style={{ fontSize: 14, lineHeight: 21, color: DESIGN.muted }}>{message}</Text>
    {action && <TouchableOpacity accessibilityRole="button" onPress={action.onPress}
      style={{ minHeight: DESIGN.controlHeight, alignSelf: 'flex-start', justifyContent: 'center' }}>
      <Text style={{ color: DESIGN.actionText, fontWeight: '700' }}>{action.label}</Text>
    </TouchableOpacity>}
  </View>;
}

import { View, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';

export function DetailHeader({ title, parent, onBack }: { title: string; parent: string; onBack: () => void }) {
  return <SafeAreaView edges={['top']} style={{ backgroundColor: DESIGN.paper }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: DESIGN.gutter, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: DESIGN.border }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Back to ${parent}`} onPress={onBack} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><ArrowLeft size={22} color={DESIGN.ink} /></TouchableOpacity>
      <View style={{ flex: 1 }}><Text style={{ color: DESIGN.muted, fontSize: 12 }}>{parent}</Text><Text accessibilityRole="header" style={{ color: DESIGN.ink, fontSize: 18, fontWeight: '700' }}>{title}</Text></View>
    </View>
  </SafeAreaView>;
}

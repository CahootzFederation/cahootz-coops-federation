import React from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Lock, Plus, Users } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { addPersonalSpace, listPersonalSpaces, type PersonalSpace } from '@/lib/personal-social-store';

const SPACES_THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SpacesScreen() {
  const { user, isLoading, isAuthenticated, sessionToken } = useAuth();
  const [spaces, setSpaces] = React.useState<PersonalSpace[]>([]);
  const [name, setName] = React.useState('');
  const [purpose, setPurpose] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;

    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  React.useEffect(() => {
    if (!user?.email) return;

    listPersonalSpaces(user.email)
      .then(setSpaces)
      .catch((error) => console.warn('Could not load spaces:', error));
  }, [user?.email]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)/wallet' as any);
  };

  const createSpace = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isSaving) return;

    setIsSaving(true);
    try {
      const next = await addPersonalSpace(user?.email, trimmedName, purpose.trim());
      setSpaces(next);
      setName('');
      setPurpose('');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !isAuthenticated || !sessionToken) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <ActivityIndicator size="small" color={SPACES_THEME.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: SPACES_THEME.paper }}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="border-b bg-white px-3 pt-3 pb-2" style={{ borderColor: SPACES_THEME.border }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={handleBack}
              className="h-9 w-9 items-center justify-center rounded-full border bg-white"
              style={{ borderColor: SPACES_THEME.border }}
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={18} color="#1F2937" strokeWidth={2.6} />
            </TouchableOpacity>
            <View className="min-w-0 flex-1">
              <Text className="text-[10px] font-black uppercase text-gray-500">Small Groups</Text>
              <Text className="text-base font-black text-gray-950" numberOfLines={1}>
                Private Spaces
              </Text>
            </View>
            <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: SPACES_THEME.primary }}>
              <Users size={17} color="#FFFFFF" />
            </View>
          </View>
        </View>

        <View className="px-5 py-4">
          <View className="rounded-2xl border bg-white p-5" style={{ borderColor: SPACES_THEME.border }}>
            <Text className="text-xl font-black text-gray-950">Start Small</Text>
            <Text className="mt-2 text-sm font-semibold leading-5 text-gray-500">
              Create a private or invite-only space before something needs to become a full commons.
            </Text>
          </View>

          <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: SPACES_THEME.border }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Space name"
              placeholderTextColor={SPACES_THEME.muted}
              className="rounded-2xl border bg-gray-50 px-3 py-3 text-sm text-gray-900"
              style={{ borderColor: SPACES_THEME.border }}
            />
            <TextInput
              value={purpose}
              onChangeText={setPurpose}
              placeholder="What is this group for?"
              placeholderTextColor={SPACES_THEME.muted}
              multiline
              className="mt-3 min-h-20 rounded-2xl border bg-gray-50 px-3 py-3 text-sm text-gray-900"
              style={{ borderColor: SPACES_THEME.border, textAlignVertical: 'top' }}
            />
            <TouchableOpacity
              onPress={() => void createSpace()}
              disabled={isSaving || !name.trim()}
              className="mt-3 flex-row items-center justify-center gap-2 rounded-2xl py-3"
              style={{ backgroundColor: SPACES_THEME.primary, opacity: isSaving || !name.trim() ? 0.6 : 1 }}
              activeOpacity={0.82}
            >
              {isSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Plus size={16} color="#FFFFFF" />}
              <Text className="text-sm font-black text-white">Create Space</Text>
            </TouchableOpacity>
          </View>

          <View className="mt-4 gap-3">
            {spaces.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-gray-300 bg-white p-5">
                <Text className="text-base font-black text-gray-950">No spaces yet</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  A space can start as just you and a few people, then graduate when it has momentum.
                </Text>
              </View>
            ) : null}

            {spaces.map((space) => (
              <View key={space.id} className="rounded-2xl border bg-white p-4" style={{ borderColor: SPACES_THEME.border }}>
                <View className="flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: SPACES_THEME.primarySoft }}>
                    <Lock size={18} color={SPACES_THEME.primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="text-base font-black text-gray-950" numberOfLines={1}>
                        {space.name}
                      </Text>
                      <Text className="text-xs font-semibold text-gray-400">{formatDate(space.createdAt)}</Text>
                    </View>
                    <Text className="mt-1 text-sm leading-5 text-gray-600">
                      {space.purpose || 'Invite-only coordination space'}
                    </Text>
                    <Text className="mt-2 text-xs font-black uppercase text-gray-400">
                      {space.privacy.replace('-', ' ')}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

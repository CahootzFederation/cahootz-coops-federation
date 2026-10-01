import { useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Lock } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const THEME = {
  paper: '#F6F7F8',
  ink: '#111827',
  muted: '#6B7280',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  border: '#E5E7EB',
};

const ICONS = ['🏡', '🌳', '❤️', '🌻', '🍲', '🎉'];

/**
 * Starts a private, invite-only family commons. The creator becomes its
 * first steward and lands on the invite screen to bring family in.
 */
export default function CreateFamilyScreen() {
  const { sessionToken } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconEmoji, setIconEmoji] = useState(ICONS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!sessionToken || saving) return;
    if (name.trim().length < 2) {
      setError('Give your family space a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.createFamilyCommons(
        { name: name.trim(), description: description.trim() || undefined, iconEmoji },
        sessionToken,
      );
      router.replace({
        pathname: '/(authenticated)/commons-invites',
        params: { coopId: result.coopId },
      } as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start your family. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 }}>
        <View className="mb-4 flex-row items-center">
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/commons' as any))}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={THEME.ink} />
          </TouchableOpacity>
          <View className="ml-3">
            <Text className="text-xs font-black uppercase text-gray-500">Family</Text>
            <Text className="text-2xl font-black text-gray-950">Start a family</Text>
          </View>
        </View>

        <View
          className="mb-4 flex-row gap-3 rounded-2xl border p-4"
          style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}
        >
          <Lock size={18} color={THEME.primary} />
          <Text className="min-w-0 flex-1 text-sm leading-5 text-gray-800">
            A family is private and invite-only. It never shows up in Explore, and only people you
            invite, or whose request you approve, can see who&apos;s there or anything posted.
          </Text>
        </View>

        <View className="rounded-2xl border border-gray-200 bg-white p-4">
          <Text className="text-sm font-black text-gray-900">Family name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="The Robinson Family"
            placeholderTextColor={THEME.muted}
            maxLength={60}
            accessibilityLabel="Family name"
            className="mt-2 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
          />

          <Text className="mt-4 text-sm font-black text-gray-900">A short description (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Where we keep up with each other between reunions."
            placeholderTextColor={THEME.muted}
            maxLength={280}
            multiline
            accessibilityLabel="Family description"
            className="mt-2 min-h-20 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
            style={{ textAlignVertical: 'top' }}
          />

          <Text className="mt-4 text-sm font-black text-gray-900">Icon</Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {ICONS.map((icon) => (
              <TouchableOpacity
                key={icon}
                onPress={() => setIconEmoji(icon)}
                accessibilityLabel={`Use ${icon} icon`}
                accessibilityState={{ selected: iconEmoji === icon }}
                className="h-12 w-12 items-center justify-center rounded-xl border"
                style={{
                  borderColor: iconEmoji === icon ? THEME.primary : THEME.border,
                  backgroundColor: iconEmoji === icon ? THEME.primarySoft : '#FFFFFF',
                }}
              >
                <Text style={{ fontSize: 22, lineHeight: 28 }}>{icon}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {error ? <Text className="mt-4 text-sm font-semibold text-red-700">{error}</Text> : null}

          <TouchableOpacity
            onPress={create}
            disabled={saving}
            className="mt-5 items-center rounded-xl py-3"
            style={{ backgroundColor: THEME.primary, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="font-black text-white">Create family</Text>
            )}
          </TouchableOpacity>
          <Text className="mt-3 text-center text-xs leading-4 text-gray-500">
            You&apos;ll be its first steward: you invite family members, approve requests and can make
            others stewards too.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

import React from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CheckCircle2, Image as ImageIcon, Smile, X } from 'lucide-react-native';

import { COLOR_OPTIONS, EMOJI_OPTIONS } from '@/components/emoji-color-picker';
import { PersonAvatar } from '@/components/person-avatar';
import { Text } from '@/components/ui/text';
import { api, type PersonalPageProfile } from '@/lib/api';

const BIO_MAX_LENGTH = 5000;
const PRIMARY = '#FF6B00';

type AvatarMode = 'photo' | 'emoji' | 'initials';

type PendingPhoto = { uri: string; mimeType: string; fileName?: string | null; width?: number; height?: number; sizeBytes?: number | null };

export type PersonalProfileFields = Pick<PersonalPageProfile, 'bio' | 'avatarUrl' | 'avatarEmoji' | 'avatarColor'>;

export function EditPersonalProfileSheet({
  visible,
  name,
  profile,
  sessionToken,
  onClose,
  onSaved,
}: {
  visible: boolean;
  name: string;
  profile: PersonalProfileFields | null;
  sessionToken: string | null;
  onClose: () => void;
  onSaved: (fields: PersonalProfileFields) => void;
}) {
  const [bio, setBio] = React.useState('');
  const [mode, setMode] = React.useState<AvatarMode>('initials');
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = React.useState<PendingPhoto | null>(null);
  const [emoji, setEmoji] = React.useState<string>(EMOJI_OPTIONS[0]);
  const [color, setColor] = React.useState<string>(COLOR_OPTIONS[0]);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  // Reset the draft from the saved profile each time the sheet opens.
  React.useEffect(() => {
    if (!visible) return;
    setBio(profile?.bio || '');
    setAvatarUrl(profile?.avatarUrl || null);
    setPendingPhoto(null);
    setEmoji(profile?.avatarEmoji || EMOJI_OPTIONS[0]);
    setColor(profile?.avatarColor || COLOR_OPTIONS[0]);
    setMode(profile?.avatarUrl ? 'photo' : profile?.avatarEmoji ? 'emoji' : 'initials');
    setError('');
  }, [visible, profile]);

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setPendingPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType || 'image/jpeg',
      fileName: asset.fileName,
      width: asset.width,
      height: asset.height,
      sizeBytes: asset.fileSize ?? null,
    });
    setMode('photo');
  };

  const previewPhoto = mode === 'photo' ? pendingPhoto?.uri || avatarUrl : null;

  const save = async () => {
    if (isSaving) return;
    if (mode === 'photo' && !previewPhoto) {
      setError('Choose a photo, or pick an emoji instead.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      let nextAvatarUrl = mode === 'photo' ? avatarUrl : null;
      if (mode === 'photo' && pendingPhoto) {
        const uploaded = await api.uploadCommonsPostMedia({
          coopId: 'personal-page',
          uploadType: 'profile',
          uri: pendingPhoto.uri,
          fileName: pendingPhoto.fileName,
          mimeType: pendingPhoto.mimeType,
          mediaType: 'image',
          width: pendingPhoto.width,
          height: pendingPhoto.height,
          sizeBytes: pendingPhoto.sizeBytes,
        });
        nextAvatarUrl = uploaded.url;
      }

      const saved = await api.updatePersonalPageProfile(
        {
          bio: bio.trim(),
          avatarUrl: nextAvatarUrl,
          avatarEmoji: mode === 'emoji' ? emoji : null,
          avatarColor: mode === 'emoji' ? color : null,
        },
        sessionToken,
      );
      onSaved(saved);
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/40"
      >
        <View className="rounded-t-3xl bg-white px-4 pb-8 pt-5" style={{ maxHeight: '90%' }}>
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-xl font-black text-gray-950">Edit profile</Text>
            <TouchableOpacity
              onPress={onClose}
              className="h-9 w-9 items-center justify-center rounded-full bg-gray-100"
              accessibilityLabel="Close"
            >
              <X size={18} color="#374151" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View className="mb-4 items-center">
              <PersonAvatar
                name={name}
                avatarUrl={previewPhoto}
                avatarEmoji={mode === 'emoji' ? emoji : null}
                avatarColor={mode === 'emoji' ? color : null}
                size={80}
              />
            </View>

            <View className="mb-4 flex-row gap-2">
              <ModeButton
                label="Upload photo"
                icon={<ImageIcon size={15} color={mode === 'photo' ? PRIMARY : '#475569'} />}
                selected={mode === 'photo'}
                onPress={() => void pickPhoto()}
              />
              <ModeButton
                label="Use emoji"
                icon={<Smile size={15} color={mode === 'emoji' ? PRIMARY : '#475569'} />}
                selected={mode === 'emoji'}
                onPress={() => setMode('emoji')}
              />
              <ModeButton label="Initials" selected={mode === 'initials'} onPress={() => setMode('initials')} />
            </View>

            {mode === 'emoji' ? (
              <>
                <Text className="mb-2 text-xs font-black uppercase text-gray-500">Emoji</Text>
                <View className="mb-4 flex-row flex-wrap gap-2">
                  {EMOJI_OPTIONS.map((option) => {
                    const selected = emoji === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        onPress={() => setEmoji(option)}
                        className="h-11 w-11 items-center justify-center rounded-xl border"
                        style={{
                          borderColor: selected ? PRIMARY : '#E5E7EB',
                          backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
                        }}
                        accessibilityLabel={`Use emoji ${option}`}
                        accessibilityState={{ selected }}
                      >
                        <Text style={{ fontSize: 20 }}>{option}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text className="mb-2 text-xs font-black uppercase text-gray-500">Color</Text>
                <View className="mb-4 flex-row flex-wrap gap-3">
                  {COLOR_OPTIONS.map((option) => {
                    const selected = color === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        onPress={() => setColor(option)}
                        className="h-10 w-10 items-center justify-center rounded-full"
                        style={{ backgroundColor: option, borderWidth: selected ? 3 : 0, borderColor: '#111827' }}
                        accessibilityLabel={`Use color ${option}`}
                      >
                        {selected ? <CheckCircle2 size={16} color="#FFFFFF" /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}

            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-xs font-black uppercase text-gray-500">Bio</Text>
              <Text className="text-xs font-semibold text-gray-400">
                {bio.length}/{BIO_MAX_LENGTH}
              </Text>
            </View>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Tell people who you are and what you're working on"
              placeholderTextColor="#94A3B8"
              multiline
              maxLength={BIO_MAX_LENGTH}
              accessibilityLabel="Bio"
              className="min-h-24 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900"
              style={{ textAlignVertical: 'top' }}
            />

            {error ? <Text className="mt-3 text-sm font-semibold text-red-600">{error}</Text> : null}
          </ScrollView>

          <TouchableOpacity
            onPress={() => void save()}
            disabled={isSaving}
            className="mt-4 flex-row items-center justify-center rounded-xl px-4 py-3"
            style={{ backgroundColor: PRIMARY, opacity: isSaving ? 0.6 : 1 }}
            accessibilityRole="button"
            accessibilityLabel="Save profile"
          >
            {isSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <Text className="ml-2 text-center font-black text-white">{isSaving ? 'Saving…' : 'Save profile'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ModeButton({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-2.5"
      style={{ borderColor: selected ? PRIMARY : '#E5E7EB', backgroundColor: selected ? '#FFF7ED' : '#FFFFFF' }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      {icon}
      <Text className="text-xs font-black" style={{ color: selected ? PRIMARY : '#475569' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

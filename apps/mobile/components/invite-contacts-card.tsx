import { useMemo, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowRight, UserPlus } from 'lucide-react-native';

import { ContactInviteSheet } from '@/components/contact-invite-sheet';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics';
import { appInviteMessage, loadInviteModules } from '@/lib/contact-invite';

/**
 * Onboarding's "bring people with you" card. On a phone it opens a
 * checklist of contacts and texts each chosen person from the member's own
 * number (see ContactInviteSheet); nothing is uploaded. Where that isn't
 * possible (web, or a binary without expo-contacts / expo-sms) it shares or
 * copies the same invitation instead.
 */
export function InviteContactsCard({ source }: { source: string }) {
  const modules = useMemo(() => loadInviteModules(Platform.OS), []);
  const pickContact = modules !== null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const shareInvite = async () => {
    const message = appInviteMessage();
    try {
      if (Platform.OS !== 'web') {
        await Share.share({ message });
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ text: message });
        return;
      }
    } catch {
      // Fall through to copying.
    }
    await Clipboard.setStringAsync(message);
    setNotice('Invitation copied. Paste it into a text or email.');
  };

  const onPress = async () => {
    if (busy) return;
    setNotice('');
    track('contact_invite_started', { source, picker: pickContact });
    if (modules) {
      setSheetOpen(true);
      return;
    }
    setBusy(true);
    try {
      await shareInvite();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pickContact ? 'Invite from your contacts' : 'Share an invitation'}
        disabled={busy}
        onPress={() => void onPress()}
        style={[styles.card, busy && styles.disabled]}
      >
        <View style={styles.icon}>
          <UserPlus color="#047857" size={22} strokeWidth={2.4} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{pickContact ? 'Invite from your contacts' : 'Invite people you know'}</Text>
          <Text style={styles.text}>
            {pickContact
              ? 'Choose people and text each of them an invitation from your number. Your contacts stay on your phone.'
              : 'Send a friend or relative an invitation to join you here.'}
          </Text>
        </View>
        <ArrowRight color="#047857" size={20} strokeWidth={2.6} />
      </Pressable>
      {!pickContact ? (
        <Text style={styles.hint}>
          {Platform.OS === 'web'
            ? 'Choosing from your contacts works in the Cahootz app for iPhone and Android. Here, tap above to copy an invitation you can paste into a text or email.'
            : 'Update the app to choose from your contacts. For now, tap above to share an invitation.'}
        </Text>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {modules ? (
        <ContactInviteSheet
          visible={sheetOpen}
          modules={modules}
          source={source}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  disabled: { opacity: 0.6 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '800', color: '#111827' },
  text: { marginTop: 2, fontSize: 14, lineHeight: 20, color: '#4B5563' },
  hint: { marginTop: -4, marginBottom: 12, fontSize: 13, lineHeight: 18, color: '#6B7280' },
  notice: { marginTop: -4, marginBottom: 12, fontSize: 14, fontWeight: '600', color: '#047857' },
});

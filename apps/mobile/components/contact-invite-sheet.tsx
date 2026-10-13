import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Search, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics';
import {
  appInviteMessage,
  filterContacts,
  loadInviteModules,
  textableContacts,
  type TextableContact,
} from '@/lib/contact-invite';

type Modules = NonNullable<ReturnType<typeof loadInviteModules>>;

type Phase =
  | { kind: 'loading' }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'choosing' }
  | { kind: 'sending'; index: number }
  // The person closed a text without sending it; wait for them to decide.
  | { kind: 'paused'; index: number }
  | { kind: 'done'; sent: number; total: number };

/**
 * Choose several contacts and text each one an invitation, one at a time,
 * from the person's own phone number. Each text opens prefilled in the
 * system composer, so nothing is sent without them tapping Send, and nobody
 * sees anyone else's number. Contacts never leave the device.
 */
export function ContactInviteSheet({
  visible,
  modules,
  source,
  onClose,
}: {
  visible: boolean;
  modules: Modules;
  source: string;
  onClose: () => void;
}) {
  const { Contacts, SMS } = modules;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [contacts, setContacts] = useState<TextableContact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [smsAvailable, setSmsAvailable] = useState(true);
  const [error, setError] = useState('');
  const sentCount = useRef(0);
  const stopped = useRef(false);

  const load = async () => {
    setPhase({ kind: 'loading' });
    setError('');
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        setPhase({ kind: 'denied', canAskAgain: permission.canAskAgain });
        return;
      }
      const [{ data }, available] = await Promise.all([
        Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName, Contacts.Fields.PhoneNumbers],
        }),
        SMS.isAvailableAsync(),
      ]);
      setContacts(textableContacts(data));
      setSmsAvailable(available);
      setPhase({ kind: 'choosing' });
    } catch (err) {
      console.error('Could not load contacts:', err);
      setError("We couldn't open your contacts.");
      setPhase({ kind: 'choosing' });
    }
  };

  useEffect(() => {
    if (!visible) return;
    setSelected([]);
    setQuery('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const shown = useMemo(() => filterContacts(contacts, query), [contacts, query]);
  const chosen = useMemo(
    () => selected.map((id) => contacts.find((contact) => contact.id === id)).filter(Boolean) as TextableContact[],
    [selected, contacts],
  );

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  // Opens the composer for chosen[index], then moves on by itself unless the
  // person backed out of that one.
  const textFrom = async (index: number) => {
    if (stopped.current) return;
    if (index >= chosen.length) {
      track('contact_invite_batch_finished', { source, sent: sentCount.current, total: chosen.length });
      setPhase({ kind: 'done', sent: sentCount.current, total: chosen.length });
      return;
    }
    setPhase({ kind: 'sending', index });
    const person = chosen[index];
    try {
      const { result } = await SMS.sendSMSAsync([person.phone], appInviteMessage(person.name));
      if (result === 'cancelled') {
        setPhase({ kind: 'paused', index });
        return;
      }
      // Android reports 'unknown' even when sent; count it, since the person chose to send.
      sentCount.current += 1;
    } catch (err) {
      console.error('Could not open a text:', err);
      setError(`We couldn't open a text to ${person.name}.`);
      setPhase({ kind: 'paused', index });
      return;
    }
    // iOS needs the composer fully dismissed before presenting the next one.
    setTimeout(() => void textFrom(index + 1), 700);
  };

  const startTexting = () => {
    if (chosen.length === 0) return;
    stopped.current = false;
    sentCount.current = 0;
    setError('');
    track('contact_invite_batch_started', { source, count: chosen.length });
    void textFrom(0);
  };

  const stop = () => {
    stopped.current = true;
    setPhase({ kind: 'done', sent: sentCount.current, total: chosen.length });
  };

  const openShareSheet = async () => {
    try {
      await Share.share({ message: appInviteMessage() });
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  // iOS can't show the share sheet over this modal, so close it first and
  // share once it has finished dismissing (see onDismiss below).
  const shareAfterClose = useRef(false);
  const shareInstead = () => {
    if (Platform.OS !== 'ios') {
      void openShareSheet();
      return;
    }
    shareAfterClose.current = true;
    stopped.current = true;
    onClose();
  };

  const close = () => {
    stopped.current = true;
    onClose();
  };

  const renderBody = () => {
    switch (phase.kind) {
      case 'loading':
        return (
          <View style={styles.center}>
            <ActivityIndicator color="#FF6B00" />
          </View>
        );
      case 'denied':
        return (
          <View style={styles.center}>
            <Text style={styles.heading}>Allow contacts to choose people</Text>
            <Text style={styles.body}>
              Cahootz only reads your contacts on this phone to show this list. Nothing is uploaded.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.primary}
              onPress={() => (phase.canAskAgain ? void load() : void Linking.openSettings())}
            >
              <Text style={styles.primaryText}>{phase.canAskAgain ? 'Allow contacts' : 'Open Settings'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondary} onPress={shareInstead}>
              <Text style={styles.secondaryText}>Share an invitation instead</Text>
            </Pressable>
          </View>
        );
      case 'sending':
        return (
          <View style={styles.center}>
            <ActivityIndicator color="#FF6B00" />
            <Text style={[styles.heading, { marginTop: 16 }]}>
              Texting {chosen[phase.index]?.name} ({phase.index + 1} of {chosen.length})
            </Text>
            <Text style={styles.body}>Tap Send in Messages. The next one opens on its own.</Text>
            <Pressable accessibilityRole="button" style={styles.secondary} onPress={stop}>
              <Text style={styles.secondaryText}>Stop after this one</Text>
            </Pressable>
          </View>
        );
      case 'paused':
        return (
          <View style={styles.center}>
            <Text style={styles.heading}>
              {chosen[phase.index]?.name} wasn&apos;t texted ({phase.index + 1} of {chosen.length})
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => void textFrom(phase.index)}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
            {phase.index + 1 < chosen.length ? (
              <Pressable
                accessibilityRole="button"
                style={styles.secondary}
                onPress={() => {
                  setError('');
                  void textFrom(phase.index + 1);
                }}
              >
                <Text style={styles.secondaryText}>Skip to {chosen[phase.index + 1]?.name}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" style={styles.secondary} onPress={stop}>
              <Text style={styles.secondaryText}>Stop</Text>
            </Pressable>
          </View>
        );
      case 'done':
        return (
          <View style={styles.center}>
            <Text style={styles.heading}>
              {phase.sent === 0
                ? 'No invitations sent'
                : `Invited ${phase.sent} ${phase.sent === 1 ? 'person' : 'people'}`}
            </Text>
            <Text style={styles.body}>
              {phase.sent === phase.total
                ? 'Thanks for bringing people with you.'
                : `${phase.total - phase.sent} of the people you chose weren't texted.`}
            </Text>
            <Pressable accessibilityRole="button" style={styles.primary} onPress={close}>
              <Text style={styles.primaryText}>Done</Text>
            </Pressable>
          </View>
        );
      case 'choosing':
        return (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.search}>
              <Search color="#9CA3AF" size={18} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search contacts"
                placeholderTextColor="#9CA3AF"
                autoCorrect={false}
                accessibilityLabel="Search contacts"
                style={styles.searchInput}
              />
            </View>
            <FlatList
              data={shown}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={[styles.body, { textAlign: 'center', marginTop: 24 }]}>
                  {contacts.length === 0 ? 'No contacts with a phone number.' : 'No matches.'}
                </Text>
              }
              renderItem={({ item }) => {
                const isOn = selected.includes(item.id);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isOn }}
                    aria-checked={isOn}
                    accessibilityLabel={item.name}
                    onPress={() => toggle(item.id)}
                    style={styles.row}
                  >
                    <View style={[styles.check, isOn && styles.checkOn]}>
                      {isOn ? <Check color="#FFFFFF" size={14} strokeWidth={3} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.rowPhone} numberOfLines={1}>{item.phone}</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
            <View style={styles.footer}>
              {smsAvailable ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={chosen.length === 0}
                  onPress={startTexting}
                  style={[styles.primary, chosen.length === 0 && styles.disabled]}
                >
                  <Text style={styles.primaryText}>
                    {chosen.length === 0
                      ? 'Choose people to text'
                      : `Text ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}`}
                  </Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" onPress={shareInstead} style={styles.primary}>
                  <Text style={styles.primaryText}>Share an invitation</Text>
                </Pressable>
              )}
              <Text style={styles.footnote}>
                Each text opens in Messages from your number, one person at a time. They won&apos;t see each other.
              </Text>
            </View>
          </>
        );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
      onDismiss={() => {
        if (!shareAfterClose.current) return;
        shareAfterClose.current = false;
        void openShareSheet();
      }}
    >
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Invite from contacts</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={styles.close}>
            <X color="#111827" size={20} />
          </Pressable>
        </View>
        {renderBody()}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontSize: 20, fontWeight: '900', color: '#111827' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'stretch', justifyContent: 'center', paddingHorizontal: 24 },
  heading: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center' },
  body: { marginTop: 8, fontSize: 15, lineHeight: 21, color: '#4B5563', textAlign: 'center' },
  error: { marginHorizontal: 20, marginBottom: 8, fontSize: 14, fontWeight: '600', color: '#B91C1C' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 16, color: '#111827' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: '#FF6B00', borderColor: '#FF6B00' },
  rowName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  rowPhone: { fontSize: 13, color: '#6B7280' },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F2F5' },
  primary: {
    minHeight: 54,
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: '#FF6B00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  secondary: { minHeight: 46, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#64748B', fontSize: 15, fontWeight: '800' },
  footnote: { marginTop: 8, marginBottom: 8, fontSize: 12, lineHeight: 17, color: '#6B7280', textAlign: 'center' },
});

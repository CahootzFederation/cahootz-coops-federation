/**
 * Helpers for inviting someone picked from the device's address book.
 *
 * The native contact picker (expo-contacts) only exists in store builds that
 * include the module. Older binaries running a newer OTA update, and the web
 * build, don't have it, so the module is loaded lazily and every caller must
 * handle `null` from {@link loadContactPicker}.
 */

export const APP_INVITE_URL = 'https://cahootzcommons.com';

export interface PickedContactLike {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emails?: Array<{ email?: string | null; isPrimary?: boolean }> | null;
  phoneNumbers?: Array<{ number?: string | null; isPrimary?: boolean }> | null;
}

export interface ContactInviteTarget {
  name: string;
  email: string | null;
  phone: string | null;
}

function preferPrimary<T extends { isPrimary?: boolean }>(items: T[], value: (item: T) => string): string | null {
  const usable = items.filter((item) => value(item).length > 0);
  const chosen = usable.find((item) => item.isPrimary) ?? usable[0];
  return chosen ? value(chosen) : null;
}

/** Pulls the name, best email and best phone number out of a picked contact. */
export function contactToInviteTarget(contact: PickedContactLike): ContactInviteTarget {
  const name =
    contact.name?.trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return {
    name,
    email: preferPrimary(contact.emails ?? [], (item) => item.email?.trim() ?? ''),
    phone: preferPrimary(contact.phoneNumbers ?? [], (item) => item.number?.trim() ?? ''),
  };
}

/** The text sent when inviting someone to the app itself (not to a commons). */
export function appInviteMessage(recipientName?: string) {
  const first = recipientName?.trim().split(/\s+/)[0];
  return `${first ? `Hey ${first}, ` : ''}I'm on Cahootz, where we pool what we have and build together. Come join me: ${APP_INVITE_URL}`;
}

type ContactPicker = () => Promise<PickedContactLike | null>;

/** The native contact picker, or null when this build can't show one. */
export function loadContactPicker(platform: string): ContactPicker | null {
  if (platform === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Contacts = require('expo-contacts') as typeof import('expo-contacts');
    return async () => {
      if (platform === 'android') {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') throw new Error('CONTACTS_PERMISSION_DENIED');
      }
      return Contacts.presentContactPickerAsync();
    };
  } catch {
    // This binary predates expo-contacts.
    return null;
  }
}

export interface TextableContact {
  id: string;
  name: string;
  phone: string;
}

/**
 * The address book reduced to people who can get a text: a name and one
 * phone number each (the primary one when marked), sorted by name, with
 * duplicate numbers dropped.
 */
export function textableContacts(
  contacts: Array<PickedContactLike & { id?: string | null }>,
): TextableContact[] {
  const seen = new Set<string>();
  const result: TextableContact[] = [];
  contacts.forEach((contact, index) => {
    const target = contactToInviteTarget(contact);
    if (!target.phone) return;
    const digits = target.phone.replace(/[^\d]/g, '');
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    result.push({ id: contact.id ?? `contact-${index}`, name: target.name || target.phone, phone: target.phone });
  });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Contacts whose name or number contains the search text. */
export function filterContacts(contacts: TextableContact[], query: string): TextableContact[] {
  const text = query.trim().toLowerCase();
  if (!text) return contacts;
  const digits = text.replace(/[^\d]/g, '');
  return contacts.filter(
    (contact) =>
      contact.name.toLowerCase().includes(text) ||
      (digits.length > 0 && contact.phone.replace(/[^\d]/g, '').includes(digits)),
  );
}

type ContactsModule = typeof import('expo-contacts');
type SmsModule = typeof import('expo-sms');

/** expo-contacts and expo-sms, or null where this build doesn't have them. */
export function loadInviteModules(platform: string): { Contacts: ContactsModule; SMS: SmsModule } | null {
  if (platform === 'web') return null;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const Contacts = require('expo-contacts') as ContactsModule;
    const SMS = require('expo-sms') as SmsModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    return { Contacts, SMS };
  } catch {
    return null;
  }
}

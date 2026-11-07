import { appInviteMessage, contactToInviteTarget, filterContacts, loadContactPicker, textableContacts } from '../contact-invite';

describe('contactToInviteTarget', () => {
  it('prefers primary entries and skips blanks', () => {
    expect(
      contactToInviteTarget({
        firstName: 'Ada',
        lastName: 'Lovelace',
        emails: [{ email: ' ' }, { email: 'a@x.com' }, { email: 'p@x.com', isPrimary: true }],
        phoneNumbers: [{ number: '(555) 123-4567' }],
      }),
    ).toEqual({ name: 'Ada Lovelace', email: 'p@x.com', phone: '(555) 123-4567' });
  });

  it('handles a contact with nothing to reach them', () => {
    expect(contactToInviteTarget({ name: 'Bo' })).toEqual({ name: 'Bo', email: null, phone: null });
  });
});

it('includes the app link in the invite message', () => {
  expect(appInviteMessage()).toContain('https://cahootzcommons.com');
});

it('has no picker on web', () => {
  expect(loadContactPicker('web')).toBeNull();
});

describe('textableContacts', () => {
  it('keeps one number per person, drops duplicates and number-less contacts, sorts by name', () => {
    expect(
      textableContacts([
        { id: '1', name: 'Zed', phoneNumbers: [{ number: '555-0001' }] },
        { id: '2', name: 'Amy', phoneNumbers: [{ number: '555-0002' }, { number: '555-0009', isPrimary: true }] },
        { id: '3', name: 'Zed again', phoneNumbers: [{ number: '(555) 0001' }] },
        { id: '4', name: 'Email only', emails: [{ email: 'e@x.com' }] },
      ]),
    ).toEqual([
      { id: '2', name: 'Amy', phone: '555-0009' },
      { id: '1', name: 'Zed', phone: '555-0001' },
    ]);
  });
});

describe('filterContacts', () => {
  const people = [
    { id: '1', name: 'Amy Lee', phone: '(555) 123-0000' },
    { id: '2', name: 'Bo', phone: '555-999-0000' },
  ];
  it('matches names and digits', () => {
    expect(filterContacts(people, 'amy').map((p) => p.id)).toEqual(['1']);
    expect(filterContacts(people, '5551230').map((p) => p.id)).toEqual(['1']);
    expect(filterContacts(people, ' ')).toHaveLength(2);
  });
});

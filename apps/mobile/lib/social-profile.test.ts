import { personDisplayHandle, personHandleFromName } from './social-profile';

describe('social profile handles', () => {
  it('preserves separators accepted by the identity editor', () => {
    expect(personHandleFromName('Maya_North-West')).toBe('maya_north-west');
    expect(personDisplayHandle('Maya_North-West')).toBe('@maya_north-west');
  });
});

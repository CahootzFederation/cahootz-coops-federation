import { drawerNavigationMethod } from './drawer-navigation';

describe('drawerNavigationMethod', () => {
  it('replaces the current route when switching to another Commons feed', () => {
    expect(drawerNavigationMethod('/artists/posts')).toBe('replace');
  });

  it.each(['/commons', '/commons/artists', '/(authenticated)/personal-page'])(
    'pushes non-feed destination %s onto the stack',
    (href) => {
      expect(drawerNavigationMethod(href)).toBe('push');
    },
  );
});

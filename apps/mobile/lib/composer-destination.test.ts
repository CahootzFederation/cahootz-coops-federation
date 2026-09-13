import {
  PERSONAL_PAGE_DESTINATION_ID,
  composerDestinationNavigation,
  reconcileComposerDestination,
} from './composer-destination';

const destinations = [{ id: 'cahootz' }, { id: 'artists' }];

describe('reconcileComposerDestination', () => {
  it('keeps a manually selected destination while it remains available', () => {
    expect(reconcileComposerDestination('artists', destinations)).toBe('artists');
  });

  it('uses the scoped feed as the preferred destination when that context is synchronized', () => {
    expect(reconcileComposerDestination('artists', destinations, 'cahootz')).toBe('cahootz');
  });

  it('falls back to the first available destination when the selection is no longer available', () => {
    expect(reconcileComposerDestination('neighborhood', destinations)).toBe('cahootz');
  });
});

describe('composerDestinationNavigation', () => {
  it('updates the current screen when a different Commons is selected', () => {
    expect(composerDestinationNavigation('cahootz', 'artists')).toEqual({
      method: 'setParams',
      params: { coopId: 'artists' },
    });
  });

  it('does not navigate when the selected Commons feed is already visible', () => {
    expect(composerDestinationNavigation('artists', 'artists')).toEqual({ method: 'stay' });
  });

  it('opens the personal feed for the Personal Page destination', () => {
    expect(composerDestinationNavigation('artists', PERSONAL_PAGE_DESTINATION_ID)).toEqual({
      method: 'replace',
      href: '/(authenticated)/personal-page',
    });
  });
});

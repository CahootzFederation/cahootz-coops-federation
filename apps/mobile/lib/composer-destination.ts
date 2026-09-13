type ComposerDestination = { id: string };

export const PERSONAL_PAGE_DESTINATION_ID = '__personal_page__';

export function composerDestinationNavigation(
  currentFeedCoopId: string,
  destinationId: string,
) {
  if (destinationId === PERSONAL_PAGE_DESTINATION_ID) {
    return {
      method: 'replace',
      href: '/(authenticated)/personal-page',
    } as const;
  }

  if (destinationId === currentFeedCoopId) {
    return { method: 'stay' } as const;
  }

  return {
    method: 'setParams',
    params: { coopId: destinationId },
  } as const;
}

export function reconcileComposerDestination(
  currentDestinationId: string,
  destinations: readonly ComposerDestination[],
  preferredDestinationId?: string,
) {
  if (
    preferredDestinationId &&
    destinations.some((destination) => destination.id === preferredDestinationId)
  ) {
    return preferredDestinationId;
  }

  if (destinations.some((destination) => destination.id === currentDestinationId)) {
    return currentDestinationId;
  }

  return destinations[0]?.id ?? currentDestinationId;
}

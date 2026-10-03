import type { Href } from 'expo-router';

export function proposalHubHref(coopId: string): Href {
  return { pathname: '/(tabs)/proposals', params: { coopId } };
}

export function proposalDraftsHref(coopId: string, coopName?: string): Href {
  return {
    pathname: '/(authenticated)/commons-proposal-drafts',
    params: { coopId, ...(coopName ? { coopName } : {}) },
  };
}

export function proposalDetailHref(proposalId: string, coopId: string): Href {
  return {
    pathname: '/(tabs)/proposal-detail',
    params: { id: proposalId, coopId },
  };
}

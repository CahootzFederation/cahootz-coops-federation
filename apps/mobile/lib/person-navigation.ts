import { router } from 'expo-router';

import { personHandleFromName } from '@/lib/social-profile';

/** Opens someone's public personal page from wherever their name or avatar appears. */
export function openPersonPage(name: string, handle?: string | null) {
  router.push({
    pathname: '/people/[handle]',
    params: {
      handle: handle || personHandleFromName(name),
      name,
    },
  } as any);
}

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/friendly-error';

export type CommonsProposalActions = {
  draftCount: number;
  actionableVoteCount: number;
  actionableProposalIds: string[];
  canVote: boolean;
  loading: boolean;
  /** True when the counts couldn't be loaded, so zero means "unknown", not "none". */
  failed: boolean;
};

const EMPTY: CommonsProposalActions = {
  draftCount: 0,
  actionableVoteCount: 0,
  actionableProposalIds: [],
  canVote: false,
  loading: false,
  failed: false,
};

export function useCommonsProposalActions({
  enabled,
  coopId,
  sessionToken,
  walletAddress,
}: {
  enabled: boolean;
  coopId?: string | null;
  sessionToken?: string | null;
  walletAddress?: string | null;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<CommonsProposalActions>(EMPTY);

  useEffect(() => {
    let mounted = true;
    if (!enabled || !coopId) {
      setState(EMPTY);
      return () => {
        mounted = false;
      };
    }

    setState({ ...EMPTY, loading: true });
    const draftsRequest = sessionToken
      ? api.getCommonsProposalDrafts(sessionToken).then((drafts) =>
          drafts.filter((draft) => draft.coopId === coopId).length,
        )
      : Promise.resolve(0);
    const actionRequest = walletAddress
      ? api.getProposalActionSummary(coopId, walletAddress).catch((error: unknown) => {
          // Only an explicit permission response means this account cannot vote.
          if (error instanceof ApiError && error.code === 'FORBIDDEN') return null;
          throw error;
        })
      : Promise.resolve(null);

    Promise.all([draftsRequest, actionRequest])
      .then(([draftCount, actionSummary]) => {
        if (!mounted) return;
        setState({
          draftCount,
          actionableVoteCount: actionSummary?.actionableVoteCount ?? 0,
          actionableProposalIds: actionSummary?.actionableProposalIds ?? [],
          canVote: actionSummary?.canVote ?? false,
          loading: false,
          failed: false,
        });
      })
      .catch((error) => {
        console.error('Failed to load proposal navigation actions:', error);
        if (mounted) setState({ ...EMPTY, failed: true });
      });

    return () => {
      mounted = false;
    };
  }, [coopId, enabled, sessionToken, walletAddress, reloadKey]);

  return { ...state, retry: () => setReloadKey((key) => key + 1) };
}

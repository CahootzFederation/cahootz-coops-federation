import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

export type CommonsProposalActions = {
  draftCount: number;
  actionableVoteCount: number;
  actionableProposalIds: string[];
  canVote: boolean;
  loading: boolean;
};

const EMPTY: CommonsProposalActions = {
  draftCount: 0,
  actionableVoteCount: 0,
  actionableProposalIds: [],
  canVote: false,
  loading: false,
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
  const [state, setState] = useState<CommonsProposalActions>(EMPTY);

  useEffect(() => {
    let mounted = true;
    if (!enabled || !coopId) {
      setState(EMPTY);
      return () => {
        mounted = false;
      };
    }

    setState((current) => ({ ...current, loading: true }));
    const draftsRequest = sessionToken
      ? api.getCommonsProposalDrafts(sessionToken).then((drafts) =>
          drafts.filter((draft) => draft.coopId === coopId).length,
        )
      : Promise.resolve(0);
    const actionRequest = walletAddress
      ? api.getProposalActionSummary(coopId, walletAddress).catch(() => null)
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
        });
      })
      .catch((error) => {
        console.error('Failed to load proposal navigation actions:', error);
        if (mounted) setState(EMPTY);
      });

    return () => {
      mounted = false;
    };
  }, [coopId, enabled, sessionToken, walletAddress]);

  return state;
}

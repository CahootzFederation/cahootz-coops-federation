'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

type MissionGoal = {
  key?: string;
  label: string;
  priorityWeight?: number;
  description?: string;
};

type CommonsDetail = {
  coopId: string;
  name: string | null;
  slug: string | null;
  tagline: string | null;
  description: string | null;
  displayMission: string | null;
  chainId: number | null;
  chainName: string | null;
  isDemo: boolean;
  isPrivate: boolean;
  createdAt: string;
  memberCount: number;
  applicationCount: number;
  postCount: number;
  charterText: string;
  missionGoals: unknown;
  scTokenAddress: string | null;
  scTokenSymbol: string | null;
  scTokenName: string | null;
  allyTokenAddress: string | null;
  ucTokenAddress: string | null;
  redemptionVaultAddress: string | null;
  treasurySafeAddress: string | null;
  verifiedStoreRegistryAddress: string | null;
  storePaymentRouterAddress: string | null;
  rewardEngineAddress: string | null;
  rpcUrl: string | null;
};

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function AddressRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-300">{value}</span>
    </div>
  );
}

export default function AdminCommonsDetailPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const [commons, setCommons] = useState<CommonsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTogglingPrivacy, setIsTogglingPrivacy] = useState(false);

  useEffect(() => {
    if (!coopId) return;
    fetch(`/api/admin/commons/${coopId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load commons.');
        setCommons(data.commons);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load commons.'));
  }, [coopId]);

  async function togglePrivacy() {
    if (!commons) return;
    setError(null);
    setIsTogglingPrivacy(true);
    try {
      const response = await fetch(`/api/admin/commons/${coopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate: !commons.isPrivate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update privacy.');
      setCommons(data.commons);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update privacy.');
    } finally {
      setIsTogglingPrivacy(false);
    }
  }

  const missionGoals = Array.isArray(commons?.missionGoals)
    ? (commons.missionGoals as MissionGoal[])
    : [];

  return (
    <div className="space-y-6">
      <Link href="/portal/admin" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        All Commons
      </Link>

      {error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!commons && !error && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {commons && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">
                {commons.name || commons.coopId}
                {commons.isPrivate && (
                  <span className="ml-2 rounded-full bg-slate-500/20 px-2 py-0.5 align-middle text-xs text-slate-300">
                    private
                  </span>
                )}
              </h1>
              {commons.tagline && <p className="mt-1 text-slate-400">{commons.tagline}</p>}
              <p className="mt-1 font-mono text-xs text-slate-500">{commons.coopId}</p>
            </div>
            <Button variant="outline" size="sm" onClick={togglePrivacy} disabled={isTogglingPrivacy}>
              {isTogglingPrivacy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : commons.isPrivate ? (
                'Make Public'
              ) : (
                'Make Private'
              )}
            </Button>
          </div>

          {commons.description && <p className="text-slate-300">{commons.description}</p>}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Members" value={commons.memberCount} />
            <StatCard label="Applications" value={commons.applicationCount} />
            <StatCard label="Posts" value={commons.postCount} />
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Goals</h2>
            {missionGoals.length === 0 ? (
              <p className="text-sm text-slate-500">No mission goals configured.</p>
            ) : (
              <ul className="space-y-2">
                {missionGoals.map((goal, i) => (
                  <li key={goal.key || i} className="rounded-[8px] border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{goal.label}</span>
                      {typeof goal.priorityWeight === 'number' && (
                        <span className="text-xs text-slate-400">
                          weight {Math.round(goal.priorityWeight * 100)}%
                        </span>
                      )}
                    </div>
                    {goal.description && (
                      <p className="mt-1 text-sm text-slate-400">{goal.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Charter</h2>
            <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-[8px] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              {commons.charterText || 'No charter text on file.'}
            </div>
          </section>

          <section className="space-y-1">
            <h2 className="text-lg font-semibold text-white">Chain &amp; Contracts</h2>
            <AddressRow label="Chain" value={commons.chainName} />
            <AddressRow label="RPC URL" value={commons.rpcUrl} />
            <AddressRow label={`${commons.scTokenSymbol || 'SC'} Token`} value={commons.scTokenAddress} />
            <AddressRow label="Ally Token" value={commons.allyTokenAddress} />
            <AddressRow label="Unity Coin" value={commons.ucTokenAddress} />
            <AddressRow label="Redemption Vault" value={commons.redemptionVaultAddress} />
            <AddressRow label="Treasury Safe" value={commons.treasurySafeAddress} />
            <AddressRow label="Verified Store Registry" value={commons.verifiedStoreRegistryAddress} />
            <AddressRow label="Store Payment Router" value={commons.storePaymentRouterAddress} />
            <AddressRow label="Reward Engine" value={commons.rewardEngineAddress} />
          </section>
        </>
      )}
    </div>
  );
}

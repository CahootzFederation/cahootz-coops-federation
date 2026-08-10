"use client";

import { api } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Wallet, Settings, Loader2, TrendingUp, DollarSign, Activity, Edit2, History, ExternalLink, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import dynamic from 'next/dynamic';

const WealthFundHybridPage = dynamic(() => import('../wealth-fund-hybrid/page'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default function WealthFundPage() {
  const [useHybrid, setUseHybrid] = useState<boolean | null>(null);

  // Check if hybrid architecture is enabled
  useEffect(() => {
    async function checkFeatureFlag() {
      try {
        const response = await fetch('/api/feature-flags/hybrid-architecture');
        const data = await response.json();
        setUseHybrid(data.enabled);
      } catch (error) {
        console.error('Failed to check feature flag:', error);
        setUseHybrid(false);
      }
    }
    checkFeatureFlag();
  }, []);

  if (useHybrid === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (useHybrid) {
    return <WealthFundHybridPage />;
  }

  return <WealthFundLegacyPage />;
}

function WealthFundLegacyPage() {
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [newRate, setNewRate] = useState("");
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [changeReason, setChangeReason] = useState("");

  const { data: treasuryConfig, isLoading: configLoading, refetch: refetchConfig } = api.treasury.getTreasuryConfig.useQuery();
  const { data: wealthFundBalance, isLoading: balanceLoading, refetch: refetchBalance } = api.treasury.getWealthFundBalance.useQuery();
  const { data: reserveStats, isLoading: statsLoading } = api.treasury.getReserveStats.useQuery();
  const { data: reserveHistory, isLoading: historyEntriesLoading, refetch: refetchReserveHistory } = api.treasury.getReserveHistory.useQuery({ limit: 50, offset: 0 });
  const [syncResult, setSyncResult] = useState<{ scRetriedCount: number; reserveSettled: number; reserveFailed: number; reserveSkipped: number } | null>(null);

  const syncMissingMutation = api.treasury.syncMissingReserves.useMutation({
    onSuccess: (data: { scRetriedCount: number; reserveSettled: number; reserveFailed: number; reserveSkipped: number }) => {
      setSyncResult(data);
      refetchReserveHistory();
    },
  });
  const { data: addressHistory, isLoading: historyLoading, refetch: refetchHistory } = api.treasury.getAddressChangeHistory.useQuery({ limit: 10, offset: 0 });

  const setReserveRateMutation = api.treasury.setDefaultReserveRate.useMutation({
    onSuccess: () => {
      refetchConfig();
      setIsEditingRate(false);
      setNewRate("");
    },
  });

  const setAddressMutation = api.treasury.setTreasuryAddress.useMutation({
    onSuccess: () => {
      refetchConfig();
      refetchBalance();
      refetchHistory();
      setIsEditingAddress(false);
      setNewAddress("");
      setChangeReason("");
    },
    onError: (error) => {
      alert(`Failed to update address: ${error.message}`);
    },
  });

  const handleSaveRate = () => {
    const bps = parseFloat(newRate) * 100;
    if (isNaN(bps) || bps < 0 || bps > 2000) {
      alert("Please enter a valid percentage between 0 and 20");
      return;
    }
    setReserveRateMutation.mutate({ reserveBps: Math.round(bps) });
  };

  const handleSaveAddress = () => {
    if (!newAddress || !/^0x[a-fA-F0-9]{40}$/.test(newAddress)) {
      alert("Please enter a valid Ethereum address");
      return;
    }
    setAddressMutation.mutate({ 
      treasuryAddress: newAddress,
      reason: changeReason || undefined,
    });
  };

  if (configLoading || balanceLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  const onChainBalance = wealthFundBalance?.balanceUC || 0;
  const pendingEntries = reserveStats?.pendingCount || 0;
  const totalEntries = reserveStats?.totalEntries || 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Wealth Fund</h1>
        <p className="text-gray-400">
          Manage the commons' wealth fund tax rate and track accumulated funds
        </p>
      </div>

      {/* Fund Balance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-600/5 border-green-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Fund Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">
              {onChainBalance.toFixed(4)} UC
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Live on-chain balance at fund address
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-600/5 border-blue-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Tax Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-400">
              {treasuryConfig ? (treasuryConfig.defaultReserveBps / 100).toFixed(1) : "—"}%
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Applied to each SC-verified store purchase
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-violet-600/5 border-purple-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Tracked Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-400">
              {totalEntries}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {pendingEntries > 0 ? `${pendingEntries} pending` : "All settled"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tax Rate Configuration */}
      {treasuryConfig && (
        <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-600/5 border-cyan-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Wallet className="h-6 w-6 text-cyan-500" />
              Wealth Fund Tax Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-400 mb-2">Current Tax Rate</p>
                {isEditingRate ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="20"
                        placeholder="5.0"
                        value={newRate}
                        onChange={(e) => setNewRate(e.target.value)}
                        className="w-32 bg-slate-800 border-slate-600 text-white pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                        %
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSaveRate}
                      disabled={setReserveRateMutation.isPending}
                      className="bg-cyan-600 hover:bg-cyan-700"
                    >
                      {setReserveRateMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsEditingRate(false);
                        setNewRate("");
                      }}
                      className="border-slate-600"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-4xl font-bold text-cyan-400">
                      {(treasuryConfig.defaultReserveBps / 100).toFixed(1)}%
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNewRate((treasuryConfig.defaultReserveBps / 100).toString());
                        setIsEditingRate(true);
                      }}
                      className="border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10"
                    >
                      <Settings className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Applied to all SC-verified store transactions
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-400 mb-2">How it works</p>
                <div className="space-y-2 text-sm text-gray-300">
                  <p>
                    When members make purchases at verified stores, a percentage of each transaction
                    is automatically set aside for the Wealth Fund.
                  </p>
                  <p className="text-xs text-gray-500">
                    This fund supports commons initiatives, member benefits, and community development.
                  </p>
                </div>
              </div>
            </div>

            {/* Fund Address */}
            <div className="pt-4 border-t border-slate-700">
              <p className="text-sm text-gray-400 mb-2">Wealth Fund Address</p>
              {isEditingAddress ? (
                <div className="space-y-3">
                  <Input
                    type="text"
                    placeholder="0x..."
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    className="bg-slate-800 border-slate-600 text-white font-mono text-sm"
                  />
                  <Textarea
                    placeholder="Reason for change (optional)"
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    className="bg-slate-800 border-slate-600 text-white text-sm"
                    rows={2}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveAddress}
                      disabled={setAddressMutation.isPending}
                      className="bg-cyan-600 hover:bg-cyan-700"
                    >
                      {setAddressMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save Address"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsEditingAddress(false);
                        setNewAddress("");
                        setChangeReason("");
                      }}
                      className="border-slate-600"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-slate-800 rounded text-sm text-cyan-400 font-mono">
                      {treasuryConfig.treasuryAddress || "Not configured"}
                    </code>
                    {treasuryConfig.treasuryAddress && (
                      <a
                        href={`https://sepolia.basescan.org/address/${treasuryConfig.treasuryAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNewAddress(treasuryConfig.treasuryAddress || "");
                        setIsEditingAddress(true);
                      }}
                      className="border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10"
                    >
                      <Edit2 className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    All future fund transfers will go to this address
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fund Statistics */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Fund Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-400">Total Entries</p>
              <p className="text-2xl font-bold text-white mt-1">
                {reserveStats?.totalEntries || 0}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Pending Entries</p>
              <p className="text-2xl font-bold text-white mt-1">
                {reserveStats?.pendingCount || 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Wealth Fund Transaction Entries */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <Activity className="h-5 w-5 text-green-400" />
                Wealth Fund Transactions
              </CardTitle>
              <CardDescription className="text-gray-400 mt-1">
                On-chain tax transfers collected from SC-verified store purchases
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncMissingMutation.mutate()}
                disabled={syncMissingMutation.isPending}
                className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                title="Find completed SC reward transactions that have no wealth fund entry and create FAILED records for them"
              >
                {syncMissingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4 mr-1" />
                )}
                Sync Missing
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { refetchReserveHistory(); setSyncResult(null); }}
                className="text-foreground hover:bg-accent"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {syncResult && (
            <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
              <span className="font-semibold">Sync complete:</span>{" "}
              {syncResult.reserveSettled > 0 && <span>{syncResult.reserveSettled} settled · </span>}
              {syncResult.reserveFailed > 0 && <span className="text-red-400">{syncResult.reserveFailed} marked failed (no on-chain event) · </span>}
              {syncResult.scRetriedCount > 0 && <span>{syncResult.scRetriedCount} SC reward(s) retried · </span>}
              <span className="text-gray-400">{syncResult.reserveSkipped} already tracked</span>
            </div>
          )}
          {historyEntriesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : reserveHistory && reserveHistory.entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-gray-400 text-left">
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Est. Amount (UC)</th>
                    <th className="pb-3 pr-4">Rate</th>
                    <th className="pb-3 pr-4">Source Tx</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {reserveHistory.entries.map((entry) => (
                    <>
                      <tr key={entry.id} className="py-2">
                        <td className="py-3 pr-4">
                          {entry.status === 'SETTLED' ? (
                            <Badge className="bg-green-500/10 text-green-400 border-green-500/20">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Settled
                            </Badge>
                          ) : entry.status === 'PENDING' || entry.status === 'SETTLING' ? (
                            <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                              <Clock className="h-3 w-3 mr-1" />
                              Pending
                            </Badge>
                          ) : (
                            <Badge className="bg-red-500/10 text-red-400 border-red-500/20">
                              <XCircle className="h-3 w-3 mr-1" />
                              Failed
                            </Badge>
                          )}
                        </td>
                        <td className={`py-3 pr-4 font-mono font-semibold ${entry.status === 'FAILED' ? 'text-red-400 line-through opacity-60' : 'text-green-400'}`}>
                          {entry.reserveAmountUC.toFixed(4)}
                        </td>
                        <td className="py-3 pr-4 text-gray-300">
                          {(entry.reservePercentBps / 100).toFixed(1)}%
                        </td>
                        <td className="py-3 pr-4">
                          {entry.sourceUcTxHash ? (
                            <a
                              href={`https://sepolia.basescan.org/tx/${entry.sourceUcTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 font-mono text-xs flex items-center gap-1"
                            >
                              {entry.sourceUcTxHash.slice(0, 8)}...{entry.sourceUcTxHash.slice(-6)}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-gray-400 text-xs">
                          {entry.sourceType || '—'}
                        </td>
                        <td className="py-3 text-gray-400 text-xs whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                      </tr>
                      {entry.status === 'FAILED' && entry.failureReason && (
                        <tr key={`${entry.id}-reason`} className="border-0">
                          <td colSpan={6} className="pb-3 pt-0 px-0">
                            <div className="flex items-start gap-2 rounded bg-red-500/5 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>{entry.failureReason}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {reserveHistory.total > reserveHistory.entries.length && (
                <p className="text-xs text-gray-500 mt-3 text-center">
                  Showing {reserveHistory.entries.length} of {reserveHistory.total} entries
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Activity className="h-10 w-10 mx-auto text-gray-600 mb-3" />
              <p className="text-gray-400">No wealth fund transactions yet</p>
              <p className="text-gray-500 text-xs mt-1">
                Use "Sync Missing" to scan for purchases that may be missing wealth fund records
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Address Change History */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <History className="h-5 w-5" />
            Address Change History
            <span className="text-xs text-cyan-400 font-normal ml-2">
              (On-Chain)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : addressHistory && addressHistory.changes.length > 0 ? (
            <div className="space-y-4">
              {addressHistory.changes.map((change) => (
                <div
                  key={change.id}
                  className="border border-slate-700 rounded-lg p-4 bg-slate-900/50"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-500">
                          {new Date(change.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {change.oldAddress && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-400">From:</span>
                            <code className="text-red-400 font-mono text-xs">
                              {change.oldAddress.slice(0, 10)}...{change.oldAddress.slice(-8)}
                            </code>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-400">To:</span>
                          <code className="text-green-400 font-mono text-xs">
                            {change.newAddress.slice(0, 10)}...{change.newAddress.slice(-8)}
                          </code>
                        </div>
                      </div>
                      {change.reason && (
                        <p className="text-sm text-gray-300 mt-2 italic">
                          "{change.reason}"
                        </p>
                      )}
                    </div>
                    <a
                      href={`https://sepolia.basescan.org/tx/${change.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300"
                      title="View transaction"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Changed by: <code className="text-gray-400 font-mono">{change.changedBy.slice(0, 6)}...{change.changedBy.slice(-4)}</code>
                  </div>
                </div>
              ))}
              {addressHistory.hasMore && (
                <p className="text-sm text-gray-500 text-center pt-2">
                  Showing {addressHistory.changes.length} of {addressHistory.total} changes
                </p>
              )}
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">
              No address changes recorded yet
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

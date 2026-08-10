"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Fuel, RefreshCw, AlertTriangle, CheckCircle2, Copy, Check, ExternalLink } from "lucide-react";

export default function BackendWalletStatus() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = api.admin.getBackendWalletStatus.useQuery(
    undefined,
    {
      refetchInterval: 60000, // Refetch every minute
    }
  );

  const handleCopyAddress = async () => {
    if (data?.walletAddress) {
      await navigator.clipboard.writeText(data.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatBalance = (formatted: string) => {
    const num = parseFloat(formatted);
    if (num === 0) return '0';
    if (num < 0.0001) return '< 0.0001';
    return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  const getStatusColor = () => {
    if (!data?.configured) return 'bg-red-500/10 text-red-500 border-red-500/20';
    if (data.isLow) return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
    return 'bg-green-500/10 text-green-500 border-green-500/20';
  };

  const getStatusIcon = () => {
    if (!data?.configured || (data.ethBalance && parseFloat(data.ethBalance.formatted) === 0)) {
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
    if (data?.isLow) {
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
    return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-slate-800 rounded-md border border-slate-600">
        <Fuel className="h-4 w-4 animate-pulse" />
        <span>Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 bg-slate-800 rounded-md border border-red-500/50">
        <AlertTriangle className="h-4 w-4" />
        <span>Error</span>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-6 px-2 text-gray-300 hover:text-white">
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(true)}
              className={`flex items-center gap-2 bg-slate-800 text-gray-200 hover:bg-slate-700 hover:text-white ${data?.isLow ? 'border-yellow-500/50' : 'border-slate-600'}`}
            >
              <Fuel className="h-4 w-4" />
              <span className="font-mono">
                {data?.ethBalance ? formatBalance(data.ethBalance.formatted) : '0'} ETH
              </span>
              {getStatusIcon()}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Backend wallet gas balance - Click for details</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fuel className="h-5 w-5" />
              Gas Wallet Status
            </DialogTitle>
            <DialogDescription>
              Backend wallet used for gas-free transactions
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {!data?.configured ? (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <p className="font-medium text-red-900 dark:text-red-100">Not Configured</p>
                </div>
                <p className="text-sm text-red-700 dark:text-red-300">
                  {data?.warningMessage || 'No commons backend wallet address is configured.'}
                </p>
              </div>
            ) : (
              <>
                {/* Status Badge */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Status</span>
                  <Badge className={getStatusColor()}>
                    {data.isLow ? 'Low Balance' : 'Healthy'}
                  </Badge>
                </div>

                {/* Warning Message */}
                {data.warningMessage && (
                  <div className={`rounded-lg p-3 ${
                    parseFloat(data.ethBalance?.formatted || '0') === 0
                      ? 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800'
                      : 'bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`h-4 w-4 ${
                        parseFloat(data.ethBalance?.formatted || '0') === 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-yellow-600 dark:text-yellow-400'
                      }`} />
                      <p className={`text-sm ${
                        parseFloat(data.ethBalance?.formatted || '0') === 0
                          ? 'text-red-900 dark:text-red-100'
                          : 'text-yellow-900 dark:text-yellow-100'
                      }`}>
                        {data.warningMessage}
                      </p>
                    </div>
                  </div>
                )}

                {/* ETH Balance */}
                <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4 text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Available Gas (ETH)</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                    {data.ethBalance ? formatBalance(data.ethBalance.formatted) : '0'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    on Base Sepolia
                  </p>
                </div>

                {/* Wallet Address */}
                {data.walletAddress && (
                  <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Wallet Address</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono break-all text-gray-900 dark:text-gray-100 flex-1">
                        {data.walletAddress}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyAddress}
                        className="h-7 w-7 p-0 shrink-0"
                      >
                        {copied ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <a
                      href={`https://sepolia.basescan.org/address/${data.walletAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2"
                    >
                      View on BaseScan
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {/* Funding Instructions */}
                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-xs text-blue-900 dark:text-blue-100 font-medium mb-1">
                    How to fund this wallet
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Send Base Sepolia ETH to the address above. You can get testnet ETH from{' '}
                    <a
                      href="https://www.alchemy.com/faucets/base-sepolia"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-blue-600 dark:hover:text-blue-200"
                    >
                      Alchemy Faucet
                    </a>
                    {' '}or{' '}
                    <a
                      href="https://faucet.quicknode.com/base/sepolia"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-blue-600 dark:hover:text-blue-200"
                    >
                      QuickNode Faucet
                    </a>.
                  </p>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </>
              )}
            </Button>
            <Button onClick={() => setIsModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

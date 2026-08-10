"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  DollarSign,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  ExternalLink,
} from "lucide-react";

export default function WealthFundHybridPage() {
  const [accountType, setAccountType] = useState<'TREASURY_FEES' | 'PLATFORM_FEES'>('TREASURY_FEES');

  // Fetch Wealth Fund balance
  const balanceQuery = api.treasuryLedger.getAccountBalance.useQuery({
    accountType,
    currency: 'USD',
  }, {
    refetchInterval: 60000,
  });

  // Fetch ledger entries for this account
  const entriesQuery = api.treasuryLedger.getLedgerEntries.useQuery({
    accountType,
    limit: 50,
  });

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const isLoading = balanceQuery.isLoading || entriesQuery.isLoading;
  const visibleEntries = (entriesQuery.data?.entries ?? []).filter(
    (entry) => !(entry.entryType === 'FEE_COLLECTION' && Math.abs(entry.amount) < 0.005)
  );
  const visibleCredits = visibleEntries.reduce(
    (sum, entry) => sum + (entry.direction === 'CREDIT' ? entry.amount : 0),
    0
  );
  const visibleDebits = visibleEntries.reduce(
    (sum, entry) => sum + (entry.direction === 'DEBIT' ? entry.amount : 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal text-zinc-50">Wealth Fund</h1>
          <p className="mt-1 text-zinc-400">
            Commons treasury funded by store purchase contributions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select 
            value={accountType} 
            onValueChange={(v) => setAccountType(v as 'TREASURY_FEES' | 'PLATFORM_FEES')}
          >
            <SelectTrigger className="w-48 border-zinc-800 bg-zinc-950 text-zinc-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
              <SelectItem value="TREASURY_FEES">Treasury Fees</SelectItem>
              <SelectItem value="PLATFORM_FEES">Platform Fees</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              balanceQuery.refetch();
              entriesQuery.refetch();
            }}
            disabled={isLoading}
            className="border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Balance Card */}
      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-50 shadow-none">
        <CardHeader>
          <CardTitle className="text-zinc-100">Current Balance</CardTitle>
          <CardDescription className="text-zinc-500">
            {accountType === 'TREASURY_FEES' 
              ? 'Community contributions collected from completed store purchases'
              : 'Platform operations fees retained from commerce activity'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-green-500/20 bg-gradient-to-br from-green-500/10 to-blue-500/10 p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-500/20 rounded-lg">
                    <DollarSign className="h-8 w-8 text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm text-zinc-400">Total Balance</p>
                    <p className="mt-1 text-4xl font-bold text-zinc-50">
                      {formatAmount(balanceQuery.data?.balance || 0)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-zinc-400">Total Entries</p>
                  <p className="mt-1 text-2xl font-bold text-zinc-50">
                    {visibleEntries.length}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowDownLeft className="h-4 w-4 text-green-500" />
                    <p className="text-sm font-medium text-zinc-200">Total Credits</p>
                  </div>
                  <p className="text-xl font-bold text-green-400">
                    {formatAmount(visibleCredits)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowUpRight className="h-4 w-4 text-red-500" />
                    <p className="text-sm font-medium text-zinc-200">Total Debits</p>
                  </div>
                  <p className="text-xl font-bold text-red-400">
                    {formatAmount(visibleDebits)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ledger Entries */}
      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-50 shadow-none">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-zinc-100">Ledger History</CardTitle>
              <CardDescription className="text-zinc-500">
                All {accountType === 'TREASURY_FEES' ? 'store contribution' : 'platform operations fee'} transactions
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {entriesQuery.isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="py-12 text-center text-zinc-500">
              <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No ledger entries yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 transition-colors hover:bg-zinc-900"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`p-2 rounded-lg ${
                      entry.direction === 'CREDIT' 
                        ? 'bg-green-500/10' 
                        : 'bg-red-500/10'
                    }`}>
                      {entry.direction === 'CREDIT' ? (
                        <ArrowDownLeft className="h-4 w-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-zinc-100">
                          {entry.entryType.replace(/_/g, ' ')}
                        </p>
                        {entry.linkedPayment && (
                          entry.linkedPayment.stripePaymentIntentId ? (
                            <a
                              href={`https://dashboard.stripe.com/test/payments/${entry.linkedPayment.stripePaymentIntentId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-amber-100"
                            >
                              <ExternalLink className="mr-1 h-3 w-3" />
                              Payment #{entry.linkedPayment.id.slice(0, 8)}
                            </a>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              Payment #{entry.linkedPayment.id.slice(0, 8)}
                            </Badge>
                          )
                        )}
                      </div>
                      {entry.description && (
                        <p className="mt-1 text-sm text-zinc-400">
                          {entry.description}
                        </p>
                      )}
                      {entry.linkedPayment && (
                        <div className="mt-2 text-xs text-zinc-500">
                          <p>
                            Customer: {entry.linkedPayment.customer.name} • 
                            Business: {entry.linkedPayment.business.name} • 
                            Total: {formatAmount(entry.linkedPayment.chargedAmount)}
                          </p>
                        </div>
                      )}
                      {entry.sourceTransactionId && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Ref: {entry.sourceTransactionId.slice(0, 12)}...
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className={`text-lg font-bold ${
                      entry.direction === 'CREDIT' ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {entry.direction === 'CREDIT' ? '+' : '-'}
                      {formatAmount(entry.amount)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {new Date(entry.occurredAt).toLocaleDateString()} at{' '}
                      {new Date(entry.occurredAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

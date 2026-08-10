"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Coins,
  DollarSign,
  Landmark,
  Loader2,
  Newspaper,
  Settings,
  ShieldCheck,
  Store,
  TrendingUp,
  Users,
  Vote,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useWeb3Auth } from "@/hooks/use-web3-auth";

type MetricTone = "emerald" | "amber" | "sky" | "rose";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: MetricTone;
}

interface ActionLink {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface RecentTransaction {
  id: string;
  status: string;
  chargedAmount: number;
  business: {
    name: string;
  };
  customer: {
    name: string;
  };
}

const actionLinks: ActionLink[] = [
  {
    title: "Review applications",
    description: "Move approved people into active membership.",
    href: "/applications",
    icon: ClipboardList,
    adminOnly: true,
  },
  {
    title: "Edit public page",
    description: "Update the public newsletter page and weekly email settings.",
    href: "/settings/public-page",
    icon: Newspaper,
    adminOnly: true,
  },
  {
    title: "Manage stores",
    description: "Approve storefronts and keep commerce moving.",
    href: "/stores",
    icon: Store,
    adminOnly: true,
  },
  {
    title: "Check treasury",
    description: "See fee collection and fund balances.",
    href: "/treasury",
    icon: Landmark,
    adminOnly: true,
  },
  {
    title: "Vote on proposals",
    description: "Review decisions shaping the commons.",
    href: "/proposals",
    icon: Vote,
  },
  {
    title: "Submit story",
    description: "Send articles and events to the commons paper.",
    href: "/newsletter/submit",
    icon: Newspaper,
  },
  {
    title: "Member directory",
    description: "Find people and understand the network.",
    href: "/members",
    icon: Users,
  },
  {
    title: "Portal settings",
    description: "Update account, wallet, and commons settings.",
    href: "/settings",
    icon: Settings,
  },
];

function MetricCard({ label, value, detail, icon: Icon, tone }: MetricCardProps) {
  const toneClasses: Record<MetricTone, string> = {
    emerald: "border-emerald-400/20 bg-emerald-400/5 text-emerald-300",
    amber: "border-amber-400/20 bg-amber-400/5 text-amber-300",
    sky: "border-sky-400/20 bg-sky-400/5 text-sky-300",
    rose: "border-rose-400/20 bg-rose-400/5 text-rose-300",
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-400">{label}</p>
            <p className="mt-3 truncate text-2xl font-semibold tracking-normal text-zinc-50">
              {value}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{detail}</p>
          </div>
          <div className={cn("rounded-md border p-2", toneClasses[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyActivity() {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 text-sm text-zinc-500">
      No payments yet
    </div>
  );
}

export default function DashboardHybrid() {
  const params = useParams();
  const coopId = params.coopId as string;
  const { isAdmin, adminRole } = useWeb3Auth();

  const paymentStatsQuery = api.commerce.getPaymentStats.useQuery({});
  const scStatsQuery = api.scMintEvents.getStats.useQuery();
  const treasurySummaryQuery = api.treasuryLedger.getSummary.useQuery({
    currency: "USD",
  });

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const formatSC = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const isLoading = paymentStatsQuery.isLoading || scStatsQuery.isLoading || treasurySummaryQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const failedMints = scStatsQuery.data?.failed || 0;
  const pendingMints = scStatsQuery.data?.pending || 0;
  const hasIssues = failedMints > 0 || pendingMints > 5;
  const visibleActions = actionLinks.filter((item) => isAdmin || !item.adminOnly);
  const recentTransactions = (paymentStatsQuery.data?.recentTransactions || []) as RecentTransaction[];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-5 shadow-none">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={cn(
                    "border",
                    isAdmin
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                  )}
                >
                  {isAdmin ? "Admin workspace" : "Member workspace"}
                </Badge>
                {adminRole && (
                  <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                    {adminRole}
                  </Badge>
                )}
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-normal text-zinc-50">
                {isAdmin ? "Run the commons with less hunting around." : "Your commons home base."}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                {isAdmin
                  ? "Review member flow, commerce, rewards, and treasury health from one calm workspace."
                  : "See what is happening, find other members, and participate in governance."}
              </p>
            </div>
            <Button asChild className="bg-zinc-100 text-zinc-950 hover:bg-white">
              <Link href={`/portal/${coopId}/${isAdmin ? "applications" : "proposals"}`}>
                {isAdmin ? "Review queue" : "View proposals"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-200">Operational status</p>
              <p className="mt-1 text-xs text-zinc-500">Minting, payments, and queue health</p>
            </div>
            <div className={cn(
              "rounded-md border p-2",
              hasIssues
                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            )}>
              {hasIssues ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-zinc-900 p-3">
              <p className="text-lg font-semibold text-zinc-50">{failedMints}</p>
              <p className="text-xs text-zinc-500">Failed</p>
            </div>
            <div className="rounded-md bg-zinc-900 p-3">
              <p className="text-lg font-semibold text-zinc-50">{pendingMints}</p>
              <p className="text-xs text-zinc-500">Pending</p>
            </div>
            <div className="rounded-md bg-zinc-900 p-3">
              <p className="text-lg font-semibold text-zinc-50">{scStatsQuery.data?.successRate || 0}%</p>
              <p className="text-xs text-zinc-500">Success</p>
            </div>
          </div>
        </div>
      </section>

      {hasIssues && (
        <Card className="border-amber-400/30 bg-amber-400/10 shadow-none">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" />
              <div>
                <p className="font-medium text-amber-100">System issues need attention</p>
                <p className="mt-1 text-sm text-amber-100/75">
                  {failedMints} failed SC mints and {pendingMints} pending. Review SC Rewards for details.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Payment Volume"
          value={formatAmount((paymentStatsQuery.data?.totalVolumeCents || 0) / 100)}
          detail={`${paymentStatsQuery.data?.totalPayments || 0} transactions`}
          icon={DollarSign}
          tone="emerald"
        />
        <MetricCard
          label="Wealth Fund"
          value={formatAmount((treasurySummaryQuery.data?.totalBalance || 0) / 100)}
          detail="Treasury fees collected"
          icon={TrendingUp}
          tone="amber"
        />
        <MetricCard
          label="SC Rewards"
          value={`${formatSC(scStatsQuery.data?.totalMintedDB || 0)} SC`}
          detail={`${scStatsQuery.data?.completed || 0} completed`}
          icon={Coins}
          tone="sky"
        />
        <MetricCard
          label="Success Rate"
          value={`${scStatsQuery.data?.successRate || 0}%`}
          detail={`${failedMints} failed`}
          icon={Activity}
          tone={failedMints > 0 ? "rose" : "emerald"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <ShieldCheck className="h-5 w-5 text-amber-300" />
              Useful Actions
            </CardTitle>
            <CardDescription className="text-zinc-500">
              Shortcuts based on your access level
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {visibleActions.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={`/portal/${coopId}${item.href}`}
                    className="group rounded-md border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-md border border-zinc-700 bg-zinc-950 p-2 text-zinc-300 group-hover:text-white">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{item.description}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-zinc-100">Recent Payments</CardTitle>
            <CardDescription className="text-zinc-500">
              Latest commerce transactions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentTransactions.length === 0 ? (
              <EmptyActivity />
            ) : (
              <div className="space-y-2">
                {recentTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">{tx.business.name}</p>
                      <p className="truncate text-xs text-zinc-500">{tx.customer.name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-zinc-50">
                        {formatAmount(tx.chargedAmount)}
                      </p>
                      <Badge variant="outline" className="mt-1 border-emerald-400/30 text-emerald-200">
                        {tx.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, Plus, CheckSquare, Square, ChevronDown, Archive, Vote, Clock, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { ProposalCard } from "@/components/portal/proposals/proposal-card";
import { useWeb3Auth } from "@/hooks/use-web3-auth";

type StatusFilter = "active" | "all" | "submitted" | "votable" | "approved" | "funded" | "rejected" | "failed" | "withdrawn";

// Statuses that represent live, in-flight work
const ACTIVE_STATUSES = ["submitted", "votable", "approved", "funded"] as const;

const statusTabs: { value: StatusFilter; label: string; description: string }[] = [
  { value: "active",    label: "Active",    description: "Proposals in review or currently being funded" },
  { value: "submitted", label: "New",       description: "Freshly submitted, awaiting AI review" },
  { value: "votable",   label: "Voting",    description: "Passed AI review, open for community deliberation" },
  { value: "approved",  label: "Approved",  description: "Approved by the commons, awaiting funding" },
  { value: "funded",    label: "Funded",    description: "Funded and in progress" },
  { value: "rejected",  label: "Rejected",  description: "Did not pass review or vote" },
  { value: "all",       label: "Archive",   description: "All proposals including withdrawn and failed" },
];

const PAGE_SIZE = 20;

const ALL_STATUSES: StatusFilter[] = ["submitted", "votable", "approved", "funded", "rejected", "failed", "withdrawn"];

export default function ProposalsPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const { isAdmin } = useWeb3Auth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [offset, setOffset] = useState(0);
  const [allProposals, setAllProposals] = useState<any[]>([]);

  // Bulk management state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<StatusFilter>("rejected");
  const [bulkApplying, setBulkApplying] = useState(false);

  const { data, isLoading, error, refetch } = api.proposal.list.useQuery({
    coopId,
    statuses: statusFilter === "active"
      ? [...ACTIVE_STATUSES]
      : undefined,
    status: statusFilter !== "active" && statusFilter !== "all"
      ? statusFilter
      : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const { data: coopConfig } = api.coopConfig.getActive.useQuery({ coopId });
  const categoryLabels: Record<string, string> = Object.fromEntries(
    (coopConfig?.proposalCategories ?? []).map((c: { key: string; label: string }) => [c.key, c.label])
  );

  // Accumulate proposals for "load more"
  useEffect(() => {
    if (!data) return;
    if (offset === 0) {
      setAllProposals(data.proposals);
    } else {
      setAllProposals(prev => [...prev, ...data.proposals]);
    }
  }, [data, offset]);

  const updateStatus = api.proposal.updateStatus.useMutation();

  function handleTabChange(tab: StatusFilter) {
    setStatusFilter(tab);
    setOffset(0);
    setAllProposals([]);
    setSelectedIds(new Set());
    setBulkMode(false);
  }

  function handleLoadMore() {
    setOffset(prev => prev + PAGE_SIZE);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === allProposals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allProposals.map(p => p.id)));
    }
  }

  async function applyBulkStatus() {
    if (selectedIds.size === 0) return;
    setBulkApplying(true);
    try {
      for (const id of selectedIds) {
        await updateStatus.mutateAsync({ id, status: bulkStatus as any });
      }
      setSelectedIds(new Set());
      setOffset(0);
      setAllProposals([]);
      refetch();
    } finally {
      setBulkApplying(false);
    }
  }

  const hasMore = data ? offset + PAGE_SIZE < data.total : false;
  // While loading offset=0 page, show skeleton; on load-more, show existing + spinner below
  const displayedProposals = allProposals;
  const activeTab = statusTabs.find((tab) => tab.value === statusFilter) ?? statusTabs[0];
  const totalCount = data?.total ?? displayedProposals.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-5 shadow-none">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-200">
              <Vote className="h-3.5 w-3.5" />
              Governance workspace
            </div>
            <h1 className="text-3xl font-semibold tracking-normal text-zinc-50">Proposals</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Review ideas, track voting status, and move approved work toward funding.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className={
                  bulkMode
                    ? "border-amber-400/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                }
                onClick={() => { setBulkMode(b => !b); setSelectedIds(new Set()); }}
              >
                <CheckSquare className="mr-2 h-4 w-4" />
                {bulkMode ? "Cancel Bulk" : "Bulk Edit"}
              </Button>
            )}
            <Link href={`/portal/${coopId}/proposals/submit`}>
              <Button className="bg-amber-600 text-white hover:bg-amber-700">
                <Plus className="mr-2 h-4 w-4" />
                Submit Proposal
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <Clock className="h-3.5 w-3.5" />
              Current view
            </div>
            <p className="text-lg font-semibold text-zinc-100">{activeTab.label}</p>
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{activeTab.description}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <Archive className="h-3.5 w-3.5" />
              Matching records
            </div>
            <p className="text-lg font-semibold text-zinc-100">{totalCount}</p>
            <p className="mt-1 text-xs text-zinc-500">Showing {displayedProposals.length} on this page</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Admin mode
            </div>
            <p className="text-lg font-semibold text-zinc-100">{isAdmin ? "Enabled" : "Member"}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {isAdmin ? "Bulk actions and review tools are available" : "Submit and track proposals"}
            </p>
          </div>
        </div>
      </section>

      {/* Status Filter Tabs */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2">
        <div className="flex flex-wrap gap-2">
        {statusTabs.map((tab) => (
          <Button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            variant={statusFilter === tab.value ? "default" : "ghost"}
            className={
              statusFilter === tab.value
                ? "bg-amber-600 text-white hover:bg-amber-700"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            }
            size="sm"
            title={tab.description}
          >
            {tab.label}
          </Button>
        ))}
        </div>
      </div>

      {/* Loading State (initial) */}
      {isLoading && offset === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Failed to load proposals: {error.message}
        </div>
      )}

      {/* Bulk Action Bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950 px-5 py-3 shadow-2xl">
          <span className="text-sm font-medium text-white">{selectedIds.size} selected</span>
          <span className="text-sm text-zinc-500">Change status to</span>
          <div className="relative">
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value as StatusFilter)}
              className="appearance-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 pr-8 text-sm text-white"
            >
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700"
            onClick={applyBulkStatus}
            disabled={bulkApplying}
          >
            {bulkApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
          </Button>
        </div>
      )}

      {/* Bulk select all row */}
      {bulkMode && displayedProposals.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
            {selectedIds.size === displayedProposals.length ? (
              <CheckSquare className="mr-1 h-4 w-4 text-amber-400" />
            ) : (
              <Square className="mr-1 h-4 w-4" />
            )}
            {selectedIds.size === displayedProposals.length ? "Deselect All" : "Select All"}
          </Button>
          <span className="text-xs text-zinc-500">{selectedIds.size} of {displayedProposals.length} selected</span>
        </div>
      )}

      {/* Proposal Grid */}
      {!isLoading && (
        <>
          {displayedProposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/70 py-16 text-zinc-500">
              <FileText className="mb-3 h-12 w-12 opacity-50" />
              <p className="text-sm font-medium text-zinc-300">No proposals found</p>
              <p className="mt-1 max-w-sm text-center text-xs text-zinc-500">
                Nothing matches the {activeTab.label.toLowerCase()} view yet.
              </p>
              {statusFilter !== "active" && (
                <Button variant="ghost" size="sm" className="mt-3 text-zinc-300 hover:bg-zinc-900 hover:text-white" onClick={() => handleTabChange("active")}>
                  Show active proposals
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {displayedProposals.map((proposal: any) => (
                <div key={proposal.id} className="relative">
                  {bulkMode && (
                    <button
                      onClick={() => toggleSelect(proposal.id)}
                      className="absolute left-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded border-2 bg-zinc-900"
                      style={{ borderColor: selectedIds.has(proposal.id) ? "#f59e0b" : "#475569" }}
                    >
                      {selectedIds.has(proposal.id) && (
                        <div className="h-3 w-3 rounded-sm bg-amber-500" />
                      )}
                    </button>
                  )}
                  <ProposalCard proposal={proposal} categoryLabels={categoryLabels} coopId={coopId} />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
            <p className="text-xs text-zinc-500">
              Showing {displayedProposals.length} of {data?.total ?? displayedProposals.length} proposals
            </p>
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-white"
                onClick={handleLoadMore}
                disabled={isLoading}
              >
                Load More
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

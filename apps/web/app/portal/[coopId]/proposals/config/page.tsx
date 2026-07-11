"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { useCoin } from "@/hooks/use-platform-config";
import { useWeb3Auth } from "@/hooks/use-web3-auth";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ArrowLeft, ShieldAlert, PlusCircle, Bot, Users, Globe, X, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { ConfigSectionEditor } from "@/components/portal/proposals/config-section-editor";

export default function CoopConfigPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const coin = useCoin();
  const { address, isAdmin, isLoading: isAuthLoading } = useWeb3Auth();
  const canLoadAdminConfig = !isAuthLoading && isAdmin && !!address;
  const utils = api.useUtils();
  const { data: config, refetch, isLoading } = api.coopConfig.getActive.useQuery({ coopId });
  const { data: versions } = api.coopConfig.listVersions.useQuery({ coopId });

  const createConfig = api.coopConfig.create.useMutation({
    onSuccess: () => {
      void refetch();
      void utils.coopConfig.getActive.invalidate({ coopId });
      void utils.coopConfig.listVersions.invalidate({ coopId });
    },
  });

  // Generic config amendment flow
  const { data: pendingAmendments = [], refetch: refetchAmendments } = api.coopConfig.getPendingConfigAmendments.useQuery(
    { coopId },
    { enabled: canLoadAdminConfig },
  );
  const pendingBySection = Object.fromEntries(pendingAmendments.map(a => [a.section, a]));

  const proposeChange = api.coopConfig.proposeConfigChange.useMutation({
    onSuccess: () => {
      void refetchAmendments();
      void utils.coopConfig.getPendingConfigAmendments.invalidate({ coopId });
      void utils.coopConfig.getAllAmendments.invalidate({ coopId });
      void utils.coopConfig.listVersions.invalidate({ coopId });
    },
  });
  // Charter amendment flow (specialized — keeps text diff UI)
  const { data: pendingCharterData, refetch: refetchCharter } = api.coopConfig.getPendingCharterAmendment.useQuery(
    { coopId },
    { enabled: canLoadAdminConfig },
  );
  const pendingCharter = pendingCharterData?.amendment ?? null;
  const pendingChangeCount = pendingAmendments.length + (pendingCharter ? 1 : 0);

  const proposeCharter = api.coopConfig.proposeCharterChange.useMutation({
    onSuccess: () => {
      void refetchCharter();
      void utils.coopConfig.getPendingCharterAmendment.invalidate({ coopId });
      void utils.coopConfig.getAllAmendments.invalidate({ coopId });
      void utils.coopConfig.listVersions.invalidate({ coopId });
    },
  });
  const [charterProposedText, setCharterProposedText] = useState("");

  // Helper: propose a section change
  const propose = (section: string, proposedChanges: Record<string, unknown>, currentSnapshot: Record<string, unknown>) =>
    async (reason: string) => {
      await proposeChange.mutateAsync({ coopId, section, proposedChanges, currentSnapshot, reason });
    };

  // Helper: pass pending amendment for a section (review happens on the amendments page)
  const sectionReview = (section: string) => ({
    pendingAmendment: pendingBySection[section] ?? null,
  });

  // Create form state
  const [createCoopId, setCreateCoopId] = useState(coopId);
  const [createCharterText, setCreateCharterText] = useState("");
  const [createReason, setCreateReason] = useState("Initial configuration");

  // Editing state
  const [editQuorum, setEditQuorum] = useState("");
  const [editApproval, setEditApproval] = useState("");
  const [editWindow, setEditWindow] = useState("");
  const [editMinSc, setEditMinSc] = useState("");
  const [editAutoApproveThreshold, setEditAutoApproveThreshold] = useState("");
  const [editCouncilThreshold, setEditCouncilThreshold] = useState("");
  const [editPassThreshold, setEditPassThreshold] = useState("");
  const [editMissionWeight, setEditMissionWeight] = useState("");
  const [editStructuralWeight, setEditStructuralWeight] = useState("");
  const [editFeasibilityWeight, setEditFeasibilityWeight] = useState("");
  const [editRiskWeight, setEditRiskWeight] = useState("");
  const [editAccountabilityWeight, setEditAccountabilityWeight] = useState("");

  // Mission goals editing
  const [editGoals, setEditGoals] = useState<{ key: string; label: string; priorityWeight: number; description?: string }[] | null>(null);
  const [newGoalKey, setNewGoalKey] = useState("");
  const [newGoalLabel, setNewGoalLabel] = useState("");
  const [newGoalWeight, setNewGoalWeight] = useState("");
  const [newGoalDescription, setNewGoalDescription] = useState("");

  // Categories editing
  const [editCategories, setEditCategories] = useState<{ key: string; label: string; isActive: boolean; description?: string }[] | null>(null);
  const [newCategoryKey, setNewCategoryKey] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");

  // Sector exclusions editing
  const [editExclusions, setEditExclusions] = useState<{ value: string; description?: string }[] | null>(null);
  const [newExclusionValue, setNewExclusionValue] = useState("");
  const [newExclusionDescription, setNewExclusionDescription] = useState("");

  // Display features editing
  const [editFeatures, setEditFeatures] = useState<{ title: string; description: string }[] | null>(null);
  const [newFeatureTitle, setNewFeatureTitle] = useState("");
  const [newFeatureDescription, setNewFeatureDescription] = useState("");

  // Eligibility editing
  const [editEligibility, setEditEligibility] = useState<string | null>(null);

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!address || !isAdmin) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <ShieldAlert className="h-12 w-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Admin Access Required</h2>
        <p className="text-gray-400">You need admin privileges to manage co-op configuration.</p>
        <Link href={`/portal/${coopId}/proposals`} className="text-amber-500 hover:underline">
          Back to proposals
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-2">
          <Link href={`/portal/${coopId}/proposals`} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Coop Configuration</h1>
            <p className="text-gray-400 text-sm mt-0.5">No active configuration found</p>
          </div>
        </div>

        {(
          <Card className="bg-[#1a1a2e] border-amber-800/40">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <PlusCircle className="h-5 w-5 text-amber-400" />
                Create Initial Configuration
              </CardTitle>
              <p className="text-gray-400 text-sm">
                Bootstrap the coop with sensible defaults. All settings can be edited after creation.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-300">Coop ID</label>
                  <Input
                    value={createCoopId}
                    onChange={(e) => setCreateCoopId(e.target.value)}
                    className="bg-[#0d0d1a] border-gray-700 text-white"
                    placeholder="soulaan"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-300">Creation Reason</label>
                  <Input
                    value={createReason}
                    onChange={(e) => setCreateReason(e.target.value)}
                    className="bg-[#0d0d1a] border-gray-700 text-white"
                    placeholder="Initial configuration"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-300">
                  Charter Text <span className="text-gray-500 font-normal">(optional — defaults auto-generated)</span>
                </label>
                <Textarea
                  value={createCharterText}
                  onChange={(e) => setCreateCharterText(e.target.value)}
                  rows={4}
                  className="bg-[#0d0d1a] border-gray-700 text-white resize-none"
                  placeholder="Describe the coop's charter and mission..."
                />
              </div>

              <div className="rounded-lg border border-amber-800/30 bg-amber-900/10 p-4">
                <p className="text-sm text-amber-300 font-medium mb-1">Defaults that will be applied</p>
                <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
                  <li>4 mission goals: Income Stability (35%), Asset Creation (25%), Leakage Reduction (20%), Export Expansion (20%) — descriptions can be added after creation</li>
                  <li>Structural weights: Feasibility 40%, Risk 35%, Accountability 25%</li>
                  <li>Score mix: Mission 60% / Structural 40%</li>
                  <li>Screening threshold: 60%</li>
                  <li>Quorum: 15% · Approval: 51% · Voting window: 7 days</li>
                  <li>Approval tiers: AI auto-approve &lt; $500 · Council vote $500–$5,000 · Full coop vote ≥ $5,000</li>
                </ul>
              </div>

              {createConfig.error && (
                <p className="text-sm text-red-400">{createConfig.error.message}</p>
              )}

              <button
                onClick={() =>
                  createConfig.mutate({
                    coopId: createCoopId.trim() || coopId,
                    walletAddress: address,
                    reason: createReason.trim() || "Initial configuration",
                    ...(createCharterText.trim() ? { charterText: createCharterText.trim() } : {}),
                  })
                }
                disabled={createConfig.isPending}
                className="w-full sm:w-auto flex items-center gap-2 px-6 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-black font-semibold text-sm transition-colors"
              >
                {createConfig.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlusCircle className="h-4 w-4" />
                )}
                Create Configuration
              </button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }


  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href={`/portal/${coopId}/proposals`} className="inline-flex items-center text-gray-400 hover:text-white text-sm">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to proposals
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Co-op Configuration</h1>
          <p className="text-gray-400 text-sm mt-1">
            Version {config.version} | {config.coopId} | Last updated by {config.createdBy}
          </p>
        </div>
        <Link
          href={`/portal/${coopId}/proposals/config/amendments`}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-600 text-sm text-gray-400 hover:text-white hover:bg-slate-700 transition-colors"
        >
          {pendingChangeCount > 0 && (
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-black leading-none">
              {pendingChangeCount}
            </span>
          )}
          Proposed Changes
        </Link>
      </div>

      {/* Charter */}
      {/* Charter — uses ConfigSectionEditor for consistent propose/review flow */}
      <ConfigSectionEditor
        title="Charter Text"
        description="The founding document of the coop. Changes require acknowledgement before going live."
        isDirty={charterProposedText !== config.charterText && charterProposedText !== ""}
        onSave={async (reason) => {
          await proposeCharter.mutateAsync({
            coopId: config.coopId,
            proposedText: charterProposedText,
            reason,
          });
          setCharterProposedText("");
        }}
        isSaving={proposeCharter.isPending}
        pendingAmendment={pendingCharter ? {
          id: pendingCharter.id,
          reason: pendingCharter.reason,
          proposedBy: pendingCharter.proposedBy,
          proposedAt: pendingCharter.proposedAt,
        } : null}
        coopId={coopId}
      >
        {/* Editable textarea — always visible */}
        <Textarea
          value={charterProposedText || config.charterText}
          onChange={(e) => setCharterProposedText(e.target.value)}
          rows={8}
          disabled={!!pendingCharter}
          className="bg-slate-900 border-slate-600 text-white text-sm resize-y disabled:opacity-50"
          placeholder="Charter text..."
        />
      </ConfigSectionEditor>

      {/* Mission Goals */}
      <ConfigSectionEditor
        title="Mission Goals"
        description="Goals used to score proposal mission impact. Edit weights, descriptions, or add new goals — changes won't go live until acknowledged."
        isDirty={editGoals !== null}
        onSave={propose("missionGoals", { missionGoals: editGoals ?? config.missionGoals }, { missionGoals: config.missionGoals })}
        isSaving={proposeChange.isPending}
        {...sectionReview("missionGoals")}
        coopId={coopId}
      >
        <p className="text-xs text-amber-400/80 mb-1">
          The <span className="font-medium">description</span> field on each goal is sent to the AI to guide scoring — make it specific and actionable.
        </p>

        {/* Weight total warning */}
        {(() => {
          const goals = editGoals ?? config.missionGoals;
          const total = Math.round(goals.reduce((s, g) => s + g.priorityWeight, 0) * 100);
          return (
            <p className={`text-xs mb-3 font-medium ${total === 100 ? "text-green-400" : "text-red-400"}`}>
              Total weight: {total}% {total !== 100 && "— must sum to 100%"}
            </p>
          );
        })()}

        {/* Goal rows */}
        <div className="space-y-3">
          {(editGoals ?? config.missionGoals).map((goal, i) => (
            <div key={i} className="rounded-md border border-slate-700 bg-slate-900 p-3 space-y-2">
              {/* Top row: label, key, weight, remove */}
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Input
                    value={goal.label}
                    onChange={(e) => {
                      const base = editGoals ?? config.missionGoals;
                      setEditGoals(base.map((g, j) => j === i ? { ...g, label: e.target.value } : g));
                    }}
                    placeholder="Label"
                    className="bg-slate-800 border-slate-600 text-white text-sm h-8"
                  />
                </div>
                <div className="w-36">
                  <Input
                    value={goal.key}
                    onChange={(e) => {
                      const base = editGoals ?? config.missionGoals;
                      setEditGoals(base.map((g, j) => j === i ? { ...g, key: e.target.value } : g));
                    }}
                    placeholder="key"
                    className="bg-slate-800 border-slate-600 text-white font-mono text-xs h-8"
                  />
                </div>
                <div className="w-24 flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(goal.priorityWeight * 100)}
                    onChange={(e) => {
                      const base = editGoals ?? config.missionGoals;
                      setEditGoals(base.map((g, j) => j === i ? { ...g, priorityWeight: parseFloat(e.target.value) / 100 } : g));
                    }}
                    className="bg-slate-800 border-slate-600 text-white text-sm h-8"
                  />
                  <span className="text-gray-500 text-sm flex-shrink-0">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const base = editGoals ?? config.missionGoals;
                    setEditGoals(base.filter((_, j) => j !== i));
                  }}
                  className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors"
                  title="Remove goal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Description row */}
              <div>
                <Textarea
                  value={goal.description ?? ""}
                  onChange={(e) => {
                    const base = editGoals ?? config.missionGoals;
                    setEditGoals(base.map((g, j) => j === i ? { ...g, description: e.target.value } : g));
                  }}
                  rows={2}
                  placeholder="Describe this goal for the AI — e.g. 'Proposals that directly increase recurring income for coop members through employment, cooperative returns, or revenue-sharing...'"
                  className="bg-slate-800 border-slate-600 text-white text-xs resize-none placeholder:text-gray-600"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Add new goal */}
        <div className="mt-4 rounded-md border border-dashed border-slate-600 p-3 space-y-2">
          <p className="text-xs text-gray-500 font-medium">Add new goal</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={newGoalLabel}
                onChange={(e) => {
                  setNewGoalLabel(e.target.value);
                  if (!newGoalKey) {
                    setNewGoalKey(e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
                  }
                }}
                placeholder="Label (e.g. Income Stability)"
                className="bg-slate-900 border-slate-600 text-white text-sm h-8"
              />
            </div>
            <div className="w-36">
              <Input
                value={newGoalKey}
                onChange={(e) => setNewGoalKey(e.target.value)}
                placeholder="key"
                className="bg-slate-900 border-slate-600 text-white font-mono text-xs h-8"
              />
            </div>
            <div className="w-24 flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={100}
                value={newGoalWeight}
                onChange={(e) => setNewGoalWeight(e.target.value)}
                placeholder="0"
                className="bg-slate-900 border-slate-600 text-white text-sm h-8"
              />
              <span className="text-gray-500 text-sm flex-shrink-0">%</span>
            </div>
          </div>
          <Textarea
            value={newGoalDescription}
            onChange={(e) => setNewGoalDescription(e.target.value)}
            rows={2}
            placeholder="Describe this goal for the AI — what should it look for in proposals?"
            className="bg-slate-900 border-slate-600 text-white text-xs resize-none placeholder:text-gray-600"
          />
          <button
            type="button"
            onClick={() => {
              if (!newGoalLabel.trim() || !newGoalKey.trim() || !newGoalWeight) return;
              const base = editGoals ?? config.missionGoals;
              setEditGoals([...base, {
                key: newGoalKey.trim(),
                label: newGoalLabel.trim(),
                priorityWeight: parseFloat(newGoalWeight) / 100,
                description: newGoalDescription.trim() || undefined,
              }]);
              setNewGoalKey("");
              setNewGoalLabel("");
              setNewGoalWeight("");
              setNewGoalDescription("");
            }}
            disabled={!newGoalLabel.trim() || !newGoalKey.trim() || !newGoalWeight}
            className="flex items-center gap-1 px-3 h-8 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Goal
          </button>
        </div>
      </ConfigSectionEditor>

      {/* Structural Weights */}
      <ConfigSectionEditor
        title="Structural Weights"
        description="How each structural check contributes to the structural score. All three must sum to 100%."
        isDirty={!!(editFeasibilityWeight || editRiskWeight || editAccountabilityWeight)}
        onSave={async (reason) => {
          const feasibility = editFeasibilityWeight ? parseFloat(editFeasibilityWeight) / 100 : config.structuralWeights.feasibility;
          const risk = editRiskWeight ? parseFloat(editRiskWeight) / 100 : config.structuralWeights.risk;
          const accountability = editAccountabilityWeight ? parseFloat(editAccountabilityWeight) / 100 : config.structuralWeights.accountability;
          await propose("structuralWeights", { structuralWeights: { feasibility, risk, accountability } }, { structuralWeights: config.structuralWeights })(reason);
        }}
        isSaving={proposeChange.isPending}
        {...sectionReview("structuralWeights")}
        coopId={coopId}
      >
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Feasibility %</span>
            <Input
              type="number"
              defaultValue={Math.round(config.structuralWeights.feasibility * 100)}
              onChange={(e) => setEditFeasibilityWeight(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
          <div>
            <span className="text-gray-500">Risk %</span>
            <Input
              type="number"
              defaultValue={Math.round(config.structuralWeights.risk * 100)}
              onChange={(e) => setEditRiskWeight(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
          <div>
            <span className="text-gray-500">Accountability %</span>
            <Input
              type="number"
              defaultValue={Math.round(config.structuralWeights.accountability * 100)}
              onChange={(e) => setEditAccountabilityWeight(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
        </div>
      </ConfigSectionEditor>

      {/* Score Mix */}
      <ConfigSectionEditor
        title="Score Mix"
        description="How mission impact and structural scores are blended into the final overall score. Must sum to 100%."
        isDirty={!!(editMissionWeight || editStructuralWeight)}
        onSave={async (reason) => {
          const missionWeight = editMissionWeight ? parseFloat(editMissionWeight) / 100 : config.scoreMix.missionWeight;
          const structuralWeight = editStructuralWeight ? parseFloat(editStructuralWeight) / 100 : config.scoreMix.structuralWeight;
          await propose("scoreMix", { scoreMix: { missionWeight, structuralWeight } }, { scoreMix: config.scoreMix })(reason);
        }}
        isSaving={proposeChange.isPending}
        {...sectionReview("scoreMix")}
        coopId={coopId}
      >
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Mission Weight %</span>
            <Input
              type="number"
              defaultValue={Math.round(config.scoreMix.missionWeight * 100)}
              onChange={(e) => setEditMissionWeight(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
          <div>
            <span className="text-gray-500">Structural Weight %</span>
            <Input
              type="number"
              defaultValue={Math.round(config.scoreMix.structuralWeight * 100)}
              onChange={(e) => setEditStructuralWeight(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
        </div>
      </ConfigSectionEditor>

      {/* Screening Threshold */}
      <ConfigSectionEditor
        title="Screening Threshold"
        description="Minimum overall score (0–100%) a proposal needs to pass AI screening. Below this it gets a 'revise' decision."
        isDirty={editPassThreshold !== ""}
        onSave={async (reason) => {
          const screeningPassThreshold = editPassThreshold ? parseFloat(editPassThreshold) / 100 : config.screeningPassThreshold;
          await propose("screeningPassThreshold", { screeningPassThreshold }, { screeningPassThreshold: config.screeningPassThreshold })(reason);
        }}
        isSaving={proposeChange.isPending}
        {...sectionReview("screeningPassThreshold")}
        coopId={coopId}
      >
        <div className="text-sm">
          <span className="text-gray-500">Pass Threshold %</span>
          <Input
            type="number"
            defaultValue={Math.round(config.screeningPassThreshold * 100)}
            onChange={(e) => setEditPassThreshold(e.target.value)}
            className="bg-slate-900 border-slate-600 text-white mt-1 max-w-xs"
          />
        </div>
      </ConfigSectionEditor>

      {/* Voting Rules */}
      <ConfigSectionEditor
        title="Voting Rules"
        description="Quorum, approval threshold, and voting window applied to all coop votes."
        isDirty={!!(editQuorum || editApproval || editWindow)}
        onSave={async (reason) => {
          const changes = {
            quorumPercent:            editQuorum   ? parseFloat(editQuorum)  : config.quorumPercent,
            approvalThresholdPercent: editApproval ? parseFloat(editApproval): config.approvalThresholdPercent,
            votingWindowDays:         editWindow   ? parseInt(editWindow)    : config.votingWindowDays,
          };
          await propose("votingRules", changes, {
            quorumPercent: config.quorumPercent,
            approvalThresholdPercent: config.approvalThresholdPercent,
            votingWindowDays: config.votingWindowDays,
          })(reason);
        }}
        isSaving={proposeChange.isPending}
        {...sectionReview("votingRules")}
        coopId={coopId}
      >
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Quorum %</span>
            <Input
              type="number"
              defaultValue={config.quorumPercent}
              onChange={(e) => setEditQuorum(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
          <div>
            <span className="text-gray-500">Approval %</span>
            <Input
              type="number"
              defaultValue={config.approvalThresholdPercent}
              onChange={(e) => setEditApproval(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
          <div>
            <span className="text-gray-500">Voting Window (days)</span>
            <Input
              type="number"
              defaultValue={config.votingWindowDays}
              onChange={(e) => setEditWindow(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white mt-1"
            />
          </div>
        </div>
      </ConfigSectionEditor>

      {/* Proposal Categories */}
      <ConfigSectionEditor
        title="Proposal Categories"
        description="Toggle categories on/off, edit labels and descriptions, or add new ones. The description is shown to submitters and sent to the AI."
        isDirty={editCategories !== null}
        onSave={propose("proposalCategories", { proposalCategories: editCategories ?? config.proposalCategories }, { proposalCategories: config.proposalCategories })}
        isSaving={proposeChange.isPending}
        {...sectionReview("proposalCategories")}
        coopId={coopId}
      >
        <p className="text-xs text-gray-500 mb-3">
          Toggle categories on/off, edit descriptions, or add new ones. The <span className="text-amber-400 font-medium">description</span> is shown to proposal submitters and sent to the AI to guide screening.
        </p>

        {/* Category list */}
        <div className="space-y-3">
          {(editCategories ?? config.proposalCategories).map((cat, i) => {
            const active = cat.isActive;
            return (
              <div key={i} className="rounded-md border border-slate-700 bg-slate-900 p-3 space-y-2">
                {/* Top row: toggle, label, key, remove */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const base = editCategories ?? config.proposalCategories;
                      setEditCategories(base.map((c, j) => j === i ? { ...c, isActive: !c.isActive } : c));
                    }}
                    className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
                    title={active ? "Deactivate" : "Activate"}
                  >
                    {active
                      ? <ToggleRight className="h-5 w-5 text-green-400" />
                      : <ToggleLeft className="h-5 w-5 text-gray-500" />
                    }
                  </button>
                  <div className="flex-1 min-w-0">
                    <Input
                      value={cat.label}
                      onChange={(e) => {
                        const base = editCategories ?? config.proposalCategories;
                        setEditCategories(base.map((c, j) => j === i ? { ...c, label: e.target.value } : c));
                      }}
                      className={`bg-slate-800 border-slate-600 text-sm h-8 ${active ? "text-white" : "text-gray-500"}`}
                      placeholder="Label"
                    />
                  </div>
                  <div className="w-36">
                    <Input
                      value={cat.key}
                      onChange={(e) => {
                        const base = editCategories ?? config.proposalCategories;
                        setEditCategories(base.map((c, j) => j === i ? { ...c, key: e.target.value } : c));
                      }}
                      className="bg-slate-800 border-slate-600 text-gray-400 font-mono text-xs h-8"
                      placeholder="key"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const base = editCategories ?? config.proposalCategories;
                      setEditCategories(base.filter((_, j) => j !== i));
                    }}
                    className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors"
                    title="Remove category"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Description row */}
                <Textarea
                  value={cat.description ?? ""}
                  onChange={(e) => {
                    const base = editCategories ?? config.proposalCategories;
                    setEditCategories(base.map((c, j) => j === i ? { ...c, description: e.target.value } : c));
                  }}
                  rows={2}
                  placeholder="Describe this category for submitters and the AI — what kinds of proposals belong here?"
                  className="bg-slate-800 border-slate-600 text-white text-xs resize-none placeholder:text-gray-600"
                />
              </div>
            );
          })}
        </div>

        {/* Add new category */}
        <div className="mt-4 rounded-md border border-dashed border-slate-600 p-3 space-y-2">
          <p className="text-xs text-gray-500 font-medium">Add new category</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={newCategoryLabel}
                onChange={(e) => {
                  setNewCategoryLabel(e.target.value);
                  if (!newCategoryKey) {
                    setNewCategoryKey(e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
                  }
                }}
                placeholder="Label (e.g. Community Projects)"
                className="bg-slate-900 border-slate-600 text-white text-sm h-8"
              />
            </div>
            <div className="w-40">
              <Input
                value={newCategoryKey}
                onChange={(e) => setNewCategoryKey(e.target.value)}
                placeholder="community_projects"
                className="bg-slate-900 border-slate-600 text-white font-mono text-xs h-8"
              />
            </div>
          </div>
          <Textarea
            value={newCategoryDescription}
            onChange={(e) => setNewCategoryDescription(e.target.value)}
            rows={2}
            placeholder="Describe this category for submitters and the AI..."
            className="bg-slate-900 border-slate-600 text-white text-xs resize-none placeholder:text-gray-600"
          />
          <button
            type="button"
            onClick={() => {
              if (!newCategoryLabel.trim() || !newCategoryKey.trim()) return;
              const base = editCategories ?? config.proposalCategories;
              setEditCategories([...base, {
                key: newCategoryKey.trim(),
                label: newCategoryLabel.trim(),
                isActive: true,
                description: newCategoryDescription.trim() || undefined,
              }]);
              setNewCategoryKey("");
              setNewCategoryLabel("");
              setNewCategoryDescription("");
            }}
            disabled={!newCategoryLabel.trim() || !newCategoryKey.trim()}
            className="flex items-center gap-1 px-3 h-8 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Category
          </button>
        </div>
      </ConfigSectionEditor>

      {/* Sector Exclusions */}
      <ConfigSectionEditor
        title="Sector Exclusions"
        description="Proposals matching these sectors are flagged during AI screening. The description explains the exclusion to the AI."
        isDirty={editExclusions !== null}
        onSave={propose("sectorExclusions", { sectorExclusions: editExclusions ?? config.sectorExclusions }, { sectorExclusions: config.sectorExclusions })}
        isSaving={proposeChange.isPending}
        {...sectionReview("sectorExclusions")}
        coopId={coopId}
      >

        {/* Exclusion rows */}
        <div className="space-y-3">
          {(editExclusions ?? config.sectorExclusions).map((excl, i) => (
            <div key={i} className="rounded-md border border-red-800/30 bg-red-950/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={excl.value}
                  onChange={(e) => {
                    const base = editExclusions ?? config.sectorExclusions;
                    setEditExclusions(base.map((ex, j) => j === i ? { ...ex, value: e.target.value } : ex));
                  }}
                  className="bg-slate-900 border-slate-700 text-red-300 font-mono text-sm h-8 flex-1"
                  placeholder="sector keyword"
                />
                <button
                  type="button"
                  onClick={() => {
                    const base = editExclusions ?? config.sectorExclusions;
                    setEditExclusions(base.filter((_, j) => j !== i));
                  }}
                  className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Textarea
                value={excl.description ?? ""}
                onChange={(e) => {
                  const base = editExclusions ?? config.sectorExclusions;
                  setEditExclusions(base.map((ex, j) => j === i ? { ...ex, description: e.target.value } : ex));
                }}
                rows={2}
                placeholder="Explain why this sector is excluded — the AI uses this to understand the rule..."
                className="bg-slate-900 border-slate-700 text-white text-xs resize-none placeholder:text-gray-600"
              />
            </div>
          ))}
          {(editExclusions ?? config.sectorExclusions).length === 0 && (
            <p className="text-xs text-gray-600">No exclusions set</p>
          )}
        </div>

        {/* Add new exclusion */}
        <div className="mt-4 rounded-md border border-dashed border-slate-600 p-3 space-y-2">
          <p className="text-xs text-gray-500 font-medium">Add new exclusion</p>
          <Input
            value={newExclusionValue}
            onChange={(e) => setNewExclusionValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const val = newExclusionValue.trim().toLowerCase();
                if (!val) return;
                const base = editExclusions ?? config.sectorExclusions;
                if (!base.some(ex => ex.value === val)) {
                  setEditExclusions([...base, { value: val, description: newExclusionDescription.trim() || undefined }]);
                  setNewExclusionValue("");
                  setNewExclusionDescription("");
                }
              }
            }}
            placeholder="Sector keyword (e.g. alcohol)"
            className="bg-slate-900 border-slate-600 text-white font-mono text-sm h-8"
          />
          <Textarea
            value={newExclusionDescription}
            onChange={(e) => setNewExclusionDescription(e.target.value)}
            rows={2}
            placeholder="Why is this sector excluded? The AI uses this to flag matching proposals..."
            className="bg-slate-900 border-slate-600 text-white text-xs resize-none placeholder:text-gray-600"
          />
          <button
            type="button"
            onClick={() => {
              const val = newExclusionValue.trim().toLowerCase();
              if (!val) return;
              const base = editExclusions ?? config.sectorExclusions;
              if (!base.some(ex => ex.value === val)) {
                setEditExclusions([...base, { value: val, description: newExclusionDescription.trim() || undefined }]);
                setNewExclusionValue("");
                setNewExclusionDescription("");
              }
            }}
            disabled={!newExclusionValue.trim()}
            className="flex items-center gap-1 px-3 h-8 rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Exclusion
          </button>
        </div>
      </ConfigSectionEditor>

      {/* Submission Requirements */}
      <ConfigSectionEditor
        title="Submission Requirements"
        description={`Minimum ${coin.symbol} token balance a member must hold to submit a proposal.`}
        isDirty={editMinSc !== ""}
        onSave={async (reason) => {
          const minScBalanceToSubmit = editMinSc ? parseFloat(editMinSc) : config.minScBalanceToSubmit;
          await propose("submissionRequirements", { minScBalanceToSubmit }, { minScBalanceToSubmit: config.minScBalanceToSubmit })(reason);
        }}
        isSaving={proposeChange.isPending}
        {...sectionReview("submissionRequirements")}
        coopId={coopId}
      >
        <div className="text-sm">
          <span className="text-gray-500">Min SC Balance to Submit</span>
          <Input
            type="number"
            defaultValue={config.minScBalanceToSubmit}
            onChange={(e) => setEditMinSc(e.target.value)}
            className="bg-slate-900 border-slate-600 text-white mt-1 max-w-xs"
          />
        </div>
      </ConfigSectionEditor>

      {/* Approval Tiers */}
      <ConfigSectionEditor
        title="Approval Tiers"
        description="Dollar thresholds that determine who approves a proposal after it passes AI screening."
        isDirty={!!(editAutoApproveThreshold || editCouncilThreshold)}
        onSave={async (reason) => {
          const changes = {
            aiAutoApproveThresholdUSD: editAutoApproveThreshold ? parseFloat(editAutoApproveThreshold) : config.aiAutoApproveThresholdUSD ?? 500,
            councilVoteThresholdUSD:   editCouncilThreshold     ? parseFloat(editCouncilThreshold)     : config.councilVoteThresholdUSD   ?? 5000,
          };
          await propose("approvalTiers", changes, {
            aiAutoApproveThresholdUSD: config.aiAutoApproveThresholdUSD,
            councilVoteThresholdUSD: config.councilVoteThresholdUSD,
          })(reason);
        }}
        isSaving={proposeChange.isPending}
        {...sectionReview("approvalTiers")}
        coopId={coopId}
      >

        {/* Visual tier diagram */}
        <div className="mb-5 flex flex-col gap-2">
          {[
            {
              icon: <Bot className="h-4 w-4 text-emerald-400" />,
              color: "border-emerald-700/40 bg-emerald-900/10",
              label: "AI Auto-Approve",
              labelColor: "text-emerald-400",
              range: `< $${(editAutoApproveThreshold ? parseFloat(editAutoApproveThreshold) : config.aiAutoApproveThresholdUSD ?? 500).toLocaleString()}`,
              desc: "Passes screening + below auto-approve threshold → immediately approved, no human vote needed.",
            },
            {
              icon: <Users className="h-4 w-4 text-amber-400" />,
              color: "border-amber-700/40 bg-amber-900/10",
              label: "Council Vote",
              labelColor: "text-amber-400",
              range: `$${(editAutoApproveThreshold ? parseFloat(editAutoApproveThreshold) : config.aiAutoApproveThresholdUSD ?? 500).toLocaleString()} – $${(editCouncilThreshold ? parseFloat(editCouncilThreshold) : config.councilVoteThresholdUSD ?? 5000).toLocaleString()}`,
              desc: "Passes screening + between the two thresholds → council members vote to approve or reject.",
            },
            {
              icon: <Globe className="h-4 w-4 text-blue-400" />,
              color: "border-blue-700/40 bg-blue-900/10",
              label: "Full Coop Vote",
              labelColor: "text-blue-400",
              range: `≥ $${(editCouncilThreshold ? parseFloat(editCouncilThreshold) : config.councilVoteThresholdUSD ?? 5000).toLocaleString()}`,
              desc: "Passes screening + above council threshold → all coop members vote using governance rules.",
            },
          ].map((tier) => (
            <div key={tier.label} className={`flex items-start gap-3 rounded-lg border p-3 ${tier.color}`}>
              <div className="mt-0.5 flex-shrink-0">{tier.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`text-sm font-semibold ${tier.labelColor}`}>{tier.label}</span>
                  <span className="font-mono text-xs text-gray-400 bg-slate-900 px-2 py-0.5 rounded">{tier.range}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{tier.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Editable thresholds */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-gray-400 font-medium">AI Auto-Approve Limit (USD)</span>
            </div>
            <p className="text-xs text-gray-600">Proposals under this amount are auto-approved by AI.</p>
            <Input
              type="number"
              defaultValue={config.aiAutoApproveThresholdUSD ?? 500}
              onChange={(e) => setEditAutoApproveThreshold(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-gray-400 font-medium">Full Coop Vote Limit (USD)</span>
            </div>
            <p className="text-xs text-gray-600">Proposals at or above this amount require a full coop vote.</p>
            <Input
              type="number"
              defaultValue={config.councilVoteThresholdUSD ?? 5000}
              onChange={(e) => setEditCouncilThreshold(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white"
            />
          </div>
        </div>
      </ConfigSectionEditor>

      {/* Member Benefits */}
      <ConfigSectionEditor
        title="Member Benefits"
        description="Benefits shown to applicants and on the public newsletter page. Update them here so the co-op config stays the source of truth."
        isDirty={editFeatures !== null}
        onSave={propose("displayFeatures", { displayFeatures: editFeatures ?? config.displayFeatures ?? [] }, { displayFeatures: config.displayFeatures ?? [] })}
        isSaving={proposeChange.isPending}
        {...sectionReview("displayFeatures")}
        coopId={coopId}
      >
        <div className="space-y-3">
          {(editFeatures ?? config.displayFeatures ?? []).map((feature, i) => (
            <div key={i} className="rounded-md border border-slate-600 bg-slate-900/50 p-4 space-y-3">
              <div className="space-y-2">
                <Label className="text-gray-300">Benefit Title</Label>
                <Input
                  value={feature.title}
                  onChange={(e) => {
                    const base = editFeatures ?? config.displayFeatures ?? [];
                    setEditFeatures(base.map((f, j) => j === i ? { ...f, title: e.target.value } : f));
                  }}
                  className="bg-slate-900 border-slate-600 text-white"
                  placeholder="e.g., Shared Wealth Fund"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-300">Benefit Description</Label>
                <Textarea
                  value={feature.description}
                  onChange={(e) => {
                    const base = editFeatures ?? config.displayFeatures ?? [];
                    setEditFeatures(base.map((f, j) => j === i ? { ...f, description: e.target.value } : f));
                  }}
                  rows={2}
                  className="bg-slate-900 border-slate-600 text-white text-sm resize-none"
                  placeholder="Explain the benefit..."
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const base = editFeatures ?? config.displayFeatures ?? [];
                  setEditFeatures(base.filter((_, j) => j !== i));
                }}
                className="text-red-400 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove Benefit
              </Button>
            </div>
          ))}
          {(editFeatures ?? config.displayFeatures ?? []).length === 0 && (
            <p className="text-xs text-gray-600">No member benefits configured</p>
          )}
        </div>

        <div className="mt-4 rounded-md border border-dashed border-slate-600 p-4 space-y-3">
          <p className="text-xs text-gray-500 font-medium">Add new member benefit</p>
          <Input
            value={newFeatureTitle}
            onChange={(e) => setNewFeatureTitle(e.target.value)}
            placeholder="Benefit title"
            className="bg-slate-900 border-slate-600 text-white"
          />
          <Textarea
            value={newFeatureDescription}
            onChange={(e) => setNewFeatureDescription(e.target.value)}
            rows={2}
            placeholder="Benefit description"
            className="bg-slate-900 border-slate-600 text-white text-sm resize-none"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const title = newFeatureTitle.trim();
              const description = newFeatureDescription.trim();
              if (!title || !description) return;
              const base = editFeatures ?? config.displayFeatures ?? [];
              setEditFeatures([...base, { title, description }]);
              setNewFeatureTitle("");
              setNewFeatureDescription("");
            }}
            disabled={!newFeatureTitle.trim() || !newFeatureDescription.trim()}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Benefit
          </Button>
        </div>
      </ConfigSectionEditor>

      {/* Eligibility */}
      <ConfigSectionEditor
        title="Eligibility Requirements"
        description="Who can join this coop? Shown during onboarding to help potential members understand if they qualify."
        isDirty={editEligibility !== null}
        onSave={propose("eligibility", { eligibility: editEligibility ?? config.eligibility ?? "" }, { eligibility: config.eligibility ?? "" })}
        isSaving={proposeChange.isPending}
        {...sectionReview("eligibility")}
        coopId={coopId}
      >
        <Textarea
          value={editEligibility ?? config.eligibility ?? ""}
          onChange={(e) => setEditEligibility(e.target.value)}
          rows={4}
          className="bg-slate-900 border-slate-600 text-white text-sm resize-y"
          placeholder="e.g., Open to Black Americans, Afro-Caribbean, African immigrants, and allies (non-voting)"
        />
      </ConfigSectionEditor>

      {/* Link to Application Form Editor */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Application Form</CardTitle>
          <CardDescription className="text-gray-400">
            Manage membership application questions separately from governance config
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href={`/portal/${coopId}/settings/application-form`}>
              Edit Application Questions
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Change History */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader><CardTitle className="text-white">Change History</CardTitle></CardHeader>
        <CardContent>
          {versions && versions.length > 0 ? (
            <div className="space-y-2">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-sm p-2 bg-slate-900 rounded">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-mono">
                        {v.sequence ? `#${v.sequence}` : "Pending"}
                      </span>
                      <Badge className="bg-slate-700/60 text-slate-300 text-xs">
                        {v.status}
                      </Badge>
                      {v.section && (
                        <span className="text-xs text-gray-500 truncate">
                          {v.section}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs truncate">{v.reason}</p>
                  </div>
                  <div className="text-gray-500 text-xs shrink-0">
                    {new Date(v.changedAt).toLocaleDateString()} | {v.changedBy}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No change history available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

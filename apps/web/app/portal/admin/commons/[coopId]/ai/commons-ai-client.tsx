"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface SourceContent {
  content: string; createdAt: string;
  author: { name: string | null; handle: string | null };
}
interface ActionRow {
  id: string; type: string; status: string; summary: string; evidence: string | null;
  draftText: string | null; confidence: number; sourceType: string; sourceId: string;
  publishedCommentId: string | null; createdAt: string;
  generatedDraftText: string | null;
  feedback: { rating: "GOOD" | "NEEDS_WORK"; reasons: string[]; notes: string | null; correctedText: string | null } | null;
  source: SourceContent | null; parentPost: SourceContent | null;
}
interface FeedbackEdit { rating: "GOOD" | "NEEDS_WORK" | ""; reasons: string[]; notes: string; correctedText: string }
const FEEDBACK_REASONS = [
  ["WRONG_ACTION", "Wrong action"], ["INCORRECT_CHARTER_USE", "Charter or goal misused"],
  ["INACCURATE", "Inaccurate"], ["MISSED_CONTEXT", "Missed context"],
  ["TONE", "Tone"], ["UNCLEAR", "Unclear"], ["OTHER", "Other"],
] as const;
function feedbackValue(action: ActionRow): FeedbackEdit {
  return { rating: action.feedback?.rating ?? "", reasons: action.feedback?.reasons ?? [],
    notes: action.feedback?.notes ?? "", correctedText: action.feedback?.correctedText ?? "" };
}
interface ResourceRow { id: string; title: string; kind: string; status: string; candidateUserId: string | null; }
interface NeededToolRow { capability: string; count: number; sampleActionIds: string[] }
interface EscalationRow { id: string; summary: string; type: string; circleId: string | null; reviews: { id: string; reviewType: string; userId: string }[] }
type TrailStage = "OBSERVED" | "EVIDENCE" | "CONSIDERED" | "POLICY" | "TAKEN" | "RESULT" | "FOLLOW_UP";
interface Trail {
  id: string; agent: string; agentLabel: string; proposalId: string | null; circleId: string | null; sourceType: string; sourceId: string; trigger: string; triggerLabel: string;
  outcome: string; createdAt: string; actionIds: string[];
  observed: { title?: string; content?: string; context?: string; circleName?: string; itemCount?: number; items?: { author: string; content: string; at: string }[] };
  steps: { stage: TrailStage; label: string; detail?: string; outcome?: "PASS" | "FAIL" | "INFO"; adminOnly?: boolean }[];
}

interface Dashboard {
  setting: { autoReply: boolean; backfillPostsDone: boolean; backfillCommentsDone: boolean };
  autonomy: { usd: number; calls: number; usdLimit: number; callLimit: number; paused: boolean; resetsAt: string };
  circles: { id: string; name: string; pendingMessages: number; lastAnalyzedAt: string | null }[];
  trails: Trail[];
  skippedRepeats: { createdAt: string; title: string | null; matched: { id: string; summary: string; status: string; circleId: string | null } }[];
  actions: ActionRow[];
  resources: ResourceRow[];
  costs: {
    byFeature: Array<{ feature: string; model: string; calls: number; estimatedUsd: number; unknown: number }>;
    byDay: Array<{ day: string; estimatedUsd: number; unknown: number }>;
    byMonth: Array<{ month: string; estimatedUsd: number; unknown: number; calls: number }>;
  };
  neededTools: NeededToolRow[];
  escalations: EscalationRow[];
}

export default function CommonsAIClient({ apiUrl, token }: { apiUrl: string; token: string }) {
  const { coopId } = useParams<{ coopId: string }>();
  const [data, setData] = useState<Dashboard | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedbackEdits, setFeedbackEdits] = useState<Record<string, FeedbackEdit>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openTrailId, setOpenTrailId] = useState<string | null>(null);
  const [trailAgent, setTrailAgent] = useState("");
  const endpoint = `${apiUrl}/commonsActionsAdmin`;
  const refresh = useCallback(async () => {
    const input = encodeURIComponent(JSON.stringify({ coopId, ...(trailAgent ? { trailAgent } : {}) }));
    const response = await fetch(`${endpoint}.dashboard?input=${input}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not load AI actions. Reload this page if your admin session expired.");
    if (!body.result?.data) throw new Error("The API did not return Commons AI actions.");
    setData(body.result?.data);
  }, [endpoint, coopId, token, trailAgent]);
  useEffect(() => { void refresh().catch((cause) => setError(String(cause))); }, [refresh]);

  async function command(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${endpoint}.command`, { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}`,
      }, body: JSON.stringify({ coopId, ...body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Action failed. Reload this page if your admin session expired.");
      await refresh();
      return result.result?.data ?? null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally { setBusy(false); }
  }
  async function analyzeCircle(groupId: string) {
    const result = await command({ command: "analyze-circle", groupId });
    const trailId = typeof result?.trailId === "string" ? result.trailId : null;
    if (trailId) {
      setOpenTrailId(trailId);
      setTimeout(() => document.getElementById(`trail-${trailId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  return <div className="space-y-7 text-white">
    <Link href={`/portal/admin/commons/${coopId}`} className="text-sm text-slate-400 hover:text-white">← Commons details</Link>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Commons AI actions</h1><p className="text-sm text-slate-400">Platform admin controls for {coopId}</p></div>
      <button disabled={busy} onClick={() => void command({ command: "scan" })} className="rounded-md bg-orange-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Run one scan page</button>
    </div>
    {error && <p role="alert" className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-red-200">{error}</p>}
    {data && <>
      <section className="rounded-lg border border-white/10 bg-white/5 p-5">
        <label className="flex items-center justify-between gap-4">
          <span><strong>Auto-reply</strong><span className="block text-sm text-slate-400">Public replies to content from the past 48 hours. Platform admins can remove replies.</span></span>
          <input type="checkbox" checked={data.setting.autoReply} disabled={busy} onChange={(event) => void command({ command: "auto-reply", enabled: event.target.checked })} className="h-5 w-5 accent-orange-300" />
        </label>
        <p className="mt-3 text-xs text-slate-400">Backfill: posts {data.setting.backfillPostsDone ? "complete" : "in progress"}; comments {data.setting.backfillCommentsDone ? "complete" : "in progress"}.</p>
      </section>
      <AutonomyLimits key={`${data.autonomy.usdLimit}:${data.autonomy.callLimit}`} autonomy={data.autonomy} busy={busy}
        onSave={(monthlyUsdLimit, monthlyCallLimit) => void command({ command: "autonomy-limits", monthlyUsdLimit, monthlyCallLimit })} />
      <section className="rounded-lg border border-white/10 bg-white/5 p-5">
        <strong>Circles</strong>
        <p className="mt-1 text-sm text-slate-400">Sage reads a circle after 40 new messages, posts or comments. Analyze now to have it read what&apos;s there without waiting. This runs Sage on its own and counts toward the autonomy limit.</p>
        {data.circles.length ? <ul className="mt-3 divide-y divide-white/10">{data.circles.map((circle) => {
          const circleName = circle.name.trim();
          const circleCountLabel = circle.pendingMessages === 1 ? "1 new item" : `${circle.pendingMessages} new items`;
          return <li key={circle.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span><span className="font-semibold">{circleName}</span><span className="block text-xs text-slate-400">{circleCountLabel} since Sage last read it{circle.lastAnalyzedAt ? ` · last read ${new Date(circle.lastAnalyzedAt).toLocaleString()}` : " · never read"}</span></span>
            <button disabled={busy || circle.pendingMessages < 1} aria-label={`Analyze ${circleName} now`} onClick={() => void analyzeCircle(circle.id)} className="rounded-md border border-orange-300/60 px-3 py-1.5 text-sm font-semibold text-orange-200 disabled:opacity-40">Analyze now</button>
          </li>;
        })}</ul> : <p className="mt-3 text-sm text-slate-400">No circles yet.</p>}
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Decision trails</h2>
          <label className="text-sm text-slate-300">Agent{" "}
            <select aria-label="Filter decision trails by agent" value={trailAgent} onChange={(event) => setTrailAgent(event.target.value)}
              className="ml-1 rounded-md border border-white/20 bg-slate-900 px-2 py-1">
              <option value="">All agents</option>
              {Object.entries(AGENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-400">Every Sage analysis in this Commons, newest first: what it read, what it considered, each rule it checked, what it did, and what happened next. Includes analyses where Sage did nothing.</p>
        {data.trails.length ? data.trails.map((trail) => <TrailCard key={trail.id} trail={trail} open={openTrailId === trail.id}
          onToggle={() => setOpenTrailId(openTrailId === trail.id ? null : trail.id)} />) : <p className="text-sm text-slate-400">No analyses yet.</p>}
      </section>
      <section className="rounded-lg border border-white/10 bg-white/5 p-5">
        <strong>Skipped repeats</strong>
        <p className="mt-1 text-sm text-slate-400">Suggestions Sage didn&apos;t make because a recent one in the same circle already covered them: the same post, or the same kind with a near-identical title, still pending or declined/done within 30 days.</p>
        {data.skippedRepeats.length ? <ul className="mt-3 space-y-2 text-sm">{data.skippedRepeats.map((repeat, index) => <li key={`${repeat.matched.id}:${repeat.createdAt}:${index}`}>
          <span className="text-slate-400">{new Date(repeat.createdAt).toLocaleString()}</span> · skipped &ldquo;{repeat.title ?? "untitled"}&rdquo; — repeats &ldquo;{repeat.matched.summary}&rdquo; ({repeat.matched.status.toLowerCase()})
        </li>)}</ul> : <p className="mt-3 text-sm text-slate-400">None yet.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Estimated AI costs · past 31 days</h2>
        <p className="text-2xl font-bold">${data.costs.byFeature.reduce((sum, row) => sum + row.estimatedUsd, 0).toFixed(4)}</p>
        <p className="text-xs text-slate-400">Usage missing from {data.costs.byFeature.reduce((sum, row) => sum + row.unknown, 0)} calls; estimates exclude those calls.</p>
        <div className="overflow-x-auto rounded-lg border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-slate-400"><tr><th className="p-3">Feature</th><th className="p-3">Model</th><th className="p-3">Calls</th><th className="p-3">Estimated cost</th><th className="p-3">Unknown</th></tr></thead><tbody>{data.costs.byFeature.map((row) => <tr key={`${row.feature}:${row.model}`} className="border-t border-white/10"><td className="p-3">{row.feature}</td><td className="p-3">{row.model}</td><td className="p-3">{row.calls}</td><td className="p-3">${row.estimatedUsd.toFixed(4)}</td><td className="p-3">{row.unknown}</td></tr>)}</tbody></table></div>
        <details><summary className="cursor-pointer text-sm text-orange-200">Daily totals</summary><ul className="mt-2 space-y-1 text-sm text-slate-300">{data.costs.byDay.map((day) => <li key={day.day}>{day.day}: ${day.estimatedUsd.toFixed(4)} · {day.unknown} unknown</li>)}</ul></details>
        <details><summary className="cursor-pointer text-sm text-orange-200">Monthly totals</summary><ul className="mt-2 space-y-1 text-sm text-slate-300">{data.costs.byMonth.map((month) => <li key={month.month}>{month.month}: ${month.estimatedUsd.toFixed(4)} · {month.calls} calls · {month.unknown} unknown</li>)}</ul></details>
        <p className="text-xs text-slate-500">Estimates include recorded token charges. Provider tool fees and calls without usage are excluded.</p>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Needed tools</h2>
        <p className="text-sm text-slate-400">Capabilities Sage tried to use but hasn't been built yet. A count going up is a signal worth building it.</p>
        {data.neededTools.length === 0 && <p className="text-sm text-slate-400">Nothing missing right now.</p>}
        {data.neededTools.length > 0 && <div className="overflow-x-auto rounded-lg border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-slate-400"><tr><th className="p-3">Capability</th><th className="p-3">Times requested</th><th className="p-3">Sample actions</th></tr></thead><tbody>{data.neededTools.map((row) => <tr key={row.capability} className="border-t border-white/10"><td className="p-3 font-mono">{row.capability}</td><td className="p-3">{row.count}</td><td className="p-3 text-xs text-slate-400">{row.sampleActionIds.join(", ")}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Escalated</h2>
        <p className="text-sm text-slate-400">A member asked an admin to look at these before deciding.</p>
        {data.escalations.length === 0 && <p className="text-sm text-slate-400">Nothing escalated right now.</p>}
        {data.escalations.map((action) => <div key={action.id} className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
          <p className="text-sm text-slate-400">{action.type}{action.circleId ? ` · circle ${action.circleId}` : ""}</p>
          <p>{action.summary}</p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => void command({ command: "approve", actionId: action.id })} className="rounded-md bg-orange-300 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-50">Approve</button>
            <button disabled={busy} onClick={() => void command({ command: "dismiss", actionId: action.id })} className="rounded-md border border-white/20 px-3 py-1.5 text-sm disabled:opacity-50">Dismiss</button>
          </div>
        </div>)}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Resource candidates</h2>
        {data.resources.length === 0 && <p className="text-sm text-slate-400">No resources found yet.</p>}
        {data.resources.map((resource) => <div key={resource.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3 text-sm"><span><strong>{resource.title}</strong> · {resource.kind} · {resource.status}{resource.kind === "PERSON" && !resource.candidateUserId ? " · recipient unresolved" : ""}</span>{resource.status !== "PUBLISHED" && resource.status !== "DECLINED" && <button disabled={busy || resource.kind === "PERSON" && resource.status !== "ACCEPTED"} onClick={() => void command({ command: "publish-resource", resourceId: resource.id })} className="rounded bg-white/10 px-3 py-1 disabled:opacity-40">Verify and publish</button>}</div>)}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Suggested actions</h2>
        {data.actions.length === 0 && <p className="text-sm text-slate-400">No actions yet.</p>}
        {data.actions.map((action) => <div key={action.id} className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{action.type.replaceAll("_", " ")}</strong><span className="text-slate-400">{action.status} · {Math.round(action.confidence * 100)}% · {action.sourceType}</span></div>
          <div className="space-y-3 rounded-md border border-white/10 bg-slate-950/60 p-3">
            {action.parentPost && <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">In post · {action.parentPost.author.name || (action.parentPost.author.handle ? `@${action.parentPost.author.handle}` : "Member")}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">{action.parentPost.content}</p>
            </div>}
            {action.source ? <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-200">Original {action.sourceType === "commons_comment" ? "comment" : "post"} · {action.source.author.name || (action.source.author.handle ? `@${action.source.author.handle}` : "Member")} · {new Date(action.source.createdAt).toLocaleString()}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-slate-200">{action.source.content}</p>
            </div> : <p className="text-slate-400">Original {action.sourceType === "commons_comment" ? "comment" : "post"} is no longer available.</p>}
          </div>
          <p>{action.summary}</p>{action.evidence && <p className="border-l-2 border-orange-300/60 pl-3 text-slate-300">Evidence: {action.evidence}</p>}
          {action.draftText && action.status !== "PENDING" && <div className="rounded-md border border-white/10 bg-slate-950/60 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{action.type === "MAKE_PROPOSAL" ? "Proposal starter" : "Agent reply"}</p><p className="mt-1 whitespace-pre-wrap break-words">{action.draftText}</p></div>}
          {action.draftText && action.status === "PENDING" && <textarea aria-label={`Draft for ${action.type}`} value={drafts[action.id] ?? action.draftText} onChange={(event) => setDrafts((current) => ({ ...current, [action.id]: event.target.value }))} className="min-h-20 w-full rounded border border-white/20 bg-slate-900 p-2 text-white" />}
          {action.generatedDraftText && action.generatedDraftText !== action.draftText && <details className="text-slate-300"><summary className="cursor-pointer text-xs text-orange-200">Original AI draft</summary><p className="mt-2 whitespace-pre-wrap break-words">{action.generatedDraftText}</p></details>}
          {action.status === "PENDING" && <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void command({ command: "approve", actionId: action.id })} className="rounded bg-orange-300 px-3 py-1 font-semibold text-slate-950">Approve</button><button disabled={busy || !action.draftText} onClick={() => void command({ command: "edit-draft", actionId: action.id, draftText: drafts[action.id] ?? action.draftText })} className="rounded bg-white/10 px-3 py-1">Save draft</button><button disabled={busy} onClick={() => void command({ command: "dismiss", actionId: action.id })} className="rounded bg-white/10 px-3 py-1">Dismiss</button></div>}
          {action.publishedCommentId && <button disabled={busy} onClick={() => void command({ command: "remove-reply", actionId: action.id })} className="rounded border border-red-400/40 px-3 py-1 text-red-200">Remove bot reply</button>}
          {(action.type === "MAKE_PROPOSAL" || ["RESPOND_CHARTER_CORRECTION", "RESPOND_MISSION_ALIGNMENT", "RESPOND_RESOURCE_FOLLOWUP", "ANSWER_QUESTION", "CLARIFY_NEED", "CONNECT_MEMBERS"].includes(action.type)) && (() => {
            const edit = feedbackEdits[action.id] ?? feedbackValue(action);
            const update = (patch: Partial<FeedbackEdit>) => setFeedbackEdits((current) => ({ ...current, [action.id]: { ...edit, ...patch } }));
            return <div className="space-y-3 rounded-md border border-white/10 p-3">
              <p className="font-semibold">Response feedback {action.feedback && <span className="font-normal text-slate-400">· Saved: {action.feedback.rating === "GOOD" ? "Good" : "Needs work"}</span>}</p>
              <div className="flex gap-4"><label className="flex items-center gap-2"><input type="radio" name={`rating-${action.id}`} checked={edit.rating === "GOOD"} onChange={() => update({ rating: "GOOD", reasons: [] })} />Good</label><label className="flex items-center gap-2"><input type="radio" name={`rating-${action.id}`} checked={edit.rating === "NEEDS_WORK"} onChange={() => update({ rating: "NEEDS_WORK" })} />Needs work</label></div>
              {edit.rating === "NEEDS_WORK" && <div><p className="mb-2 text-xs text-slate-400">Why does it need work?</p><div className="flex flex-wrap gap-x-4 gap-y-2">{FEEDBACK_REASONS.map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="checkbox" checked={edit.reasons.includes(value)} onChange={(event) => update({ reasons: event.target.checked ? [...edit.reasons, value] : edit.reasons.filter((reason) => reason !== value) })} />{label}</label>)}</div></div>}
              <textarea aria-label="Feedback notes" placeholder="Why was this good or what should change?" value={edit.notes} onChange={(event) => update({ notes: event.target.value })} maxLength={2000} className="min-h-16 w-full rounded border border-white/20 bg-slate-900 p-2 text-white" />
              <textarea aria-label="Corrected response" placeholder={action.type === "MAKE_PROPOSAL" ? "Better proposal starter (optional)" : "Better reply (optional)"} value={edit.correctedText} onChange={(event) => update({ correctedText: event.target.value })} maxLength={10000} className="min-h-24 w-full rounded border border-white/20 bg-slate-900 p-2 text-white" />
              <p className="text-xs text-slate-400">Feedback is saved for evaluation and future training. It does not change a published reply or the author’s proposal draft.</p>
              <button disabled={busy || !edit.rating || (edit.rating === "NEEDS_WORK" && edit.reasons.length === 0)} onClick={() => void command({ command: "rate-response", actionId: action.id, ...edit })} className="rounded bg-orange-300 px-3 py-1 font-semibold text-slate-950 disabled:opacity-40">Save feedback</button>
            </div>;
          })()}
        </div>)}
      </section>
    </>}
  </div>;
}

function AutonomyLimits({ autonomy, busy, onSave }: {
  autonomy: Dashboard["autonomy"];
  busy: boolean;
  onSave: (monthlyUsdLimit: number, monthlyCallLimit: number) => void;
}) {
  const [usd, setUsd] = useState(String(autonomy.usdLimit));
  const [calls, setCalls] = useState(String(autonomy.callLimit));
  const usdValue = Number(usd);
  const callValue = Number(calls);
  const valid = usd.trim() !== "" && calls.trim() !== "" && Number.isFinite(usdValue) && usdValue >= 0
    && Number.isInteger(callValue) && callValue >= 0;
  return <section className="rounded-lg border border-white/10 bg-white/5 p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong>Sage autonomy limit</strong>
      <span className={`text-sm font-semibold ${autonomy.paused ? "text-red-300" : "text-emerald-300"}`}>{autonomy.paused ? "Paused" : "Active"}</span>
    </div>
    <p className="mt-1 text-sm text-slate-400">Monthly cap on work Sage starts on its own (Commons replies, circle trend and ride-match detection). Member-requested AI is not counted. Resets {new Date(autonomy.resetsAt).toUTCString().slice(5, 16)}.</p>
    <p className="mt-2 text-sm">This month: ${autonomy.usd.toFixed(4)} of ${autonomy.usdLimit.toFixed(2)} · {autonomy.calls} of {autonomy.callLimit} calls</p>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (valid) onSave(Math.round(usdValue * 100) / 100, callValue); }}>
      <label className="text-sm">Monthly USD limit<input aria-label="Monthly USD limit" type="number" min="0" step="0.01" value={usd} onChange={(event) => setUsd(event.target.value)} className="mt-1 block w-32 rounded-md border border-white/20 bg-slate-900 px-2 py-1" /></label>
      <label className="text-sm">Monthly call limit<input aria-label="Monthly call limit" type="number" min="0" step="1" value={calls} onChange={(event) => setCalls(event.target.value)} className="mt-1 block w-32 rounded-md border border-white/20 bg-slate-900 px-2 py-1" /></label>
      <button type="submit" disabled={busy || !valid} className="rounded-md bg-orange-300 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-50">Save limits</button>
    </form>
  </section>;
}

const TRAIL_STAGES: { stage: TrailStage; label: string }[] = [
  { stage: "OBSERVED", label: "Observed" }, { stage: "EVIDENCE", label: "Evidence gathered" },
  { stage: "CONSIDERED", label: "Action considered" }, { stage: "POLICY", label: "Policy check" },
  { stage: "TAKEN", label: "Action taken" }, { stage: "RESULT", label: "Result" }, { stage: "FOLLOW_UP", label: "Follow-up" },
];
const STEP_MARK = { PASS: { mark: "✓", className: "text-emerald-300" }, FAIL: { mark: "✗", className: "text-red-300" }, INFO: { mark: "•", className: "text-slate-400" } };
const SOURCE_LABEL: Record<string, string> = {
  commons_post: "Commons post", commons_comment: "Commons comment", circle_window: "Circle conversation", circle_ride_match: "Circle ride-match scan",
  proposal: "Proposal", proposal_comment: "Proposal comment", sage_mention: "@mention of Sage", sage_dm: "Direct message to Sage",
};
const AGENT_LABELS: Record<string, string> = {
  "commons-action-agent": "Commons feed", "sage-trend": "Circle trends", "sage-ride-match": "Ride matches",
  "proposal-engine": "Proposal review", "comment-evaluation": "Comment evaluation", "sage-reply": "Sage replies",
};

function TrailCard({ trail, open, onToggle }: { trail: Trail; open: boolean; onToggle: () => void }) {
  return <div id={`trail-${trail.id}`} className="rounded-lg border border-white/10 bg-white/5">
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start justify-between gap-3 p-4 text-left">
      <span>
        <span className="font-semibold">{trail.outcome}</span>
        <span className="block text-xs font-semibold uppercase tracking-wide text-orange-200">{trail.agentLabel}</span>
        <span className="block text-xs text-slate-400">{SOURCE_LABEL[trail.sourceType] ?? trail.sourceType}{trail.observed.circleName ? ` · ${trail.observed.circleName}` : ""} · {trail.triggerLabel} · {new Date(trail.createdAt).toLocaleString()}</span>
      </span>
      <span className="text-slate-400">{open ? "▾" : "▸"}</span>
    </button>
    {open && <div className="space-y-4 border-t border-white/10 p-4 text-sm">
      {TRAIL_STAGES.map(({ stage, label }) => {
        const steps = trail.steps.filter((step) => step.stage === stage);
        if (!steps.length && stage !== "OBSERVED") return null;
        return <div key={stage} className="space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-wide text-orange-200">{label}</h3>
          {steps.map((step, index) => <div key={`${stage}-${index}`} className="flex gap-2">
            <span className={STEP_MARK[step.outcome ?? "INFO"].className}>{STEP_MARK[step.outcome ?? "INFO"].mark}</span>
            <span><span>{step.label}</span>{step.adminOnly && <span className="ml-2 rounded bg-white/10 px-1.5 text-xs text-slate-300">admin only</span>}
              {step.detail && <span className="block whitespace-pre-wrap text-xs text-slate-400">{step.detail}</span>}</span>
          </div>)}
          {stage === "OBSERVED" && <TrailObserved observed={trail.observed} />}
        </div>;
      })}
      <p className="text-xs text-slate-500">Source {trail.sourceType}:{trail.sourceId}{trail.proposalId ? ` · proposal ${trail.proposalId}` : ""}{trail.actionIds.length ? ` · actions ${trail.actionIds.join(", ")}` : ""}</p>
    </div>}
  </div>;
}

function TrailObserved({ observed }: { observed: Trail["observed"] }) {
  if (observed.items?.length) {
    return <ol className="space-y-2 border-l-2 border-orange-300/40 pl-3">{observed.items.map((item, index) => <li key={`${item.at}-${index}`}>
      <span className="text-xs text-slate-400">{item.author} · {new Date(item.at).toLocaleString()}</span>
      <span className="block whitespace-pre-wrap">{item.content}</span>
    </li>)}</ol>;
  }
  if (!observed.content) return null;
  return <blockquote className="space-y-1 border-l-2 border-orange-300/40 pl-3">
    {observed.title && <p className="font-semibold">{observed.title}</p>}
    <p className="whitespace-pre-wrap">{observed.content}</p>
    {observed.context && <p className="text-xs text-slate-400">On the post: {observed.context}</p>}
  </blockquote>;
}

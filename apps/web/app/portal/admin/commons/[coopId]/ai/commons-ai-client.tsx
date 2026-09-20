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
type FeedbackEdit = { rating: "GOOD" | "NEEDS_WORK" | ""; reasons: string[]; notes: string; correctedText: string };
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
interface Dashboard {
  setting: { autoReply: boolean; backfillPostsDone: boolean; backfillCommentsDone: boolean };
  actions: ActionRow[];
  resources: ResourceRow[];
  costs: {
    byFeature: Array<{ feature: string; model: string; calls: number; estimatedUsd: number; unknown: number }>;
    byDay: Array<{ day: string; estimatedUsd: number; unknown: number }>;
    byMonth: Array<{ month: string; estimatedUsd: number; unknown: number; calls: number }>;
  };
}

export default function CommonsAIClient({ apiUrl, token }: { apiUrl: string; token: string }) {
  const { coopId } = useParams<{ coopId: string }>();
  const [data, setData] = useState<Dashboard | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedbackEdits, setFeedbackEdits] = useState<Record<string, FeedbackEdit>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = `${apiUrl}/commonsActionsAdmin`;
  const refresh = useCallback(async () => {
    const input = encodeURIComponent(JSON.stringify({ coopId }));
    const response = await fetch(`${endpoint}.dashboard?input=${input}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not load AI actions. Reload this page if your admin session expired.");
    if (!body.result?.data) throw new Error("The API did not return Commons AI actions.");
    setData(body.result?.data);
  }, [endpoint, coopId, token]);
  useEffect(() => { void refresh().catch((cause) => setError(String(cause))); }, [refresh]);

  async function command(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${endpoint}.command`, { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}`,
      }, body: JSON.stringify({ coopId, ...body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Action failed. Reload this page if your admin session expired.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
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
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Estimated AI costs · past 31 days</h2>
        <p className="text-2xl font-bold">${data.costs.byFeature.reduce((sum, row) => sum + row.estimatedUsd, 0).toFixed(4)}</p>
        <p className="text-xs text-slate-400">Usage missing from {data.costs.byFeature.reduce((sum, row) => sum + row.unknown, 0)} calls; estimates exclude those calls.</p>
        <div className="overflow-x-auto rounded-lg border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-slate-400"><tr><th className="p-3">Feature</th><th className="p-3">Model</th><th className="p-3">Calls</th><th className="p-3">Estimated cost</th><th className="p-3">Unknown</th></tr></thead><tbody>{data.costs.byFeature.map((row) => <tr key={`${row.feature}:${row.model}`} className="border-t border-white/10"><td className="p-3">{row.feature}</td><td className="p-3">{row.model}</td><td className="p-3">{row.calls}</td><td className="p-3">${row.estimatedUsd.toFixed(4)}</td><td className="p-3">{row.unknown}</td></tr>)}</tbody></table></div>
        <details><summary className="cursor-pointer text-sm text-orange-200">Daily totals</summary><ul className="mt-2 space-y-1 text-sm text-slate-300">{data.costs.byDay.map((day) => <li key={day.day}>{day.day}: ${day.estimatedUsd.toFixed(4)} · {day.unknown} unknown</li>)}</ul></details>
        <details><summary className="cursor-pointer text-sm text-orange-200">Monthly totals</summary><ul className="mt-2 space-y-1 text-sm text-slate-300">{data.costs.byMonth.map((month) => <li key={month.month}>{month.month}: ${month.estimatedUsd.toFixed(4)} · {month.calls} calls · {month.unknown} unknown</li>)}</ul></details>
        <p className="text-xs text-slate-500">Estimates include recorded token charges. Provider tool fees and calls without usage are excluded.</p>
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

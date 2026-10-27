'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Github, Loader2, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Cadence = 'WEEKLY' | 'MONTHLY';

interface Draft {
  id: string;
  periodKey: string;
  cadence: Cadence;
  status: 'DRAFT' | 'POSTING' | 'POSTED' | 'DISMISSED';
  title: string;
  body: string;
  privacyFlags: string[];
  githubIssueUrl: string | null;
  githubIssueNumber: number | null;
  createdAt: string;
}

type RunResult =
  | { status: 'CREATED'; title: string; privacyFlags: string[] }
  | { status: 'EXISTS' }
  | { status: 'SKIPPED'; reason: string };

// The shared outline button is light; on the dark admin pages it needs the admin layout's dark outline.
const DARK_OUTLINE = 'border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white';
// Matches the selected item in the playground's sidebar.
const SELECTED = 'border-blue-500/50 bg-blue-500/10 text-white hover:bg-blue-500/20 hover:text-white';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * Sage's GitHub issue ideas, shown in the admin Agent Playground. Sage drafts one per week (or month)
 * from member feedback, Community Pulse and proposals; nothing reaches GitHub until an admin posts it.
 * Uses /api/admin/sage-dev-issues.
 */
export function SageDevIssuesPanel() {
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sage-dev-issues');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load Sage's issue ideas.");
      setCadence(data.cadence);
      setDrafts(data.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load Sage's issue ideas.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function call(key: string, url: string, body?: unknown) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'That didn’t work. Try again in a bit.');
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work. Try again in a bit.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function changeCadence(next: Cadence) {
    const data = await call('cadence', '/api/admin/sage-dev-issues/cadence', { cadence: next });
    if (data) {
      setCadence(data.cadence);
      setNotice(`Sage will now draft one issue ${next === 'WEEKLY' ? 'a week' : 'a month'}.`);
    }
  }

  async function draftNow() {
    const data = (await call('run', '/api/admin/sage-dev-issues/run')) as RunResult | null;
    if (!data) return;
    if (data.status === 'CREATED') setNotice(`New draft: “${data.title}”`);
    else if (data.status === 'EXISTS') setNotice('There’s already a draft for this period. It’s below.');
    else setNotice(`No draft this time. ${data.reason}`);
    await load();
  }

  async function post(draft: Draft) {
    if (!window.confirm(`Post “${draft.title}” to the public GitHub repo?`)) return;
    const data = await call(draft.id, `/api/admin/sage-dev-issues/${draft.id}/post`);
    if (data) {
      setNotice(`Posted as issue #${data.draft.githubIssueNumber}.`);
      await load();
    }
  }

  async function dismiss(draft: Draft) {
    const data = await call(draft.id, `/api/admin/sage-dev-issues/${draft.id}/dismiss`);
    if (data) await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Sage issue ideas</h2>
        <p className="text-sm text-slate-400">
          Sage reads in-app feedback, Community Pulse and proposals, then drafts one GitHub issue about the biggest
          problem members are hitting. It leaves out names, quotes and Commons. Members never see this, and nothing
          goes to GitHub until you post it.
        </p>
      </div>

      <section className="flex flex-wrap items-center gap-3 rounded-[8px] border border-white/10 p-4">
        <span className="text-sm text-slate-300">Draft one issue</span>
        <div className="flex gap-1" role="group" aria-label="How often Sage drafts an issue">
          {(['WEEKLY', 'MONTHLY'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant="outline"
              className={cadence === option ? SELECTED : DARK_OUTLINE}
              disabled={busy !== null || cadence === null}
              aria-pressed={cadence === option}
              onClick={() => cadence !== option && changeCadence(option)}
            >
              {option === 'WEEKLY' ? 'Every week' : 'Every month'}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" className={`ml-auto gap-2 ${DARK_OUTLINE}`} disabled={busy !== null} onClick={draftNow}>
          {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Draft now
        </Button>
      </section>

      {notice && (
        <div className="flex items-start gap-2 rounded-[8px] border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!drafts && !error && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {drafts?.length === 0 && <p className="text-slate-400">No drafts yet. Sage checks once a day.</p>}

      {drafts?.map((draft) => (
        <article key={draft.id} className="space-y-3 rounded-[8px] border border-white/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">{draft.title}</h3>
              <p className="text-xs text-slate-500">
                {draft.periodKey} · drafted {formatWhen(draft.createdAt)} · {draft.status.toLowerCase()}
              </p>
            </div>
            {draft.status === 'DRAFT' && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className={`gap-2 ${DARK_OUTLINE}`} disabled={busy !== null} onClick={() => dismiss(draft)}>
                  <X className="h-4 w-4" />
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={busy !== null || draft.privacyFlags.length > 0}
                  onClick={() => post(draft)}
                >
                  {busy === draft.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                  Post to GitHub
                </Button>
              </div>
            )}
            {draft.githubIssueUrl && (
              <a
                href={draft.githubIssueUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200"
              >
                Issue #{draft.githubIssueNumber}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {draft.privacyFlags.length > 0 && (
            <p className="rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-200">
              This one can&apos;t be posted as written: {draft.privacyFlags.join('; ')}.
            </p>
          )}
          <pre className="whitespace-pre-wrap rounded-[8px] bg-white/5 p-3 font-sans text-sm text-slate-300">{draft.body}</pre>
        </article>
      ))}
    </div>
  );
}

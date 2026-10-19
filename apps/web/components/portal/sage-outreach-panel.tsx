'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Search, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface OutreachRow {
  userId: string;
  name: string | null;
  email: string;
  lastReachedAt: string;
  lastTrigger: 'scheduled' | 'manual';
  lastMessage: string;
  outreachCount: number;
  repliedAt: string | null;
}

interface Member {
  id: string;
  name: string | null;
  email: string;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Sage's weekly check-in, shown in the admin Agent Playground: send a check-in to a chosen member now
 * and see when each member last heard from Sage. Uses /api/admin/sage-outreach.
 */
export function SageOutreachPanel() {
  const [history, setHistory] = useState<OutreachRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<Member[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string; content: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sage-outreach');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load outreach history.');
      setHistory(data.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load outreach history.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sage-outreach/members?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to search members.');
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search members.');
    } finally {
      setSearching(false);
    }
  }

  async function sendTo(member: Member) {
    setSendingTo(member.id);
    setError(null);
    setSent(null);
    try {
      const res = await fetch('/api/admin/sage-outreach/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send check-in.');
      setSent({ to: member.name || member.email, content: data.content });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send check-in.');
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Sage Weekly Check-in</h2>
        <p className="text-sm text-slate-400">
          Sage privately checks in with each member once a week, on their own weekday. Replies get up to five short follow-ups.
        </p>
      </div>

      <section className="space-y-3 rounded-[8px] border border-white/10 p-4">
        <h3 className="font-semibold text-white">Send a check-in now</h3>
        <p className="text-sm text-slate-400">
          Sage messages the member right away. It doesn&apos;t replace their scheduled weekly check-in, and the send is recorded in the audit log.
        </p>
        <form onSubmit={search} className="flex gap-2">
          <Input
            aria-label="Find a member"
            placeholder="Name or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" disabled={searching || query.trim().length < 2} className="gap-2">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </Button>
        </form>
        {members?.length === 0 && <p className="text-sm text-slate-400">No active members match.</p>}
        {members && members.length > 0 && (
          <ul className="divide-y divide-white/10 rounded-[8px] border border-white/10">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-4 px-4 py-2">
                <div>
                  <div className="text-white">{member.name || member.email}</div>
                  {member.name && <div className="text-xs text-slate-500">{member.email}</div>}
                </div>
                <Button
                  size="sm"
                  onClick={() => sendTo(member)}
                  disabled={sendingTo !== null}
                  aria-label={`Send check-in to ${member.email}`}
                  className="gap-2"
                >
                  {sendingTo === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send check-in
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sent && (
        <div className="flex items-start gap-2 rounded-[8px] border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>Sent to {sent.to}: “{sent.content}”</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!history && !error && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {history?.length === 0 && <p className="text-slate-400">Sage hasn’t reached out to anyone yet.</p>}

      {history && history.length > 0 && (
        <div className="overflow-x-auto rounded-[8px] border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Last reached</th>
                <th className="px-4 py-3 font-medium">Trigger</th>
                <th className="px-4 py-3 font-medium">Check-ins</th>
                <th className="px-4 py-3 font-medium">Replied</th>
                <th className="px-4 py-3 font-medium">Last message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {history.map((row) => (
                <tr key={row.userId}>
                  <td className="px-4 py-3">
                    <div className="text-white">{row.name || row.email}</div>
                    {row.name && <div className="text-xs text-slate-500">{row.email}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">{formatWhen(row.lastReachedAt)}</td>
                  <td className="px-4 py-3 text-slate-400">{row.lastTrigger}</td>
                  <td className="px-4 py-3 text-slate-300">{row.outreachCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                    {row.repliedAt ? formatWhen(row.repliedAt) : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="max-w-md px-4 py-3 text-slate-400">
                    <span className="line-clamp-2">{row.lastMessage}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

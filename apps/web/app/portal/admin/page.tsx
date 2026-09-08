'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CommonsSummary {
  coopId: string;
  name: string | null;
  slug: string | null;
  tagline: string | null;
  chainId: number | null;
  chainName: string | null;
  isDemo: boolean;
  isPrivate: boolean;
  createdAt: string;
  memberCount: number;
  applicationCount: number;
  postCount: number;
}

export default function AdminCommonsListPage() {
  const [commons, setCommons] = useState<CommonsSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/commons')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load commons.');
        setCommons(data.commons);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load commons.'));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">All Commons</h1>
          <p className="text-sm text-slate-400">Every cooperative running on this platform.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/portal/admin/agents">
            <Button variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
              Agent Playground
            </Button>
          </Link>
          <Link href="/initialize">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Create New Commons
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!commons && !error && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {commons?.length === 0 && (
        <p className="text-slate-400">No commons yet. Create the first one.</p>
      )}

      {commons && commons.length > 0 && (
        <div className="overflow-hidden rounded-[8px] border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Coop ID</th>
                <th className="px-4 py-3 font-medium">Chain</th>
                <th className="px-4 py-3 font-medium">Members</th>
                <th className="px-4 py-3 font-medium">Applications</th>
                <th className="px-4 py-3 font-medium">Posts</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {commons.map((c) => (
                <tr key={c.coopId}>
                  <td className="px-4 py-3 text-white">
                    {c.name || c.coopId}
                    {c.isDemo && (
                      <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                        demo
                      </span>
                    )}
                    {c.isPrivate && (
                      <span className="ml-2 rounded-full bg-slate-500/20 px-2 py-0.5 text-xs text-slate-300">
                        private
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">{c.coopId}</td>
                  <td className="px-4 py-3 text-slate-400">{c.chainName || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{c.memberCount}</td>
                  <td className="px-4 py-3 text-slate-300">{c.applicationCount}</td>
                  <td className="px-4 py-3 text-slate-300">{c.postCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/portal/admin/commons/${c.coopId}`}
                      className="text-sm font-medium text-blue-400 hover:text-blue-300"
                    >
                      View →
                    </Link>
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

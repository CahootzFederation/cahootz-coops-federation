'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface WelcomeTableConfig {
  id: string;
  coopId: string;
  enabled: boolean;
  capacity: number;
  guideUserId: string | null;
  lastTableNumber: number;
  activeTableId: string | null;
}

interface ActiveTableSnapshot {
  id: string;
  name: string;
  status: string | null;
  tableNumber: number | null;
  newcomerCount: number;
}

interface WelcomeTableHistoryRow {
  id: string;
  tableNumber: number | null;
  status: string | null;
  newcomerCount: number;
  capacity: number | null;
  guide: { userId: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface MemberOption {
  userId: string;
  name: string | null;
  email: string;
  status: string;
}

function GuidePicker({
  coopId,
  value,
  onChange,
}: {
  coopId: string;
  value: string | null;
  onChange: (userId: string, label: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/admin/commons/${coopId}/members?search=${encodeURIComponent(search)}&pageSize=10`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to load members.');
          setOptions((data.items || []).filter((m: MemberOption) => m.status === 'ACTIVE'));
        })
        .catch((err) => {
          if (err instanceof Error && err.name !== 'AbortError') console.error(err);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [coopId, search, open]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={value ? `Guide: ${value}` : 'Search active members to pick a guide...'}
          className="bg-white pl-8 text-slate-900 placeholder:text-slate-400"
        />
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-[8px] border border-white/10 bg-slate-900 shadow-lg">
          {loading && (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          )}
          {!loading && options.length === 0 && (
            <p className="px-3 py-3 text-sm text-slate-500">No active members found.</p>
          )}
          {!loading &&
            options.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => {
                  onChange(m.userId, m.name || m.email);
                  setOpen(false);
                  setSearch('');
                }}
                className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
              >
                {m.name || m.email} <span className="text-slate-500">({m.email})</span>
              </button>
            ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full border-t border-white/10 px-3 py-2 text-left text-xs text-slate-500 hover:bg-white/10"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export default function WelcomeTablesAdminPage() {
  const params = useParams();
  const coopId = params.coopId as string;

  const [config, setConfig] = useState<WelcomeTableConfig | null>(null);
  const [activeTable, setActiveTable] = useState<ActiveTableSnapshot | null>(null);
  const [history, setHistory] = useState<WelcomeTableHistoryRow[]>([]);
  const [guideLabel, setGuideLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingNext, setIsStartingNext] = useState(false);

  const load = () => {
    setIsLoading(true);
    fetch(`/api/admin/commons/${coopId}/welcome-tables`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load welcome tables.');
        setConfig(
          data.config || { id: '', coopId, enabled: true, capacity: 30, guideUserId: null, lastTableNumber: 0, activeTableId: null },
        );
        setActiveTable(data.activeTable);
        setHistory(data.history || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load welcome tables.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (coopId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coopId]);

  async function saveConfig() {
    if (!config) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/commons/${coopId}/welcome-tables`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: config.enabled,
          capacity: config.capacity,
          guideUserId: config.guideUserId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save config.');
      setConfig(data.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config.');
    } finally {
      setIsSaving(false);
    }
  }

  async function startNext() {
    if (!confirm('Close the current welcome table (even if under capacity) and start the next one?')) return;
    setIsStartingNext(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/commons/${coopId}/welcome-tables/start-next`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start next welcome table.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start next welcome table.');
    } finally {
      setIsStartingNext(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/portal/admin/commons/${coopId}`}
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {coopId}
      </Link>

      <h1 className="text-2xl font-bold text-white">Welcome Tables</h1>

      {error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && !config && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {config && (
        <>
          <section className="space-y-4 rounded-[8px] border border-white/10 bg-white/5 p-4">
            <h2 className="text-lg font-semibold text-white">Configuration</h2>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="enabled"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="enabled" className="text-sm text-slate-300">
                Enabled
              </label>
            </div>

            <div className="flex items-center gap-3">
              <label className="w-24 text-sm text-slate-400">Capacity</label>
              <Input
                type="number"
                min={1}
                max={500}
                value={config.capacity}
                onChange={(e) => setConfig({ ...config, capacity: Number(e.target.value) || 1 })}
                className="w-32 bg-white text-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-slate-400">Guide</label>
              <GuidePicker
                coopId={coopId}
                value={config.guideUserId}
                onChange={(userId, label) => {
                  setConfig({ ...config, guideUserId: userId });
                  setGuideLabel(label);
                }}
              />
              {config.guideUserId && (
                <p className="mt-1 text-xs text-slate-500">
                  Current guide: {guideLabel || config.guideUserId}
                </p>
              )}
            </div>

            <Button
              onClick={saveConfig}
              disabled={isSaving}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
            </Button>
          </section>

          <section className="space-y-3 rounded-[8px] border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-white">Current table</h2>
              <Button
                variant="outline"
                size="sm"
                className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                onClick={startNext}
                disabled={isStartingNext}
              >
                {isStartingNext ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start next welcome table'}
              </Button>
            </div>
            {activeTable ? (
              <p className="text-sm text-slate-300">
                {activeTable.name} — {activeTable.status} — {activeTable.newcomerCount}/{config.capacity} newcomers
              </p>
            ) : (
              <p className="text-sm text-slate-500">No active welcome table yet.</p>
            )}
            <p className="text-xs text-slate-500">Last table number: {config.lastTableNumber}</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">History</h2>
            <div className="overflow-hidden rounded-[8px] border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Table</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Occupancy</th>
                    <th className="px-4 py-2 font-medium">Guide</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2 text-white">Welcome Table {row.tableNumber}</td>
                      <td className="px-4 py-2 text-slate-300">{row.status}</td>
                      <td className="px-4 py-2 text-slate-400">
                        {row.newcomerCount}/{row.capacity ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-400">{row.guide?.name || '—'}</td>
                      <td className="px-4 py-2 text-slate-400">{new Date(row.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-slate-400">{new Date(row.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        No welcome tables created yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

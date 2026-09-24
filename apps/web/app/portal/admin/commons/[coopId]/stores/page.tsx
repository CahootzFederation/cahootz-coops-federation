'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, BadgeCheck, ChevronRight, Loader2, Store } from 'lucide-react';

interface StoreSummary {
  id: string;
  name: string;
  description: string | null;
  kind: 'MEMBER' | 'OFFICIAL_COMMONS';
  status: string;
  category: string | null;
  city: string | null;
  state: string | null;
  productCount: number;
  totalOrders: number;
  totalSales: number;
  paymentReady: boolean;
  publicReady: boolean;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function CommonsStoresPage() {
  const { coopId } = useParams<{ coopId: string }>();
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coopId) return;
    fetch(`/api/admin/commons/${coopId}/stores`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load stores.');
        setStores(data.stores);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load stores.'))
      .finally(() => setLoading(false));
  }, [coopId]);

  return (
    <div className="space-y-6">
      <Link href={`/portal/admin/commons/${coopId}`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Commons details
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-white">All stores</h1>
        <p className="mt-1 text-sm text-slate-400">Official and member-owned shops in {coopId}.</p>
      </div>

      {loading && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {error && <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      {!loading && !error && stores.length === 0 && (
        <div className="rounded-[8px] border border-dashed border-white/15 p-10 text-center text-slate-400">No stores have been created for this commons.</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {stores.map((store) => (
          <Link
            key={store.id}
            href={`/portal/admin/commons/${coopId}/stores/${store.id}`}
            className="group rounded-[10px] border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-300/10 text-orange-200">
                <Store className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-white">{store.name}</h2>
                  {store.kind === 'OFFICIAL_COMMONS' && <BadgeCheck className="h-4 w-4 text-emerald-300" aria-label="Official commons store" />}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${store.publicReady ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                    {store.publicReady ? 'Public' : store.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-400">{store.description || 'No description'}</p>
                <p className="mt-2 text-xs text-slate-500">{store.kind === 'OFFICIAL_COMMONS' ? 'Official store' : 'Member store'}{store.city ? ` · ${store.city}${store.state ? `, ${store.state}` : ''}` : ''}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500 transition group-hover:text-white" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-sm">
              <div><p className="text-xs text-slate-500">Products</p><p className="mt-1 font-semibold text-white">{store.productCount}</p></div>
              <div><p className="text-xs text-slate-500">Orders</p><p className="mt-1 font-semibold text-white">{store.totalOrders}</p></div>
              <div><p className="text-xs text-slate-500">Sales</p><p className="mt-1 font-semibold text-white">{money.format(store.totalSales)}</p></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

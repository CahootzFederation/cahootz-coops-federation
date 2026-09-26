'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, BadgeCheck, CheckCircle2, Loader2, Package, Store as StoreIcon } from 'lucide-react';

interface StoreProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  kind: 'STANDARD' | 'FUNDING_BADGE';
  tier: string | null;
  priceUSD: number;
  nominalReward: number;
  quantity: number;
  trackInventory: boolean;
  isActive: boolean;
  totalSold: number;
  activeOwners: number;
}

interface StoreDetail {
  id: string;
  coopId: string;
  name: string;
  description: string | null;
  kind: 'MEMBER' | 'OFFICIAL_COMMONS';
  category: string | null;
  city: string | null;
  state: string | null;
  status: string;
  publicReady: boolean;
  totalSales: number;
  totalOrders: number;
  settlement: {
    source: 'STORE_OVERRIDE' | 'SHARED_DEFAULT' | 'STORE_ACCOUNT';
    stripeAccountId: string;
    businessName: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null;
  products: StoreProduct[];
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function StoreDetailPage() {
  const { coopId, storeId } = useParams<{ coopId: string; storeId: string }>();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coopId || !storeId) return;
    fetch(`/api/admin/commons/${coopId}/stores/${storeId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load store.');
        setStore(data.store);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load store.'))
      .finally(() => setLoading(false));
  }, [coopId, storeId]);

  return (
    <div className="space-y-6">
      <Link href={`/portal/admin/commons/${coopId}/stores`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All stores
      </Link>
      {loading && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {error && <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      {store && (
        <>
          <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-orange-300/10 p-3 text-orange-200"><StoreIcon className="h-6 w-6" /></div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-white">{store.name}</h1>
                  {store.kind === 'OFFICIAL_COMMONS' && <BadgeCheck className="h-5 w-5 text-emerald-300" aria-label="Official commons store" />}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${store.publicReady ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                    {store.publicReady ? 'Public and ready' : store.status}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">{store.description || 'No store description.'}</p>
                <p className="mt-2 text-xs text-slate-500">{store.kind === 'OFFICIAL_COMMONS' ? 'Official commons store' : 'Member-owned store'}{store.city ? ` · ${store.city}${store.state ? `, ${store.state}` : ''}` : ''}</p>
              </div>
            </div>
            {store.kind === 'OFFICIAL_COMMONS' && (
              <Link href="/portal/admin/marketplace" className="text-sm font-medium text-orange-200 hover:text-orange-100">Manage settlement →</Link>
            )}
          </header>

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase text-slate-400">Products</p><p className="mt-2 text-2xl font-bold text-white">{store.products.length}</p></div>
            <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase text-slate-400">Orders</p><p className="mt-2 text-2xl font-bold text-white">{store.totalOrders}</p></div>
            <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase text-slate-400">Gross sales</p><p className="mt-2 text-2xl font-bold text-white">{money.format(store.totalSales)}</p></div>
          </section>

          <section className="rounded-[8px] border border-white/10 bg-white/[0.03] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-semibold text-white">Stripe settlement</h2><p className="mt-1 text-sm text-slate-400">{store.settlement?.source === 'SHARED_DEFAULT' ? 'Shared platform default' : store.settlement?.source === 'STORE_OVERRIDE' ? 'Individual official-store override' : 'Store owner account'}</p></div>
              {store.settlement?.chargesEnabled && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Charges enabled</span>}
            </div>
            {store.settlement ? (
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div><span className="text-slate-500">Account</span><p className="mt-1 break-all font-mono text-slate-200">{store.settlement.stripeAccountId}</p></div>
                <div><span className="text-slate-500">Business</span><p className="mt-1 text-slate-200">{store.settlement.businessName}</p></div>
                <div><span className="text-slate-500">Payouts</span><p className="mt-1 text-slate-200">{store.settlement.payoutsEnabled ? 'Enabled' : 'Not enabled'}</p></div>
              </div>
            ) : <p className="mt-4 text-sm text-amber-300">No Stripe account is configured.</p>}
          </section>

          <section className="space-y-3">
            <div><h2 className="text-lg font-semibold text-white">Store items</h2><p className="text-sm text-slate-400">Every product in this store, including inactive items.</p></div>
            <div className="overflow-hidden rounded-[8px] border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-slate-400"><tr><th className="px-4 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Price</th><th className="px-4 py-3 font-medium">Inventory</th><th className="px-4 py-3 font-medium">Sold</th><th className="px-4 py-3 font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-white/10">
                  {store.products.map((product) => (
                    <tr key={product.id}>
                      <td className="px-4 py-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-400"><Package className="h-4 w-4" /></div><div><p className="font-medium text-white">{product.name}</p><p className="text-xs text-slate-500">{product.kind === 'FUNDING_BADGE' ? `${product.tier?.replaceAll('_', ' ')} · up to ${product.nominalReward.toLocaleString()} SC` : product.category || 'Standard product'}</p></div></div></td>
                      <td className="px-4 py-3 font-medium text-white">{money.format(product.priceUSD)}</td>
                      <td className="px-4 py-3 text-slate-300">{product.trackInventory ? product.quantity : 'Unlimited'}</td>
                      <td className="px-4 py-3 text-slate-300">{product.kind === 'FUNDING_BADGE' ? product.activeOwners : product.totalSold}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${product.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'}`}>{product.isActive ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                  {store.products.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">This store has no products.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

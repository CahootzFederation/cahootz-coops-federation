'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle2, CreditCard, Loader2, Store } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface SettlementAccountSummary {
  stripeAccountId: string;
  businessName: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

interface OfficialStoreSettlement {
  id: string;
  coopId: string;
  name: string;
  usesDefault: boolean;
  override: SettlementAccountSummary | null;
  effectiveAccount: SettlementAccountSummary | null;
}

interface SettlementData {
  selected: SettlementAccountSummary | null;
  officialStores: OfficialStoreSettlement[];
}

export default function MarketplaceSettingsPage() {
  const [settlement, setSettlement] = useState<SettlementAccountSummary | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState('');
  const [officialStores, setOfficialStores] = useState<OfficialStoreSettlement[]>([]);
  const [storeAccountIds, setStoreAccountIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingSettlement, setSavingSettlement] = useState(false);
  const [savingStoreId, setSavingStoreId] = useState<string | null>(null);
  const [settlementMessage, setSettlementMessage] = useState<string | null>(null);
  const [storeSettlementMessage, setStoreSettlementMessage] = useState<Record<string, string>>({});

  function applySettlementData(data: SettlementData) {
    setSettlement(data.selected);
    setStripeAccountId(data.selected?.stripeAccountId || '');
    setOfficialStores(data.officialStores || []);
    setStoreAccountIds(Object.fromEntries(
      (data.officialStores || []).map((store) => [store.id, store.override?.stripeAccountId || '']),
    ));
  }

  useEffect(() => {
    fetch('/api/admin/funding-settlement')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load marketplace settings.');
        applySettlementData(data);
      })
      .catch((error) => setSettlementMessage(
        error instanceof Error ? error.message : 'Failed to load marketplace settings.',
      ))
      .finally(() => setLoading(false));
  }, []);

  async function saveFundingSettlement() {
    setSavingSettlement(true);
    setSettlementMessage(null);
    try {
      const response = await fetch('/api/admin/funding-settlement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripeAccountId: stripeAccountId.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save settlement account.');
      applySettlementData(data);
      setSettlementMessage('Shared funding account updated. Future badge purchases will use this account.');
    } catch (error) {
      setSettlementMessage(error instanceof Error ? error.message : 'Unable to save settlement account.');
    } finally {
      setSavingSettlement(false);
    }
  }

  async function saveStoreSettlement(storeId: string, useDefault = false) {
    setSavingStoreId(storeId);
    setStoreSettlementMessage((current) => ({ ...current, [storeId]: '' }));
    try {
      const response = await fetch('/api/admin/funding-settlement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          stripeAccountId: useDefault ? null : storeAccountIds[storeId]?.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update this badge store.');
      applySettlementData(data);
      setStoreSettlementMessage((current) => ({
        ...current,
        [storeId]: useDefault ? 'Now using the shared default.' : 'Store override saved for future purchases.',
      }));
    } catch (error) {
      setStoreSettlementMessage((current) => ({
        ...current,
        [storeId]: error instanceof Error ? error.message : 'Unable to update this badge store.',
      }));
    } finally {
      setSavingStoreId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal/admin" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          All Commons
        </Link>
        <div className="mt-4 flex items-start gap-3">
          <div className="rounded-xl bg-orange-300/10 p-3 text-orange-200">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Marketplace Settings</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Manage where official badge-store payments settle. Member-owned stores continue using their own Stripe accounts.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <section className="rounded-[8px] border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-500/15 p-2 text-blue-300">
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-white">Shared settlement account</h2>
                  {settlement?.chargesEnabled && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Ready
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  This is the default for every official commons badge store. Changes apply only to future purchases.
                </p>
                <div className="mt-4 flex max-w-2xl flex-col gap-2 sm:flex-row">
                  <input
                    aria-label="Shared Stripe connected account ID"
                    value={stripeAccountId}
                    onChange={(event) => setStripeAccountId(event.target.value)}
                    placeholder="acct_..."
                    className="h-10 flex-1 rounded-md border border-white/15 bg-slate-950 px-3 font-mono text-sm text-white outline-none focus:border-blue-400"
                  />
                  <Button onClick={saveFundingSettlement} disabled={savingSettlement || !stripeAccountId.trim()}>
                    {savingSettlement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Verify and save
                  </Button>
                </div>
                {settlement && (
                  <p className="mt-2 break-all text-xs text-slate-400">
                    {settlement.stripeAccountId} · Charges {settlement.chargesEnabled ? 'enabled' : 'not enabled'} · Payouts {settlement.payoutsEnabled ? 'enabled' : 'not enabled'}
                  </p>
                )}
                {settlementMessage && (
                  <p className="mt-3 flex items-start gap-2 text-sm text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {settlementMessage}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[8px] border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-semibold text-white">Individual badge-store accounts</h2>
            <p className="mt-1 text-sm text-slate-400">
              Give one commons a separate settlement account, or return it to the shared default at any time.
            </p>
            {officialStores.length === 0 ? (
              <p className="mt-5 rounded-md border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
                No official badge stores have been provisioned yet.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-white/10 rounded-md border border-white/10">
                {officialStores.map((store) => (
                  <div key={store.id} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-white">{store.name}</p>
                        <p className="text-xs text-slate-400">{store.coopId} · {store.usesDefault ? 'Shared default' : 'Individual override'}</p>
                      </div>
                      {store.effectiveAccount?.chargesEnabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Not ready</span>
                      )}
                    </div>
                    <p className="break-all text-xs text-slate-400">
                      Effective account: {store.effectiveAccount?.stripeAccountId || 'none configured'}
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        aria-label={`${store.name} Stripe connected account ID`}
                        value={storeAccountIds[store.id] || ''}
                        onChange={(event) => setStoreAccountIds((current) => ({ ...current, [store.id]: event.target.value }))}
                        placeholder="acct_... for an individual override"
                        className="h-10 flex-1 rounded-md border border-white/15 bg-slate-950 px-3 font-mono text-sm text-white outline-none focus:border-blue-400"
                      />
                      <Button
                        variant="outline"
                        onClick={() => saveStoreSettlement(store.id)}
                        disabled={savingStoreId === store.id || !storeAccountIds[store.id]?.trim()}
                      >
                        {savingStoreId === store.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save override
                      </Button>
                      {!store.usesDefault && (
                        <Button
                          variant="ghost"
                          onClick={() => saveStoreSettlement(store.id, true)}
                          disabled={savingStoreId === store.id}
                          className="text-slate-300 hover:text-white"
                        >
                          Use shared default
                        </Button>
                      )}
                    </div>
                    {storeSettlementMessage[store.id] && (
                      <p className="text-sm text-amber-300">{storeSettlementMessage[store.id]}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

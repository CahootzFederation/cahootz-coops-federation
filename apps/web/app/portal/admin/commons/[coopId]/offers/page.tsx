'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, ChevronRight, Loader2, Plus, Tag, Users } from 'lucide-react';

import { OFFER_STATUS_LABELS as STATUS_LABELS } from '@/lib/offer-labels';

interface ProductOption {
  id: string;
  name: string;
  priceUSD: number;
  store: { id: string; name: string; coopId: string };
}

interface OfferRow {
  id: string;
  offerType: 'MEMBER_DEAL' | 'GROUP_BUY';
  status: string;
  title: string;
  store: { name: string };
  regularPriceCents: number;
  memberPriceCents: number;
  savingsCents: number;
  savingsPercent: number;
  committedQuantity: number;
  minimumCommitments: number | null;
  financials: { paidOrders: number; verifiedSavingsCents: number };
}

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const toCents = (value: string) => Math.round(Number.parseFloat(value || '0') * 100);
const percentToBps = (value: string) => Math.round(Number.parseFloat(value || '0') * 100);
// Preview only; these mirror offerSavings(), estimateStripeFeeCents() and splitOfferPayment()
// in @repo/validators. The server uses those for the real numbers, and Stripe's real fee once paid.
const estimateStripeFee = (cents: number) => (cents > 0 ? Math.round((cents * 290) / 10000) + 30 : 0);
const offerSavings = (regular: number, member: number) => {
  const savingsCents = Math.max(0, regular - member);
  return { savingsCents, savingsPercent: regular > 0 ? Math.floor((savingsCents * 100) / regular) : 0 };
};


const emptyForm = {
  offerType: 'MEMBER_DEAL' as 'MEMBER_DEAL' | 'GROUP_BUY',
  productId: '',
  title: '',
  description: '',
  regularPrice: '',
  regularPriceSource: '',
  memberPrice: '',
  vendorPayout: '',
  commonsSharePercent: '50',
  quantityPerMember: '1',
  maximumQuantity: '',
  minimumCommitments: '',
  minimumPaidOrders: '',
  commitmentDeadline: '',
  paymentWindowHours: '72',
  expiresAt: '',
  fulfillmentDate: '',
  fulfillmentMethod: 'PICKUP' as 'PICKUP' | 'DELIVERY',
  pickupLocation: '',
  serviceArea: '',
  redemptionRules: '',
  refundPolicy: '',
  substitutionPolicy: '',
  terms: '',
};

export default function CommonsOffersPage() {
  const { coopId } = useParams<{ coopId: string }>();
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!coopId) return;
    setLoading(true);
    fetch(`/api/admin/commons/${coopId}/offers`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "We couldn't load offers.");
        setOffers(data.offers);
        setProducts(data.products);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "We couldn't load offers."))
      .finally(() => setLoading(false));
  }, [coopId]);

  useEffect(load, [load]);

  const set = (key: keyof typeof emptyForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const preview = useMemo(() => {
    const regular = toCents(form.regularPrice);
    const member = toCents(form.memberPrice);
    if (!regular || !member) return null;
    const { savingsCents, savingsPercent } = offerSavings(regular, member);
    const vendor = toCents(form.vendorPayout);
    const stripeFee = estimateStripeFee(member);
    const left = member - stripeFee - vendor;
    const commons = left > 0 ? Math.floor((left * percentToBps(form.commonsSharePercent)) / 10000) : 0;
    return { savingsCents, savingsPercent, member, stripeFee, vendor, left, commons, cahootz: left - commons, hasVendor: vendor > 0 };
  }, [form.regularPrice, form.memberPrice, form.vendorPayout, form.commonsSharePercent]);

  function chooseProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    setForm((current) => ({
      ...current,
      productId,
      title: current.title || product?.name || '',
      regularPrice: current.regularPrice || (product ? product.priceUSD.toFixed(2) : ''),
    }));
  }

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const isGroupBuy = form.offerType === 'GROUP_BUY';
    const optionalInt = (value: string) => (value ? Number.parseInt(value, 10) : null);
    const body = {
      offerType: form.offerType,
      productId: form.productId,
      title: form.title,
      description: form.description,
      regularPriceCents: toCents(form.regularPrice),
      regularPriceSource: form.regularPriceSource,
      memberPriceCents: toCents(form.memberPrice),
      vendorPayoutCents: toCents(form.vendorPayout),
      commonsSplitBps: percentToBps(form.commonsSharePercent),
      quantityPerMember: optionalInt(form.quantityPerMember) ?? 1,
      maximumQuantity: optionalInt(form.maximumQuantity),
      minimumCommitments: isGroupBuy ? optionalInt(form.minimumCommitments) : null,
      minimumPaidOrders: isGroupBuy ? optionalInt(form.minimumPaidOrders) : null,
      commitmentDeadline: isGroupBuy && form.commitmentDeadline ? new Date(form.commitmentDeadline).toISOString() : null,
      paymentWindowHours: optionalInt(form.paymentWindowHours) ?? 72,
      expiresAt: !isGroupBuy && form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      fulfillmentDate: form.fulfillmentDate ? new Date(form.fulfillmentDate).toISOString() : null,
      fulfillmentMethod: form.fulfillmentMethod,
      pickupLocation: form.pickupLocation,
      serviceArea: form.serviceArea,
      redemptionRules: form.redemptionRules,
      refundPolicy: form.refundPolicy,
      substitutionPolicy: form.substitutionPolicy,
      terms: form.terms,
    };
    try {
      const response = await fetch(`/api/admin/commons/${coopId}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We couldn't save the draft.");
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "We couldn't save the draft.");
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none';
  const label = 'block text-xs font-medium text-slate-300';
  const isGroupBuy = form.offerType === 'GROUP_BUY';

  return (
    <div className="space-y-6">
      <Link href={`/portal/admin/commons/${coopId}`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Commons details
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Member deals and group buys</h1>
          <p className="mt-1 text-sm text-slate-400">
            Draft offers for {coopId}. A steward of this Commons approves each one before members see it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-300/20"
        >
          <Plus className="h-4 w-4" /> New offer
        </button>
      </div>

      {showForm && (
        <form onSubmit={createDraft} className="space-y-5 rounded-[10px] border border-white/10 bg-white/[0.03] p-5" aria-label="New offer">
          <div className="flex gap-2" role="radiogroup" aria-label="Offer type">
            {(['MEMBER_DEAL', 'GROUP_BUY'] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={form.offerType === type}
                onClick={() => setForm((current) => ({ ...current, offerType: type }))}
                className={`rounded-md border px-3 py-1.5 text-sm ${form.offerType === type ? 'border-emerald-300/60 bg-emerald-300/15 text-emerald-100' : 'border-white/10 text-slate-300'}`}
              >
                {type === 'MEMBER_DEAL' ? 'Member deal' : 'Group buy'}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>
              Product
              <select className={input} value={form.productId} onChange={(e) => chooseProduct(e.target.value)} required>
                <option value="">Pick a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.store.name}: {product.name} (${product.priceUSD.toFixed(2)}){product.store.coopId !== coopId ? ` · shop in ${product.store.coopId}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Title members see
              <input className={input} value={form.title} onChange={set('title')} required minLength={3} maxLength={120} />
            </label>
            <label className={`${label} md:col-span-2`}>
              Description
              <textarea className={input} rows={2} value={form.description} onChange={set('description')} />
            </label>
            <label className={label}>
              Regular price ($)
              <input className={input} inputMode="decimal" value={form.regularPrice} onChange={set('regularPrice')} required />
            </label>
            <label className={label}>
              Where the regular price comes from
              <input className={input} placeholder="Posted shelf price" value={form.regularPriceSource} onChange={set('regularPriceSource')} required minLength={3} />
            </label>
            <label className={label}>
              Member price ($)
              <input className={input} inputMode="decimal" value={form.memberPrice} onChange={set('memberPrice')} required />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Vendor gets ($ per unit)
                <input className={input} inputMode="decimal" value={form.vendorPayout} onChange={set('vendorPayout')} required />
              </label>
              <label className={label}>
                Commons share of what&apos;s left (%)
                <input className={input} inputMode="decimal" value={form.commonsSharePercent} onChange={set('commonsSharePercent')} />
              </label>
            </div>
          </div>

          {preview && (
            <div className="rounded-md border border-white/10 bg-black/20 p-4 text-sm text-slate-300" aria-label="Price preview">
              <p>
                Members pay <strong className="text-white">{money(preview.member)}</strong> and save{' '}
                <strong className="text-emerald-300">{money(preview.savingsCents)} ({preview.savingsPercent}%)</strong>.
              </p>
              {preview.hasVendor && (
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5" aria-label="Where each unit's money goes">
                  <div><dt className="text-xs text-slate-500">Member pays</dt><dd className="text-white">{money(preview.member)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Stripe fee (about)</dt><dd className="text-white">−{money(preview.stripeFee)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Vendor gets</dt><dd className="text-white">{money(preview.vendor)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Commons ({form.commonsSharePercent || 0}%)</dt><dd className="text-white">{money(preview.commons)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Cahootz</dt><dd className="text-white">{money(preview.cahootz)}</dd></div>
                </dl>
              )}
              {preview.hasVendor && preview.left <= 0 && (
                <p className="mt-2 text-amber-300">
                  After Stripe&apos;s fee there&apos;s nothing left for the Commons and Cahootz. Lower what the vendor gets or raise the member price.
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">Stripe&apos;s fee is estimated at 2.9% + 30¢. Each payment records Stripe&apos;s real fee.</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <label className={label}>
              Limit per household
              <input className={input} inputMode="numeric" value={form.quantityPerMember} onChange={set('quantityPerMember')} />
            </label>
            <label className={label}>
              Total available (optional)
              <input className={input} inputMode="numeric" value={form.maximumQuantity} onChange={set('maximumQuantity')} />
            </label>
            {isGroupBuy ? (
              <>
                <label className={label}>
                  Units needed to unlock
                  <input className={input} inputMode="numeric" value={form.minimumCommitments} onChange={set('minimumCommitments')} required />
                </label>
                <label className={label}>
                  Units that must be paid for
                  <input
                    className={input}
                    inputMode="numeric"
                    placeholder={form.minimumCommitments ? `About ${Math.ceil(Number(form.minimumCommitments) * 0.8)}` : ''}
                    value={form.minimumPaidOrders}
                    onChange={set('minimumPaidOrders')}
                    required
                  />
                </label>
                <label className={label}>
                  Last day to commit
                  <input className={input} type="datetime-local" value={form.commitmentDeadline} onChange={set('commitmentDeadline')} required />
                </label>
                <label className={label}>
                  Hours to pay once confirmed
                  <input className={input} inputMode="numeric" value={form.paymentWindowHours} onChange={set('paymentWindowHours')} />
                </label>
              </>
            ) : (
              <label className={label}>
                Deal ends
                <input className={input} type="datetime-local" value={form.expiresAt} onChange={set('expiresAt')} required />
              </label>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className={label}>
              Pickup or delivery
              <select className={input} value={form.fulfillmentMethod} onChange={set('fulfillmentMethod')}>
                <option value="PICKUP">Pickup</option>
                <option value="DELIVERY">Delivery</option>
              </select>
            </label>
            <label className={label}>
              {form.fulfillmentMethod === 'PICKUP' ? 'Pickup location' : 'Delivery area'}
              <input
                className={input}
                value={form.fulfillmentMethod === 'PICKUP' ? form.pickupLocation : form.serviceArea}
                onChange={set(form.fulfillmentMethod === 'PICKUP' ? 'pickupLocation' : 'serviceArea')}
              />
            </label>
            <label className={label}>
              Fulfillment date (optional)
              <input className={input} type="date" value={form.fulfillmentDate} onChange={set('fulfillmentDate')} />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>
              How to redeem
              <textarea className={input} rows={2} value={form.redemptionRules} onChange={set('redemptionRules')} />
            </label>
            <label className={label}>
              Refund and cancellation rules
              <textarea className={input} rows={2} value={form.refundPolicy} onChange={set('refundPolicy')} />
            </label>
            <label className={label}>
              Substitutions
              <textarea className={input} rows={2} value={form.substitutionPolicy} onChange={set('substitutionPolicy')} />
            </label>
            <label className={label}>
              Other terms
              <textarea className={input} rows={2} value={form.terms} onChange={set('terms')} />
            </label>
          </div>

          {formError && <p className="text-sm text-red-300">{formError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        </form>
      )}

      {loading && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {error && <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {!loading && !error && offers.length === 0 && (
        <div className="rounded-[8px] border border-dashed border-white/15 p-10 text-center text-slate-400">No offers yet. Start with New offer.</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {offers.map((offer) => (
          <Link
            key={offer.id}
            href={`/portal/admin/commons/${coopId}/offers/${offer.id}`}
            className="group rounded-[10px] border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200">
                {offer.offerType === 'GROUP_BUY' ? <Users className="h-6 w-6" /> : <Tag className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-white">{offer.title}</h2>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{STATUS_LABELS[offer.status] ?? offer.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  {offer.offerType === 'GROUP_BUY' ? 'Group buy' : 'Member deal'} · {offer.store.name}
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  <span className="text-slate-500 line-through">{money(offer.regularPriceCents)}</span>{' '}
                  <strong className="text-white">{money(offer.memberPriceCents)}</strong>{' '}
                  <span className="text-emerald-300">save {money(offer.savingsCents)} ({offer.savingsPercent}%)</span>
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500 transition group-hover:text-white" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-sm">
              <div>
                <p className="text-xs text-slate-500">{offer.offerType === 'GROUP_BUY' ? 'Committed' : 'Held'}</p>
                <p className="mt-1 font-semibold text-white">
                  {offer.committedQuantity}
                  {offer.minimumCommitments ? ` / ${offer.minimumCommitments}` : ''}
                </p>
              </div>
              <div><p className="text-xs text-slate-500">Paid orders</p><p className="mt-1 font-semibold text-white">{offer.financials.paidOrders}</p></div>
              <div><p className="text-xs text-slate-500">Member savings</p><p className="mt-1 font-semibold text-white">{money(offer.financials.verifiedSavingsCents)}</p></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

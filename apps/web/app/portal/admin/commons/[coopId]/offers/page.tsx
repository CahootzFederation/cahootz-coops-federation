'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, ChevronRight, Loader2, Plus, Users } from 'lucide-react';

import { suggestVendorPayoutCents } from '@repo/validators/marketplace-offers';

import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { CompactImageUpload } from '@/components/portal/compact-image-upload';
import { OFFER_STATUS_LABELS as STATUS_LABELS } from '@/lib/offer-labels';

interface OfferRow {
  id: string;
  coopId: string | null;
  repeats: boolean;
  status: string;
  title: string;
  vendorName: string;
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
// Preview only; these mirror offerSavings(), estimateStripeFeeCents(), worstCaseStripeFeeCents(),
// splitOfferPayment() and checkOfferMargin() in @repo/validators. The server uses those for the real
// numbers (and refuses a deal that fails the check), and Stripe's real fee once paid.
const estimateStripeFee = (cents: number) => (cents > 0 ? Math.round((cents * 290) / 10000) + 30 : 0);
const worstStripeFee = (cents: number) => (cents > 0 ? Math.round((cents * 440) / 10000) + 30 : 0);
const shares = (member: number, fee: number, vendor: number, commonsBps: number) => {
  const left = member - fee - vendor;
  const commons = left > 0 ? Math.floor((left * commonsBps) / 10000) : 0;
  return { left, commons, cahootz: left - commons };
};
const offerSavings = (regular: number, member: number) => {
  const savingsCents = Math.max(0, regular - member);
  return { savingsCents, savingsPercent: regular > 0 ? Math.floor((savingsCents * 100) / regular) : 0 };
};


const emptyForm = {
  vendorName: '',
  vendorEmail: '',
  vendorPhone: '',
  imageUrl: '',
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
  paymentWindowHours: '48',
  fulfillmentDate: '',
  fulfillmentMethod: 'DELIVERY' as 'PICKUP' | 'DELIVERY' | 'SERVICE',
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Set when the form starts from a product idea (Vendor outreach → "Start the group buy").
  const [fromItem, setFromItem] = useState<{
    sourcedProductId: string;
    vendorProspectId: string | null;
    vendorContactName: string | null;
    title: string;
    memberShare: string | null;
    feesEatSavings: boolean;
  } | null>(null);
  // The least the Commons and Cahootz must each get per unit at the worst-case card fee (platform admin setting).
  const [minShareCents, setMinShareCents] = useState(10);
  // The Commons and Cahootz share of the discount used to suggest what the vendor gets (platform admin setting).
  const [itemMarginBps, setItemMarginBps] = useState(2000);
  // Set when the vendor amount was filled in for the admin, so the form can say so.
  const [vendorSuggested, setVendorSuggested] = useState(false);

  const load = useCallback(() => {
    if (!coopId) return;
    setLoading(true);
    fetch(`/api/admin/commons/${coopId}/offers`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "We couldn't load offers.");
        setOffers(data.offers);
        if (typeof data.minShareCents === 'number') setMinShareCents(data.minShareCents);
        if (typeof data.itemMarginBps === 'number') setItemMarginBps(data.itemMarginBps);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "We couldn't load offers."))
      .finally(() => setLoading(false));
  }, [coopId]);

  useEffect(load, [load]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const itemId = search.get('item');
    if (!itemId) return;
    const vendorId = search.get('vendor');
    const dollars = (cents: number | null) => (cents ? (cents / 100).toFixed(2) : '');
    fetch(`/api/admin/outreach/items/${encodeURIComponent(itemId)}${vendorId ? `?vendor=${encodeURIComponent(vendorId)}` : ''}`)
      .then(async (response) => {
        const item = await response.json();
        if (!response.ok) throw new Error(item.error || "We couldn't load that product idea.");
        setForm({
          ...emptyForm,
          vendorName: item.vendorName ?? '',
          vendorEmail: item.vendorEmail ?? '',
          vendorPhone: item.vendorPhone ?? '',
          imageUrl: item.imageUrl ?? '',
          title: item.title,
          description: item.description,
          regularPrice: dollars(item.regularPriceCents),
          regularPriceSource: item.regularPriceSource ?? '',
          memberPrice: dollars(item.memberPriceCents),
          vendorPayout: dollars(item.vendorPayoutCents),
          commonsSharePercent: item.commonsSplitBps ? String(item.commonsSplitBps / 100) : emptyForm.commonsSharePercent,
          minimumCommitments: item.minimumCommitments ? String(item.minimumCommitments) : '',
        });
        setFromItem({
          sourcedProductId: item.sourcedProductId,
          vendorProspectId: item.vendorProspectId ?? null,
          vendorContactName: item.vendorContactName ?? null,
          title: item.title,
          memberShare: item.memberShare,
          feesEatSavings: !!item.feesEatSavings,
        });
        setShowForm(true);
      })
      .catch((reason) => setFormError(reason instanceof Error ? reason.message : "We couldn't load that product idea."));
  }, []);

  /** Once a member price is in, fill an empty vendor amount by the same price rule as every offer. */
  function suggestVendor() {
    if (form.vendorPayout.trim()) return;
    const cents = suggestVendorPayoutCents({
      regularPriceCents: toCents(form.regularPrice),
      memberPriceCents: toCents(form.memberPrice),
      pricing: { itemMarginBps, minShareCents },
      commonsSplitBps: percentToBps(form.commonsSharePercent),
    });
    if (cents == null) return;
    setForm((current) => ({ ...current, vendorPayout: (cents / 100).toFixed(2) }));
    setVendorSuggested(true);
  }

  const set = (key: keyof typeof emptyForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const preview = useMemo(() => {
    const regular = toCents(form.regularPrice);
    const member = toCents(form.memberPrice);
    if (!regular || !member) return null;
    const { savingsCents, savingsPercent } = offerSavings(regular, member);
    const vendor = toCents(form.vendorPayout);
    const commonsBps = percentToBps(form.commonsSharePercent);
    const stripeFee = estimateStripeFee(member);
    const typical = shares(member, stripeFee, vendor, commonsBps);
    const worstFee = worstStripeFee(member);
    const worst = shares(member, worstFee, vendor, commonsBps);
    const losesMoney = vendor > 0 && (worst.commons < minShareCents || worst.cahootz < minShareCents);
    return { savingsCents, savingsPercent, member, stripeFee, vendor, ...typical, worstFee, worst, losesMoney, hasVendor: vendor > 0 };
  }, [form.regularPrice, form.memberPrice, form.vendorPayout, form.commonsSharePercent, minShareCents]);

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    await save(false);
  }

  /** Saves the group buy, and publishes it to members right after when asked. */
  async function save(publish: boolean) {
    setSaving(true);
    setFormError(null);
    setNotice(null);
    const optionalInt = (value: string) => (value ? Number.parseInt(value, 10) : null);
    const body = {
      offerType: 'GROUP_BUY',
      vendorName: form.vendorName,
      vendorEmail: form.vendorEmail,
      vendorPhone: form.vendorPhone,
      vendorProspectId: fromItem?.vendorProspectId ?? null,
      imageUrl: form.imageUrl,
      title: form.title,
      description: form.description,
      regularPriceCents: toCents(form.regularPrice),
      regularPriceSource: form.regularPriceSource,
      memberPriceCents: toCents(form.memberPrice),
      vendorPayoutCents: toCents(form.vendorPayout),
      commonsSplitBps: percentToBps(form.commonsSharePercent),
      quantityPerMember: optionalInt(form.quantityPerMember) ?? 1,
      maximumQuantity: optionalInt(form.maximumQuantity),
      minimumCommitments: optionalInt(form.minimumCommitments),
      minimumPaidOrders: optionalInt(form.minimumPaidOrders),
      commitmentDeadline: form.commitmentDeadline ? new Date(form.commitmentDeadline).toISOString() : null,
      paymentWindowHours: optionalInt(form.paymentWindowHours) ?? 48,
      fulfillmentDate: form.fulfillmentDate ? new Date(form.fulfillmentDate).toISOString() : null,
      fulfillmentMethod: form.fulfillmentMethod,
      pickupLocation: form.pickupLocation,
      serviceArea: form.serviceArea,
      redemptionRules: form.redemptionRules,
      refundPolicy: form.refundPolicy,
      substitutionPolicy: form.substitutionPolicy,
      terms: form.terms,
      sourcedProductId: fromItem?.sourcedProductId ?? null,
    };
    try {
      const response = await fetch(`/api/admin/commons/${coopId}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We couldn't save the draft.");
      if (publish) {
        const published = await fetch(`/api/admin/commons/${coopId}/offers/${data.offer.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'publish' }),
        });
        const result = await published.json();
        setNotice(
          published.ok
            ? `Published ${data.offer.title}. Members can see it now.`
            : `${data.offer.title} was saved as a draft, but it wasn't published: ${result.error ?? 'something went wrong'} Open it below to fix it and publish.`,
        );
      } else {
        setNotice(`Saved ${data.offer.title} as a draft.`);
      }
      setForm(emptyForm);
      setVendorSuggested(false);
      setFromItem(null);
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

  return (
    <div className="space-y-6">
      <Link href={`/portal/admin/commons/${coopId}`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Commons details
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Group buys</h1>
          <p className="mt-1 text-sm text-slate-400">
            Draft group buys for {coopId}, then publish them. Members see an offer as soon as you publish it. Members pay Cahootz; you send the
            vendor the orders and pay them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-300/20"
        >
          <Plus className="h-4 w-4" /> New group buy
        </button>
      </div>

      {showForm && (
        <form onSubmit={createDraft} className="space-y-5 rounded-[10px] border border-white/10 bg-white/[0.03] p-5" aria-label="New group buy">
          {fromItem && (
            <p className="rounded-md border border-emerald-300/20 bg-emerald-300/5 p-3 text-xs text-emerald-100" data-testid="offer-from-item">
              Started from the product idea {fromItem.title}{fromItem.memberShare ? ` (${fromItem.memberShare} each)` : ''}
              {fromItem.vendorContactName ? `, with ${fromItem.vendorContactName} from ${form.vendorName}` : ''}. The vendor amount is the bulk
              price we found online, and the member price adds 20% of the savings plus Stripe&apos;s fee. Change the amounts to what you agreed
              with the seller.
              {fromItem.feesEatSavings ? ' Card fees eat most of the savings on this one, so set the member price yourself.' : ''}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>
              Vendor
              <input className={input} placeholder="Who fills the order" value={form.vendorName} onChange={set('vendorName')} required minLength={2} maxLength={120} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Vendor email
                <input className={input} type="email" value={form.vendorEmail} onChange={set('vendorEmail')} />
              </label>
              <label className={label}>
                Vendor phone
                <input className={input} inputMode="tel" value={form.vendorPhone} onChange={set('vendorPhone')} />
              </label>
            </div>
            <label className={label}>
              Title members see
              <input className={input} value={form.title} onChange={set('title')} required minLength={3} maxLength={120} />
            </label>
            <div className={label}>
              Photo (optional)
              <div className="mt-1">
                <CompactImageUpload
                  uploadType="offer"
                  coopId={coopId}
                  resourceId={coopId}
                  label={form.imageUrl ? 'Change photo' : 'Upload a photo'}
                  value={form.imageUrl}
                  onChange={(url) => setForm((current) => ({ ...current, imageUrl: url }))}
                />
              </div>
              <input className={`${input} mt-2`} type="url" aria-label="Or paste a photo web address" placeholder="Or paste a web address: https://" value={form.imageUrl} onChange={set('imageUrl')} />
            </div>
            <label className={`${label} md:col-span-2`}>
              Description
              <textarea className={input} rows={2} value={form.description} onChange={set('description')} />
            </label>
            <label className={label}>
              Regular price ($)
              <input className={input} inputMode="decimal" value={form.regularPrice} onChange={set('regularPrice')} onBlur={suggestVendor} required />
            </label>
            <label className={label}>
              Where the regular price comes from
              <input className={input} placeholder="Posted shelf price" value={form.regularPriceSource} onChange={set('regularPriceSource')} required minLength={3} />
            </label>
            <label className={label}>
              Member price ($)
              <input className={input} inputMode="decimal" value={form.memberPrice} onChange={set('memberPrice')} onBlur={suggestVendor} required />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Vendor gets ($ per unit)
                <input
                  className={input}
                  inputMode="decimal"
                  value={form.vendorPayout}
                  onChange={(event) => {
                    setVendorSuggested(false);
                    set('vendorPayout')(event);
                  }}
                  aria-describedby="vendor-payout-help"
                  required
                />
                <span id="vendor-payout-help" className="mt-1 block text-[11px] font-normal leading-snug text-slate-400">
                  {vendorSuggested
                    ? `Filled in from the member price, keeping ${itemMarginBps / 100}% of the savings for the Commons and Cahootz. Change it to what you agreed with the vendor.`
                    : 'What we pay the vendor for each one, out of what members pay. The Commons and Cahootz split what’s left.'}
                </span>
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
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4" aria-label="Where each unit's money goes">
                  <div><dt className="text-xs text-slate-500">Member pays</dt><dd className="text-white">{money(preview.member)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Vendor gets</dt><dd className="text-white">{money(preview.vendor)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Commons ({form.commonsSharePercent || 0}%)</dt><dd className="text-white">{money(preview.commons)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Cahootz</dt><dd className="text-white">{money(preview.cahootz)}</dd></div>
                </dl>
              )}
              {preview.losesMoney && (
                <p className="mt-2 text-amber-300" role="alert">
                  There isn&apos;t enough left to cover Stripe&apos;s card fee (up to {money(preview.worstFee)} on some cards) and still give the
                  Commons and Cahootz at least {money(minShareCents)} each. Raise the member price or lower what the vendor gets. You can&apos;t
                  save this group buy until then.
                </p>
              )}
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
                  Hours to pay if a card is declined
                  <input className={input} inputMode="numeric" value={form.paymentWindowHours} onChange={set('paymentWindowHours')} />
                </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className={label}>
              How members get it
              <select className={input} value={form.fulfillmentMethod} onChange={set('fulfillmentMethod')}>
                <option value="DELIVERY">Vendor ships to their address</option>
                <option value="PICKUP">Pickup</option>
                <option value="SERVICE">A service (nothing ships)</option>
              </select>
            </label>
            <label className={label}>
              {form.fulfillmentMethod === 'PICKUP' ? 'Pickup location' : form.fulfillmentMethod === 'SERVICE' ? 'Where it&apos;s offered (optional)' : 'Where it ships (optional)'}
              <input
                className={input}
                value={form.fulfillmentMethod === 'PICKUP' ? form.pickupLocation : form.serviceArea}
                onChange={set(form.fulfillmentMethod === 'PICKUP' ? 'pickupLocation' : 'serviceArea')}
              />
            </label>
            <label className={label}>
              Ships or ready by (optional)
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !!preview?.losesMoney}
              onClick={(event) => {
                // Same checks as saving (required fields), then ask before members see it.
                if (event.currentTarget.form?.reportValidity()) setConfirmPublish(true);
              }}
              className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Publish'}
            </button>
            <button
              type="submit"
              disabled={saving || !!preview?.losesMoney}
              className="rounded-md border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-50"
            >
              Save draft
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog
        request={
          confirmPublish
            ? {
                title: 'Publish this group buy?',
                description: "Members of this Commons will see it right away, and it can't be edited after that.",
                confirmLabel: 'Publish',
              }
            : null
        }
        onClose={() => setConfirmPublish(false)}
        onConfirm={() => void save(true)}
      />
      {notice && <p className="text-sm text-emerald-300" role="status">{notice}</p>}

      {loading && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {error && <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {!loading && !error && offers.length === 0 && (
        <div className="rounded-[8px] border border-dashed border-white/15 p-10 text-center text-slate-400">No group buys yet. Start with New group buy.</div>
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
                <Users className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-white">{offer.title}</h2>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{STATUS_LABELS[offer.status] ?? offer.status}</span>
                  {offer.coopId === null && <span className="rounded-full bg-sky-300/10 px-2 py-0.5 text-xs text-sky-200">Every Commons</span>}
                  {offer.repeats && <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-xs text-amber-200">Repeats</span>}
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  Group buy · {offer.vendorName}
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
                <p className="text-xs text-slate-500">Committed</p>
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

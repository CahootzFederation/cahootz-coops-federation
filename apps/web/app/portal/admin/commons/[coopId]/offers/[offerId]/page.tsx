'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import { OFFER_STATUS_LABELS } from '@/lib/offer-labels';

interface Commitment {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  quantity: number;
  status: string;
  savingsCents: number;
  refundError: string | null;
  committedAt: string;
}

interface OfferDetail {
  id: string;
  offerType: 'MEMBER_DEAL' | 'GROUP_BUY';
  status: string;
  title: string;
  description: string | null;
  store: { name: string };
  product: { name: string };
  regularPriceCents: number;
  regularPriceSource: string;
  memberPriceCents: number;
  savingsCents: number;
  savingsPercent: number;
  federationFeeBps: number;
  commonsFeeBps: number;
  committedQuantity: number;
  minimumCommitments: number | null;
  minimumPaidOrders: number | null;
  maximumQuantity: number | null;
  quantityPerMember: number;
  commitmentDeadline: string | null;
  paymentDeadline: string | null;
  expiresAt: string | null;
  stewardNote: string | null;
  cancelReason: string | null;
  commitments: Commitment[];
  financials: {
    grossChargedCents: number;
    refundedCents: number;
    vendorProceedsCents: number;
    federationRevenueCents: number;
    commonsRevenueCents: number;
    processingFeesCents: number;
    verifiedSavingsCents: number;
    paidOrders: number;
  };
  exceptions: { commitmentId: string; status: string; refundError: string | null; paymentFailure: string | null }[];
}

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

interface Action { label: string; body: Record<string, unknown>; confirm?: string; danger?: boolean }

function actionsFor(offer: OfferDetail): Action[] {
  const actions: Action[] = [];
  const s = offer.status;
  if (s === 'DRAFT') actions.push({ label: 'Send to stewards', body: { action: 'submit' } });
  if (s === 'LIVE') actions.push({ label: 'Pause', body: { action: 'pause' } });
  if (s === 'PAUSED') actions.push({ label: 'Resume', body: { action: 'resume' } });
  if (offer.offerType === 'GROUP_BUY') {
    if (s === 'LIVE' && offer.committedQuantity >= (offer.minimumCommitments ?? Infinity)) {
      actions.push({ label: 'Close commitments now', body: { action: 'closeEarly' }, confirm: 'Close commitments now? No one else can join.' });
    }
    if (s === 'AWAITING_VENDOR') actions.push({ label: 'Open payment for the vendor', body: { action: 'openPayment' }, confirm: 'Only do this once the vendor has confirmed they can fill the order. Members will be asked to pay.' });
    if (s === 'CONFIRMED') actions.push({ label: 'Mark ordered', body: { action: 'fulfillment', status: 'ORDERED' } });
    if (s === 'ORDERED') actions.push({ label: 'Mark ready', body: { action: 'fulfillment', status: 'READY' } });
    if (s === 'READY') actions.push({ label: 'Mark finished', body: { action: 'fulfillment', status: 'FULFILLED' } });
  }
  if (!['FULFILLED', 'EXPIRED', 'CANCELLED', 'FAILED'].includes(s)) {
    actions.push({ label: 'Cancel offer', body: { action: 'cancel' }, danger: true });
  }
  return actions;
}

export default function OfferDetailPage() {
  const { coopId, offerId } = useParams<{ coopId: string; offerId: string }>();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/admin/commons/${coopId}/offers/${offerId}`;

  const load = useCallback(() => {
    fetch(base)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "We couldn't load this offer.");
        setOffer(data.offer);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "We couldn't load this offer."));
  }, [base]);

  useEffect(load, [load]);

  async function run(action: Action | { label: string; body: Record<string, unknown> }) {
    let body = action.body;
    if (body.action === 'cancel' || body.action === 'refundCommitment') {
      const reason = window.prompt(body.action === 'cancel' ? 'Why are you cancelling? Members who paid get a full refund.' : 'Why are you refunding this member?');
      if (!reason || reason.trim().length < 3) return;
      body = { ...body, reason };
    } else if ('confirm' in action && action.confirm && !window.confirm(action.confirm)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That didn't work.");
      setOffer(data.offer);
      if (body.action === 'submit' && data.result?.stewardCount === 0) {
        setNotice("Sent, but this Commons has no stewards yet, so nobody can approve it. Make someone a steward first.");
      } else {
        setNotice(`Done: ${action.label.toLowerCase()}.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (!offer) {
    return error ? (
      <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>
    ) : (
      <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
    );
  }

  const f = offer.financials;
  const stat = (label: string, value: string) => (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-white">{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href={`/portal/admin/commons/${coopId}/offers`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All offers
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-white">{offer.title}</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200" data-testid="offer-status">
            {OFFER_STATUS_LABELS[offer.status] ?? offer.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {offer.offerType === 'GROUP_BUY' ? 'Group buy' : 'Member deal'} · {offer.store.name} · {offer.product.name}
        </p>
        {offer.stewardNote && offer.status === 'DRAFT' && (
          <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">A steward sent this back: {offer.stewardNote}</p>
        )}
        {offer.cancelReason && <p className="mt-3 text-sm text-slate-400">Cancelled: {offer.cancelReason}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {actionsFor(offer).map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={busy}
            onClick={() => run(action)}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${action.danger ? 'border-red-400/40 text-red-200 hover:bg-red-400/10' : 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20'}`}
          >
            {action.label}
          </button>
        ))}
      </div>
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat('Regular price', `${money(offer.regularPriceCents)} (${offer.regularPriceSource})`)}
        {stat('Member price', money(offer.memberPriceCents))}
        {stat('Saving per unit', `${money(offer.savingsCents)} (${offer.savingsPercent}%)`)}
        {stat('Shares', `Cahootz ${offer.federationFeeBps / 100}% · Commons ${offer.commonsFeeBps / 100}%`)}
        {offer.offerType === 'GROUP_BUY'
          ? stat('Committed', `${offer.committedQuantity} of ${offer.minimumCommitments} needed${offer.maximumQuantity ? ` · ${offer.maximumQuantity} max` : ''}`)
          : stat('Ends', when(offer.expiresAt))}
        {offer.offerType === 'GROUP_BUY' && stat('Paid minimum', String(offer.minimumPaidOrders))}
        {offer.offerType === 'GROUP_BUY' && stat('Commit by', when(offer.commitmentDeadline))}
        {offer.offerType === 'GROUP_BUY' && stat('Pay by', when(offer.paymentDeadline))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white">Money, net of refunds</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Offer money">
          {stat('Members paid', money(f.grossChargedCents))}
          {stat('Refunded', money(f.refundedCents))}
          {stat('Vendor proceeds', money(f.vendorProceedsCents))}
          {stat('Stripe fees', money(f.processingFeesCents))}
          {stat('Cahootz revenue', money(f.federationRevenueCents))}
          {stat('Commons revenue', money(f.commonsRevenueCents))}
          {stat('Verified member savings', money(f.verifiedSavingsCents))}
          {stat('Paid orders', String(f.paidOrders))}
        </div>
      </section>

      {offer.exceptions.length > 0 && (
        <section className="rounded-[10px] border border-amber-400/30 bg-amber-400/5 p-4">
          <h2 className="text-sm font-semibold text-amber-200">Needs a look</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-100">
            {offer.exceptions.map((e) => (
              <li key={e.commitmentId}>
                {e.refundError ? `Refund failed: ${e.refundError}` : e.paymentFailure ? `Payment failed: ${e.paymentFailure}` : 'Didn’t pay in time (spot released)'}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white">Members in this offer</h2>
        {offer.commitments.length === 0 ? (
          <p className="text-sm text-slate-400">Nobody yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-white/10">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs text-slate-500">
                <tr><th className="p-3">Member</th><th className="p-3">Qty</th><th className="p-3">Status</th><th className="p-3">Saved</th><th className="p-3" /></tr>
              </thead>
              <tbody>
                {offer.commitments.map((c) => (
                  <tr key={c.id} className="border-t border-white/5">
                    <td className="p-3">{c.contactName ?? 'Member'}{c.contactPhone ? ` · ${c.contactPhone}` : ''}</td>
                    <td className="p-3">{c.quantity}</td>
                    <td className="p-3">{c.status.toLowerCase().replace('_', ' ')}{c.refundError ? ' (refund failed)' : ''}</td>
                    <td className="p-3">{money(c.savingsCents)}</td>
                    <td className="p-3 text-right">
                      {(c.status === 'PAID' || c.status === 'FULFILLED') && (
                        <button type="button" disabled={busy} onClick={() => run({ label: 'Refund', body: { action: 'refundCommitment', commitmentId: c.id } })} className="text-xs text-red-200 hover:underline">
                          Refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

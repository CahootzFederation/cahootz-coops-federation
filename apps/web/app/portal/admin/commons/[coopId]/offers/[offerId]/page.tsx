'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { ConfirmRequest } from '@/components/admin/confirm-dialog';
import { OFFER_STATUS_LABELS } from '@/lib/offer-labels';

interface Address { name: string; line1: string; line2: string | null; city: string; state: string; postalCode: string }

interface Order {
  commitmentId: string;
  status: string;
  quantity: number;
  name: string;
  phone: string | null;
  address: Address | null;
  paid: boolean;
  shipped: boolean;
  chargeError: string | null;
}

interface OfferDetail {
  id: string;
  status: string;
  title: string;
  description: string | null;
  vendorName: string;
  vendorEmail: string | null;
  vendorPhone: string | null;
  regularPriceCents: number;
  regularPriceSource: string;
  memberPriceCents: number;
  savingsCents: number;
  savingsPercent: number;
  split: {
    memberPaysCents: number;
    estimatedStripeFeeCents: number;
    vendorCents: number;
    commonsCents: number;
    cahootzCents: number;
    commonsSplitBps: number;
  };
  committedQuantity: number;
  minimumCommitments: number | null;
  minimumPaidOrders: number | null;
  maximumQuantity: number | null;
  quantityPerMember: number;
  commitmentDeadline: string | null;
  paymentDeadline: string | null;
  cancelReason: string | null;
  orders: Order[];
  vendorPay: { unitsSold: number; earnedCents: number; paidCents: number; owedCents: number };
  vendorPayouts: { id: string; amountCents: number; paidAt: string; method: string; note: string | null }[];
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
const addressLines = (a: Address | null) =>
  a ? [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.postalCode}`].filter(Boolean).join(', ') : 'No address';

/** The paid orders as plain text, ready to paste into an email to the vendor. */
function ordersForVendor(offer: OfferDetail) {
  const paid = offer.orders.filter((o) => o.paid && !o.shipped);
  const lines = paid.map((o, i) => `${i + 1}. ${o.quantity} × ${offer.title}\n   ${addressLines(o.address)}${o.phone ? `\n   Phone: ${o.phone}` : ''}`);
  const units = paid.reduce((sum, o) => sum + o.quantity, 0);
  return `${offer.title}: ${units} to ship\n\n${lines.join('\n\n')}`;
}

/** The orders as a spreadsheet file. */
function ordersCsv(offer: OfferDetail) {
  const cell = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['Name on order', 'Address line 1', 'Address line 2', 'City', 'State', 'ZIP', 'Phone', 'Quantity', 'Paid', 'Shipped'];
  const rows = offer.orders.map((o) => [
    o.address?.name ?? o.name, o.address?.line1, o.address?.line2, o.address?.city, o.address?.state, o.address?.postalCode,
    o.phone, o.quantity, o.paid ? 'yes' : 'no', o.shipped ? 'yes' : 'no',
  ]);
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n');
}

interface Action { label: string; body: Record<string, unknown>; confirm?: ConfirmRequest; danger?: boolean }

function actionsFor(offer: OfferDetail): Action[] {
  const actions: Action[] = [];
  const s = offer.status;
  if (s === 'DRAFT') {
    actions.push({
      label: 'Publish to members',
      body: { action: 'publish' },
      confirm: {
        title: 'Publish this group buy?',
        description: "Members of this Commons will see it right away, and it can't be edited after that.",
        confirmLabel: 'Publish',
      },
    });
  }
  if (s === 'LIVE') actions.push({ label: 'Pause', body: { action: 'pause' } });
  if (s === 'PAUSED') actions.push({ label: 'Resume', body: { action: 'resume' } });
  if (s === 'LIVE' && offer.committedQuantity >= (offer.minimumCommitments ?? Infinity)) {
    actions.push({
      label: 'Close and charge cards now',
      body: { action: 'closeEarly' },
      confirm: {
        title: 'Close it and charge cards now?',
        description: "No one else can join, and we'll charge everyone's saved card right away.",
        confirmLabel: 'Close and charge',
      },
    });
  }
  if (s === 'CONFIRMED') {
    actions.push({
      label: 'Mark sent to vendor',
      body: { action: 'fulfillment', status: 'ORDERED' },
      confirm: { title: 'Sent the order list?', description: 'Members will hear their order was placed with the vendor.', confirmLabel: 'Mark sent' },
    });
  }
  if (s === 'ORDERED') {
    actions.push({
      label: 'Mark shipped',
      body: { action: 'fulfillment', status: 'READY' },
      confirm: { title: 'Did it ship?', description: 'Members will hear their order is on its way.', confirmLabel: 'Mark shipped' },
    });
  }
  if (s === 'READY') actions.push({ label: 'Mark finished', body: { action: 'fulfillment', status: 'FULFILLED' } });
  if (!['FULFILLED', 'EXPIRED', 'CANCELLED', 'FAILED'].includes(s)) {
    actions.push({
      label: 'Cancel group buy',
      body: { action: 'cancel' },
      danger: true,
      confirm: {
        title: 'Cancel this group buy?',
        description: "Anyone who paid gets a full refund. Anyone who hasn't won't be charged. This can't be undone.",
        confirmLabel: 'Cancel group buy',
        danger: true,
        reasonLabel: 'Why are you cancelling? Members see this.',
      },
    });
  }
  return actions;
}

export default function OfferDetailPage() {
  const { coopId, offerId } = useParams<{ coopId: string; offerId: string }>();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [payout, setPayout] = useState({ amount: '', paidAt: new Date().toISOString().slice(0, 10), method: '', note: '' });
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

  /** Asks first in a dialog when the action has a confirm step; otherwise runs it. */
  async function run(action: Action) {
    if (action.confirm) {
      setPending(action);
      return;
    }
    await perform(action);
  }

  async function perform(action: Action, reason?: string) {
    const body = reason ? { ...action.body, reason } : action.body;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That didn't work.");
      setOffer(data.offer);
      setNotice(
        body.action === 'publish'
          ? 'Published. Members can see it now.'
          : body.action === 'vendorPayout'
            ? 'Vendor payment recorded.'
            : `Done: ${action.label.toLowerCase()}.`,
      );
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
        <ArrowLeft className="h-4 w-4" /> All group buys
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-white">{offer.title}</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200" data-testid="offer-status">
            {OFFER_STATUS_LABELS[offer.status] ?? offer.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Group buy · {offer.vendorName}
        </p>
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
        {stat('Vendor gets per unit', money(offer.split.vendorCents))}
        {stat(`Commons per unit (${offer.split.commonsSplitBps / 100}% of what's left)`, money(offer.split.commonsCents))}
        {stat('Cahootz per unit', money(offer.split.cahootzCents))}
        {stat('Committed', `${offer.committedQuantity} of ${offer.minimumCommitments} needed${offer.maximumQuantity ? ` · ${offer.maximumQuantity} max` : ''}`)}
        {stat('Paid minimum', String(offer.minimumPaidOrders))}
        {stat('Commit by', when(offer.commitmentDeadline))}
        {stat('Declined cards pay by', when(offer.paymentDeadline))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white">Money, net of refunds</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Offer money">
          {stat('Members paid', money(f.grossChargedCents))}
          {stat('Refunded', money(f.refundedCents))}
          {stat('Vendor’s share', money(f.vendorProceedsCents))}
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
                {e.refundError ? `Refund failed: ${e.refundError}` : e.paymentFailure ? `Card didn’t go through: ${e.paymentFailure}` : 'Didn’t pay in time (spot released)'}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Vendor">
        <h2 className="mb-2 text-sm font-semibold text-white">Vendor</h2>
        <div className="rounded-[10px] border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
          <p className="text-white">{offer.vendorName}</p>
          <p className="mt-1 text-slate-400">{[offer.vendorEmail, offer.vendorPhone].filter(Boolean).join(' · ') || 'No contact saved'}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3" aria-label="Vendor pay">
            {stat(`Earned (${offer.vendorPay.unitsSold} sold)`, money(offer.vendorPay.earnedCents))}
            {stat('Paid so far', money(offer.vendorPay.paidCents))}
            {stat('We owe them', money(offer.vendorPay.owedCents))}
          </div>
          {offer.vendorPayouts.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-400">
              {offer.vendorPayouts.map((p) => (
                <li key={p.id}>{money(p.amountCents)} by {p.method} on {new Date(p.paidAt).toLocaleDateString('en-US')}{p.note ? ` · ${p.note}` : ''}</li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 grid gap-2 sm:grid-cols-5"
            aria-label="Record a vendor payment"
            onSubmit={(event) => {
              event.preventDefault();
              const amountCents = Math.round(Number.parseFloat(payout.amount || '0') * 100);
              if (amountCents <= 0 || !payout.method.trim()) {
                setError('Enter how much you paid the vendor and how (check, Zelle, ACH).');
                return;
              }
              void run({
                label: 'Record vendor payment',
                body: { action: 'vendorPayout', amountCents, paidAt: payout.paidAt, method: payout.method, note: payout.note },
              }).then(() => setPayout((current) => ({ ...current, amount: '', note: '' })));
            }}
          >
            <input aria-label="Amount paid ($)" placeholder={`Amount ($${(offer.vendorPay.owedCents / 100).toFixed(2)} owed)`} inputMode="decimal" className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white" value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} />
            <input aria-label="Date paid" type="date" className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white" value={payout.paidAt} onChange={(e) => setPayout({ ...payout, paidAt: e.target.value })} />
            <input aria-label="How you paid" placeholder="Check, Zelle, ACH" className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white" value={payout.method} onChange={(e) => setPayout({ ...payout, method: e.target.value })} />
            <input aria-label="Note" placeholder="Note (optional)" className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white" value={payout.note} onChange={(e) => setPayout({ ...payout, note: e.target.value })} />
            <button type="submit" disabled={busy} className="rounded-md border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 font-semibold text-emerald-100 hover:bg-emerald-300/20 disabled:opacity-50">
              Mark vendor paid
            </button>
          </form>
        </div>
      </section>

      <section aria-label="Orders">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Orders</h2>
          {offer.orders.some((o) => o.paid) && (
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                onClick={() => {
                  void navigator.clipboard.writeText(ordersForVendor(offer)).then(
                    () => setNotice('Copied. Paste it into an email to the vendor.'),
                    () => setError("We couldn't copy that. Use Download instead."),
                  );
                }}
              >
                Copy for vendor
              </button>
              <a
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(ordersCsv(offer))}`}
                download={`${offer.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-orders.csv`}
              >
                Download spreadsheet
              </a>
            </div>
          )}
        </div>
        {offer.orders.length === 0 ? (
          <p className="text-sm text-slate-400">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-white/10">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs text-slate-500">
                <tr><th className="p-3">Ship to</th><th className="p-3">Phone</th><th className="p-3">Qty</th><th className="p-3">Status</th><th className="p-3" /></tr>
              </thead>
              <tbody>
                {offer.orders.map((o) => (
                  <tr key={o.commitmentId} className="border-t border-white/5">
                    <td className="p-3">{addressLines(o.address)}</td>
                    <td className="p-3">{o.phone ?? '—'}</td>
                    <td className="p-3">{o.quantity}</td>
                    <td className="p-3">
                      {o.shipped ? 'Shipped' : o.paid ? 'Paid' : o.chargeError ? `Card didn’t go through` : o.status === 'COMMITTED' ? 'Card saved, not charged' : o.status.toLowerCase().replace('_', ' ')}
                    </td>
                    <td className="space-x-3 p-3 text-right">
                      {o.paid && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run({
                              label: 'Refund',
                              body: { action: 'refundCommitment', commitmentId: o.commitmentId },
                              confirm: {
                                title: `Refund ${o.name}?`,
                                description: `They get their full payment back for ${o.quantity} × ${offer.title}.`,
                                confirmLabel: 'Refund',
                                danger: true,
                                reasonLabel: 'Why are you refunding this member?',
                              },
                            })
                          } className="text-xs text-red-200 hover:underline">
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
        <p className="mt-2 text-xs text-slate-500">Only platform admins can see members&apos; addresses. Share them only with this vendor.</p>
      </section>
      <ConfirmDialog
        request={pending?.confirm ?? null}
        onClose={() => setPending(null)}
        onConfirm={(reason) => {
          if (pending) void perform(pending, reason);
        }}
      />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import { OFFER_STATUS_LABELS } from '@/lib/offer-labels';

interface ReportRow {
  offerId: string;
  /** Empty when the deal is open to every Commons. */
  coopId: string | null;
  title: string;
  offerType: string;
  status: string;
  vendorName: string;
  grossChargedCents: number;
  refundedCents: number;
  vendorProceedsCents: number;
  federationRevenueCents: number;
  commonsRevenueCents: number;
  processingFeesCents: number;
  verifiedSavingsCents: number;
  paidOrders: number;
}

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const COLUMNS: Array<[keyof ReportRow, string]> = [
  ['grossChargedCents', 'Members paid'],
  ['refundedCents', 'Refunded'],
  ['vendorProceedsCents', 'Vendor proceeds'],
  ['processingFeesCents', 'Stripe fees'],
  ['federationRevenueCents', 'Cahootz revenue'],
  ['commonsRevenueCents', 'Commons revenue'],
  ['verifiedSavingsCents', 'Member savings'],
];

export default function OffersReportPage() {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/marketplace/offers-report')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "We couldn't load the report.");
        setRows(data.rows);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "We couldn't load the report."));
  }, []);

  const totals = COLUMNS.map(([key]) => (rows ?? []).reduce((sum, row) => sum + (row[key] as number), 0));

  return (
    <div className="space-y-6">
      <Link href="/portal/admin/marketplace" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Marketplace settings
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-white">Group buys report</h1>
        <p className="mt-1 text-sm text-slate-400">
          Completed payments only, net of refunds. Savings count only once a member has paid.
        </p>
      </div>
      {error && <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {!rows && !error && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {rows && (
        <div className="overflow-x-auto rounded-[10px] border border-white/10">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-white/[0.03] text-xs text-slate-500">
              <tr>
                <th className="p-3">Offer</th>
                <th className="p-3">Commons</th>
                <th className="p-3">Vendor</th>
                <th className="p-3">Paid orders</th>
                {COLUMNS.map(([, label]) => <th key={label} className="p-3 text-right">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.offerId} className="border-t border-white/5">
                  <td className="p-3">
                    {row.coopId ? (
                      <Link href={`/portal/admin/commons/${row.coopId}/offers/${row.offerId}`} className="text-white hover:underline">{row.title}</Link>
                    ) : (
                      // Every Commons' group buys page lists it, so open it from any of them.
                      <span className="text-white" title="Open it from any Commons' group buys page">{row.title}</span>
                    )}
                    <p className="text-xs text-slate-500">Group buy · {OFFER_STATUS_LABELS[row.status] ?? row.status}</p>
                  </td>
                  <td className="p-3">{row.coopId ?? 'Every Commons'}</td>
                  <td className="p-3">{row.vendorName}</td>
                  <td className="p-3">{row.paidOrders}</td>
                  {COLUMNS.map(([key]) => <td key={key} className="p-3 text-right">{money(row[key] as number)}</td>)}
                </tr>
              ))}
              <tr className="border-t border-white/20 font-semibold text-white">
                <td className="p-3" colSpan={4}>Total</td>
                {totals.map((total, index) => <td key={COLUMNS[index]![0]} className="p-3 text-right">{money(total)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2, MessageCircleQuestion, Store } from 'lucide-react';

interface DemandRow {
  id: string;
  coopId: string;
  categoryLabel: string;
  title: string;
  askedAt: string;
  interestCount: number;
  interestFinal: boolean;
  evidenceKind: string;
  needPosts: { posts: number; members: number } | null;
}

interface ProspectRow {
  id: string;
  businessName: string;
  categoryLabel: string;
  description: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  sourceType: string;
  status: string;
  createdAt: string;
  referralCount: number;
  commons: string[];
  referrals: Array<{ coopId: string; howKnown: string | null; mayNameReferrer: boolean; referrer: string | null; createdAt: string }>;
}

const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const SOURCE: Record<string, string> = { MEMBER_REFERRAL: 'Member referral', CAHOOTZ_SHOP: 'Cahootz shop', WEB_SEARCH: 'Web search', DIRECTORY_SITE: 'Directory', ADMIN: 'Added by admin' };

/** Platform admin: what members want (from Sage's public questions) and the businesses they recommended. */
export default function VendorOutreachPage() {
  const [demand, setDemand] = useState<DemandRow[] | null>(null);
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'demand' | 'prospects'>('demand');

  useEffect(() => {
    fetch('/api/admin/outreach')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "We couldn't load vendor outreach.");
        setDemand(data.demand);
        setProspects(data.prospects);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "We couldn't load vendor outreach."));
  }, []);

  return (
    <div className="space-y-6">
      <Link href="/portal/admin" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All Commons
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-white">Vendor outreach</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          What members want, and the local businesses they recommended. Demand comes only from Sage&apos;s public questions to each
          Commons and how many members answered, never from anyone&apos;s private messages.
        </p>
      </div>

      <div className="flex gap-2" role="tablist">
        {(['demand', 'prospects'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md border px-3 py-1.5 text-sm ${tab === key ? 'border-emerald-300/60 bg-emerald-300/15 text-emerald-100' : 'border-white/10 text-slate-300'}`}
          >
            {key === 'demand' ? `Demand (${demand?.length ?? 0})` : `Businesses (${prospects.length})`}
          </button>
        ))}
      </div>

      {error && <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {!demand && !error && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}

      {demand && tab === 'demand' && (
        demand.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-white/15 p-10 text-center text-slate-400">
            Sage hasn&apos;t asked any Commons about deals yet. It checks every Monday.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {demand.map((row) => (
              <div key={row.id} className="rounded-[10px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start gap-3">
                  <MessageCircleQuestion className="mt-0.5 h-5 w-5 text-emerald-300" />
                  <div className="flex-1">
                    <p className="font-semibold text-white">{row.title}</p>
                    <p className="text-xs text-slate-400">{row.coopId} · {row.categoryLabel} · asked {date(row.askedAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-white">{row.interestCount}</p>
                    <p className="text-xs text-slate-500">{row.interestFinal ? 'answered' : 'so far'}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Why Sage asked: {row.evidenceKind}
                  {row.needPosts ? ` (${row.needPosts.posts} posts from ${row.needPosts.members} members)` : ''}
                </p>
              </div>
            ))}
          </div>
        )
      )}

      {demand && tab === 'prospects' && (
        prospects.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-white/15 p-10 text-center text-slate-400">No businesses yet. Members can recommend them from the marketplace.</div>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-white/10">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs text-slate-500">
                <tr><th className="p-3">Business</th><th className="p-3">Contact</th><th className="p-3">From</th><th className="p-3">Recommended by</th><th className="p-3">Status</th></tr>
              </thead>
              <tbody>
                {prospects.map((prospect) => (
                  <tr key={prospect.id} className="border-t border-white/5 align-top">
                    <td className="p-3">
                      <div className="flex items-center gap-2"><Store className="h-4 w-4 text-orange-200" /><span className="font-semibold text-white">{prospect.businessName}</span></div>
                      <p className="text-xs text-slate-500">{prospect.categoryLabel}{prospect.city ? ` · ${prospect.city}${prospect.state ? `, ${prospect.state}` : ''}` : ''}</p>
                      {prospect.description && <p className="mt-1 text-xs text-slate-400">{prospect.description}</p>}
                    </td>
                    <td className="p-3 text-xs">
                      {prospect.website && <p>{prospect.website}</p>}
                      {prospect.email && <p>{prospect.email}</p>}
                      {prospect.phone && <p>{prospect.phone}</p>}
                    </td>
                    <td className="p-3 text-xs">{SOURCE[prospect.sourceType] ?? prospect.sourceType}<p className="text-slate-500">{date(prospect.createdAt)}</p></td>
                    <td className="p-3 text-xs">
                      {prospect.referrals.map((referral, index) => (
                        <p key={index}>
                          {referral.referrer ?? 'A member'} ({referral.coopId}){referral.mayNameReferrer ? ' · OK to name' : ''}
                          {referral.howKnown ? <span className="block text-slate-500">&ldquo;{referral.howKnown}&rdquo;</span> : null}
                        </p>
                      ))}
                    </td>
                    <td className="p-3 text-xs">{prospect.status.toLowerCase().replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

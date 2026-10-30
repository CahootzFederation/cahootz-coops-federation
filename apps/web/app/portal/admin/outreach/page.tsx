'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2, MessageCircleQuestion, Package, Store } from 'lucide-react';

import { ConfirmDialog } from '@/components/admin/confirm-dialog';

interface DemandRow {
  id: string;
  coopId: string;
  categoryLabel: string;
  itemName: string | null;
  title: string;
  askedAt: string;
  interestCount: number;
  interestFinal: boolean;
  evidenceKind: string;
  needPosts: { posts: number; members: number } | null;
}

interface CampaignRow {
  id: string;
  coopId: string;
  categoryLabel: string;
  offerType: 'MEMBER_DEAL' | 'GROUP_BUY';
  item: { id: string; name: string; supplierName: string; sourceUrl: string } | null;
  searchTerms: string[];
  area: string | null;
  demandEvidence: { interestCount?: number; source?: string; needPosts?: { posts: number; members: number } | null };
  pitchPoints: string | null;
  maxEmails: number;
  maxSearches: number;
  searchesUsed: number;
  status: string;
  rejectReason: string | null;
  endReason: NoSellersReason | null;
  expiresAt: string | null;
  createdAt: string;
  counts: { found: number; queued: number; sent: number; responded: number; skipped: number };
  prospects: { prospectId: string; businessName: string; email: string | null; phone: string | null; source: string; status: string; skipReason: string | null; pipeline: string }[];
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
  sourceUrl: string | null;
  status: string;
  statusNote: string | null;
  convertedOfferId: string | null;
  createdAt: string;
  latestResponse: { interest: string; contactName: string | null; bestContact: string | null; offerIdea: string | null; respondedAt: string } | null;
  item: { coopId: string; id: string; name: string } | null;
  referrals: { coopId: string; howKnown: string | null; mayNameReferrer: boolean; referrer: string | null; createdAt: string }[];
}

interface ItemRow {
  profileId: string;
  productId: string;
  profileName: string;
  coopId: string | null;
  status: 'CANDIDATE' | 'APPROVED';
  fitScore: number;
  fitReason: string;
  purpose: string;
  name: string;
  brand: string;
  supplierName: string;
  category: string;
  categoryKey: string;
  description: string;
  sourceUrl: string;
  price: {
    memberShare: string;
    peopleNeeded: number;
    regularPriceCents: number;
    bulkShareCents: number;
    sourceUrl: string;
    comparisonUrl: string | null;
    verifiedFacts: string[];
    risks: string[];
    observedAt: string;
    expired: boolean;
  } | null;
  campaign: { id: string; status: string; endReason: NoSellersReason | null } | null;
  suggestion: {
    packSize: number;
    packLabel: string;
    membersNeeded: number;
    regularPriceCents: number;
    memberPriceCents: number;
    vendorPayoutCents: number;
    stripeFeeCents: number;
    commonsCents: number;
    cahootzCents: number;
    savingsPercent: number;
    qualifies: boolean;
  } | null;
}

interface Pricing {
  minShareCents: number;
  itemMarginBps: number;
  itemMinOrderCents: number;
  itemMinSavingsBps: number;
  itemMinSavingsCents: number;
}

interface SourceRow {
  id: string;
  type: string;
  name: string;
  config: { domain?: string };
  suggestedBy: string;
  reason: string | null;
  status: 'SUGGESTED' | 'ENABLED' | 'DISABLED';
}

type Funnel = Record<string, number>;

type NoSellersReason = 'NO_SOURCES' | 'NOTHING_FOUND' | 'NOTHING_FOUND_NO_WEB_SEARCH' | 'NONE_REACHABLE';
const BUILT_IN_SOURCES = ['CAHOOTZ_SHOP', 'MEMBER_REFERRAL', 'WEB_SEARCH'];

const NO_SELLERS_SHORT: Record<NoSellersReason, string> = {
  NO_SOURCES: 'every place to search was turned off.',
  NOTHING_FOUND: 'nothing turned up in that area.',
  NOTHING_FOUND_NO_WEB_SEARCH: "nothing turned up, and web search didn't run.",
  NONE_REACHABLE: 'businesses were found, but none could be emailed.',
};

/** Why a seller search found nobody, and what to try next. */
function noSellersText(reason: NoSellersReason, area: string | null, found: number) {
  const near = area ? ` near ${area}` : '';
  switch (reason) {
    case 'NO_SOURCES':
      return 'Every place to search is turned off, so Sage had nowhere to look. Turn one on under Sources, then start a new search.';
    case 'NOTHING_FOUND':
      return `Sage searched${near} and found no businesses that sell this. Try a bigger area, like the whole city or county.`;
    case 'NOTHING_FOUND_NO_WEB_SEARCH':
      return `No shops on Cahootz or member recommendations matched${near}, and web search didn't run (it's off under Sources, or Sage isn't allowed to act for this Commons). Turn web search on or try a bigger area.`;
    case 'NONE_REACHABLE':
      return `Sage found ${found} ${found === 1 ? 'business' : 'businesses'}${near}, but none can be emailed (the reasons are listed below). You could call them, or try a bigger area.`;
  }
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const SOURCE: Record<string, string> = { MEMBER_REFERRAL: 'Member referral', CAHOOTZ_SHOP: 'Cahootz shop', WEB_SEARCH: 'Web search', DIRECTORY_SITE: 'Directory', ADMIN: 'Added by admin' };
const STATUS: Record<string, string> = {
  FOUND: 'Found', VERIFIED: 'Checked', QUEUED: 'Queued', CONTACTED: 'Emailed', FOLLOWED_UP: 'Followed up', INTERESTED: 'Said yes',
  IN_TALKS: 'In talks', CONVERTED: 'Deal live', DECLINED: 'Not now', UNSUBSCRIBED: 'Unsubscribed', BOUNCED: 'Bounced', SKIPPED: 'Skipped',
};
const SKIP: Record<string, string> = {
  NO_EMAIL: 'Phone only', BAD_EMAIL: 'Bad email', NO_MAIL_SERVER: "Domain can't get mail", UNSUBSCRIBED: 'Unsubscribed', SUPPRESSED: 'Do not email',
  CONTACTED_RECENTLY: 'Emailed in last 90 days', DECLINED_RECENTLY: 'Said not now', ALREADY_TALKING: 'Already talking', OVER_LIMIT: 'Over the email limit',
};
const TABS = ['campaigns', 'businesses', 'items', 'demand', 'sources'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { campaigns: 'campaigns', businesses: 'businesses', items: 'product ideas', demand: 'demand', sources: 'sources' };
const WHY: Record<string, string> = { community_pattern: 'a community pattern', need_posts: 'public Need posts', approved_item: 'an item you approved' };
interface Category { key: string; label: string }

const btn = 'rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const primary = `${btn} border-emerald-300/40 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20`;
const quiet = `${btn} border-white/15 text-slate-200 hover:bg-white/10`;
const danger = `${btn} border-red-400/40 text-red-200 hover:bg-red-400/10`;
const input = 'mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none';

/** Platform admin: what members want, Sage's campaigns, the businesses found, and how it's going. */
export default function VendorOutreachPage() {
  const [data, setData] = useState<{
    demand: DemandRow[];
    campaigns: CampaignRow[];
    prospects: ProspectRow[];
    items: ItemRow[];
    sources: SourceRow[];
    funnel: Funnel;
    sendingLive: boolean;
    categories: Category[];
    pricing: Pricing;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('campaigns');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/admin/outreach')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "We couldn't load vendor outreach.");
        setData(body);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "We couldn't load vendor outreach."));
  }, []);
  useEffect(load, [load]);

  async function post(url: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "That didn't work.");
      setNotice(done);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const f = data?.funnel;
  const counts: Record<Tab, number> = {
    campaigns: data?.campaigns.length ?? 0,
    businesses: data?.prospects.length ?? 0,
    items: data?.items.length ?? 0,
    demand: data?.demand.length ?? 0,
    sources: data?.sources.length ?? 0,
  };

  return (
    <div className="space-y-6">
      <Link href="/portal/admin" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All Commons
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-white">Vendor outreach</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Sage asks each Commons what they&apos;d buy together, proposes campaigns from the answers, and, once you approve one, finds and emails
          local businesses within its limits. When a business says yes, it lands here for you to follow up.
        </p>
      </div>

      {data && !data.sources.some((source) => source.status === 'ENABLED' && BUILT_IN_SOURCES.includes(source.type)) && (
        <div role="alert" className="rounded-[8px] border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
          Every place to search is turned off (shops on Cahootz, member recommendations and web search), so new seller searches will find nobody.
          Turn at least one on under Sources.
        </div>
      )}

      {data && !data.sendingLive && (
        <div className="rounded-[8px] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          Email isn&apos;t sending yet: emails are saved as previews (dry run). Real sending starts once the outreach sender
          (<code>RESEND_OUTREACH_FROM_EMAIL</code>, <code>OUTREACH_REPLY_TO_EMAIL</code>) and the mailing address
          (platform setting <code>outreach.postalAddress</code>) are set.
        </div>
      )}

      {f && (
        <section aria-label="Outreach funnel" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[
            ['Questions asked', f.questionsAsked],
            ['Members interested', f.membersInterested],
            ['Campaigns approved', f.campaignsApproved],
            ['Businesses found', f.businessesFound],
            ['Emailed', f.businessesEmailed],
            ['Said yes', f.saidYes],
            ['In talks', f.inTalks],
            ['Deals live', f.dealsLive],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-md border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md border px-3 py-1.5 text-sm capitalize ${tab === key ? 'border-emerald-300/60 bg-emerald-300/15 text-emerald-100' : 'border-white/10 text-slate-300'}`}
          >
            {TAB_LABEL[key]} ({counts[key]})
          </button>
        ))}
      </div>

      {notice && <p className="text-sm text-emerald-300">{notice}</p>}
      {error && <div className="flex gap-2 rounded-[8px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {!data && !error && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}

      {data && tab === 'campaigns' && (
        data.campaigns.length === 0 ? (
          <Empty text="No campaigns yet. Sage proposes one when at least 5 members answer a deal question." />
        ) : (
          <div className="space-y-4">
            {data.campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} busy={busy} post={post} />)}
          </div>
        )
      )}

      {data && tab === 'businesses' && (
        data.prospects.length === 0 ? (
          <Empty text="No businesses yet. Members can recommend them, and campaigns find more." />
        ) : (
          <div className="space-y-3">
            {data.prospects.map((prospect) => <ProspectCard key={prospect.id} prospect={prospect} busy={busy} post={post} />)}
          </div>
        )
      )}

      {data && tab === 'items' && (
        data.items.length === 0 ? (
          <div className="space-y-3">
            <PricingSettings pricing={data.pricing} busy={busy} post={post} />
            <Empty text="No product ideas yet. The product discovery bot adds them as it finds items for each Commons." />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Items the product discovery bot found for each Commons. Approve the good ones, then find a seller: Sage looks for a local shop
              or the supplier&apos;s wholesale contact. Sage may also ask the Commons about an approved item in its weekly question.
            </p>
            <PricingSettings pricing={data.pricing} busy={busy} post={post} />
            {data.items.map((item) => (
              <ItemCard key={`${item.profileId}:${item.productId}`} item={item} categories={data.categories} busy={busy} post={post} />
            ))}
          </div>
        )
      )}

      {data && tab === 'demand' && (
        data.demand.length === 0 ? (
          <Empty text="Sage hasn't asked any Commons about deals yet. It checks every Monday." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.demand.map((row) => (
              <div key={row.id} className="rounded-[10px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start gap-3">
                  <MessageCircleQuestion className="mt-0.5 h-5 w-5 text-emerald-300" />
                  <div className="flex-1">
                    <p className="font-semibold text-white">{row.title}</p>
                    <p className="text-xs text-slate-400">{row.coopId} · {row.itemName ?? row.categoryLabel} · asked {date(row.askedAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-white">{row.interestCount}</p>
                    <p className="text-xs text-slate-500">{row.interestFinal ? 'answered' : 'so far'}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Why Sage asked: {WHY[row.evidenceKind] ?? row.evidenceKind}{row.needPosts ? ` (${row.needPosts.posts} posts from ${row.needPosts.members} members)` : ''}
                </p>
              </div>
            ))}
          </div>
        )
      )}

      {data && tab === 'sources' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-400">Where Sage may look for businesses. Places Sage suggests do nothing until you turn them on.</p>
          {data.sources.map((source) => (
            <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-white/10 bg-white/[0.03] p-3">
              <div>
                <p className="font-semibold text-white">{source.name}</p>
                <p className="text-xs text-slate-400">
                  {source.config?.domain ? `${source.config.domain} · ` : ''}{source.suggestedBy === 'sage' ? 'Suggested by Sage' : 'Built in'}
                  {source.reason ? ` · ${source.reason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{source.status === 'ENABLED' ? 'On' : source.status === 'SUGGESTED' ? 'Suggested' : 'Off'}</span>
                {source.status === 'ENABLED' ? (
                  <button className={quiet} disabled={busy} onClick={() => post(`/api/admin/outreach/sources/${source.id}`, { status: 'DISABLED' }, `${source.name} turned off.`)}>Turn off</button>
                ) : (
                  <button className={primary} disabled={busy} onClick={() => post(`/api/admin/outreach/sources/${source.id}`, { status: 'ENABLED' }, `${source.name} turned on.`)}>Turn on</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-[8px] border border-dashed border-white/15 p-10 text-center text-slate-400">{text}</div>;
}

type Post = (url: string, body: unknown, done: string) => Promise<void>;

function CampaignCard({ campaign, busy, post }: { campaign: CampaignRow; busy: boolean; post: Post }) {
  const [confirmReject, setConfirmReject] = useState(false);
  const [area, setArea] = useState(campaign.area ?? '');
  const [maxEmails, setMaxEmails] = useState(String(campaign.maxEmails));
  const [pitch, setPitch] = useState(campaign.pitchPoints ?? '');
  const url = `/api/admin/outreach/campaigns/${campaign.id}`;
  const evidence = campaign.demandEvidence ?? {};
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.03] p-4" aria-label={`Campaign ${campaign.item?.name ?? campaign.categoryLabel} for ${campaign.coopId}`} data-testid={`campaign-${campaign.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white">{campaign.item?.name ?? campaign.categoryLabel} · {campaign.coopId}</p>
          <p className="text-xs text-slate-400">
            Group buy · proposed {date(campaign.createdAt)}
            {campaign.expiresAt ? ` · ends ${date(campaign.expiresAt)}` : ''}
          </p>
        </div>
        {campaign.endReason ? (
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-100" data-testid="campaign-status">found no sellers</span>
        ) : (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200" data-testid="campaign-status">{campaign.status.toLowerCase()}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-300">
        {evidence.source === 'discovered_item'
          ? 'You started this seller search from a product idea.'
          : <>
              {evidence.interestCount ?? 0} members answered Sage&apos;s question
              {evidence.needPosts ? `, plus ${evidence.needPosts.posts} public Need posts from ${evidence.needPosts.members} members` : ''}.
            </>}{' '}
        Search terms: {campaign.searchTerms.join(', ')}.
      </p>
      {campaign.item && (
        <p className="mt-1 text-xs text-slate-400">
          Looking for a seller of {campaign.item.name} (found at{' '}
          <a className="underline" href={campaign.item.sourceUrl} target="_blank" rel="noreferrer">{campaign.item.supplierName}</a>).
        </p>
      )}

      {campaign.status === 'PROPOSED' && (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-xs text-slate-300">
            Search near (city or area)
            <input className={input} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Atlanta, GA" />
          </label>
          <label className="text-xs text-slate-300">
            Most emails to send
            <input className={input} inputMode="numeric" value={maxEmails} onChange={(e) => setMaxEmails(e.target.value)} />
          </label>
          <label className="text-xs text-slate-300 md:col-span-3">
            Extra line for the email (optional, no prices or promises)
            <input className={input} value={pitch} onChange={(e) => setPitch(e.target.value)} />
          </label>
          <div className="flex gap-2 md:col-span-3">
            <button
              className={primary}
              disabled={busy}
              onClick={() => post(url, { action: 'approve', area, maxEmails: Number(maxEmails) || undefined, pitchPoints: pitch || null }, 'Campaign approved. Sage will start finding businesses within the hour.')}
            >
              Approve campaign
            </button>
            <button
              className={danger}
              disabled={busy}
              onClick={() => setConfirmReject(true)}
            >
              Reject
            </button>
            <ConfirmDialog
              request={confirmReject ? { title: 'Reject this campaign?', description: "Sage won't reach out for it.", confirmLabel: 'Reject', danger: true, reasonLabel: 'Why not? Sage will see this next time.' } : null}
              onClose={() => setConfirmReject(false)}
              onConfirm={(reason) => void post(url, { action: 'reject', reason }, 'Campaign rejected.')}
            />
          </div>
        </div>
      )}

      {campaign.status !== 'PROPOSED' && (
        <>
          <p className="mt-2 text-xs text-slate-400">
            Near {campaign.area} · up to {campaign.maxEmails} emails · web searches {campaign.searchesUsed}/{campaign.maxSearches}
            {campaign.rejectReason ? ` · rejected: ${campaign.rejectReason}` : ''}
          </p>
          {campaign.endReason && (
            <p className="mt-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-sm text-amber-100" data-testid="no-sellers">
              {noSellersText(campaign.endReason, campaign.area, campaign.counts.found)}
            </p>
          )}
          <div className="mt-2 grid grid-cols-5 gap-2 text-sm">
            {(['found', 'queued', 'sent', 'responded', 'skipped'] as const).map((key) => (
              <div key={key}><p className="text-xs capitalize text-slate-500">{key}</p><p className="font-semibold text-white">{campaign.counts[key]}</p></div>
            ))}
          </div>
          {campaign.prospects.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-300">
              {campaign.prospects.map((row) => (
                <li key={row.prospectId}>
                  <span className="text-white">{row.businessName}</span> · {SOURCE[row.source] ?? row.source} · {row.status.toLowerCase().replace('_', ' ')}
                  {row.skipReason ? ` (${SKIP[row.skipReason] ?? row.skipReason})` : ''}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            {campaign.status === 'ACTIVE' && <button className={quiet} disabled={busy} onClick={() => post(url, { action: 'pause' }, 'Campaign paused. Nothing more will be sent.')}>Pause</button>}
            {campaign.status === 'PAUSED' && <button className={primary} disabled={busy} onClick={() => post(url, { action: 'resume' }, 'Campaign resumed.')}>Resume</button>}
            {['ACTIVE', 'PAUSED'].includes(campaign.status) && <button className={danger} disabled={busy} onClick={() => post(url, { action: 'complete' }, 'Campaign ended.')}>End campaign</button>}
          </div>
        </>
      )}
    </div>
  );
}

function ProspectCard({ prospect, busy, post }: { prospect: ProspectRow; busy: boolean; post: Post }) {
  const [confirmConverted, setConfirmConverted] = useState(false);
  const url = `/api/admin/outreach/prospects/${prospect.id}`;
  const response = prospect.latestResponse;
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.03] p-4" aria-label={`Business ${prospect.businessName}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Store className="mt-0.5 h-4 w-4 text-orange-200" />
          <div>
            <p className="font-semibold text-white">{prospect.businessName}</p>
            <p className="text-xs text-slate-400">
              {prospect.categoryLabel}{prospect.city ? ` · ${prospect.city}${prospect.state ? `, ${prospect.state}` : ''}` : ''} · {SOURCE[prospect.sourceType] ?? prospect.sourceType} · {date(prospect.createdAt)}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">{STATUS[prospect.status] ?? prospect.status}</span>
      </div>
      <p className="mt-2 text-xs text-slate-300">
        {[prospect.email, prospect.phone, prospect.website].filter(Boolean).join(' · ') || 'No contact details'}
        {prospect.sourceUrl ? <> · <a className="underline" href={prospect.sourceUrl} target="_blank" rel="noreferrer">where found</a></> : null}
      </p>
      {prospect.description && <p className="mt-1 text-xs text-slate-400">{prospect.description}</p>}
      {prospect.referrals.map((referral, index) => (
        <p key={index} className="mt-1 text-xs text-slate-400">
          Recommended by {referral.referrer ?? 'a member'} ({referral.coopId}){referral.mayNameReferrer ? ', OK to name' : ''}
          {referral.howKnown ? `: “${referral.howKnown}”` : ''}
        </p>
      ))}
      {response && (
        <div className="mt-2 rounded-md border border-emerald-300/20 bg-emerald-300/5 p-2 text-xs text-emerald-100">
          {response.interest === 'YES' ? 'Said yes' : response.interest === 'NOT_NOW' ? 'Said not right now' : 'Unsubscribed'} on {date(response.respondedAt)}
          {response.contactName ? ` · ${response.contactName}` : ''}{response.bestContact ? ` · ${response.bestContact}` : ''}
          {response.offerIdea ? <span className="block text-emerald-200/80">“{response.offerIdea}”</span> : null}
        </div>
      )}
      {prospect.statusNote && <p className="mt-1 text-xs text-slate-500">Note: {prospect.statusNote}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {['INTERESTED', 'CONTACTED', 'FOLLOWED_UP', 'FOUND'].includes(prospect.status) && (
          <button className={primary} disabled={busy} onClick={() => post(url, { action: 'inTalks' }, `${prospect.businessName} marked in talks.`)}>Mark in talks</button>
        )}
        {prospect.item && ['INTERESTED', 'IN_TALKS'].includes(prospect.status) && (
          <Link className={primary} href={`/portal/admin/commons/${prospect.item.coopId}/offers?item=${prospect.item.id}&vendor=${prospect.id}`}>
            Start the group buy for {prospect.item.name}
          </Link>
        )}
        {['INTERESTED', 'IN_TALKS'].includes(prospect.status) && (
          <button
            className={primary}
            disabled={busy}
            onClick={() => setConfirmConverted(true)}
          >
            Deal created
          </button>
        )}
        {!['DECLINED', 'UNSUBSCRIBED', 'CONVERTED'].includes(prospect.status) && (
          <button className={quiet} disabled={busy} onClick={() => post(url, { action: 'declined' }, `${prospect.businessName} marked not interested.`)}>Not interested</button>
        )}
        <ConfirmDialog
          request={
            confirmConverted
              ? {
                  title: `Link ${prospect.businessName} to a group buy`,
                  description: 'Group buys started from this page link themselves. Use this for one you set up another way.',
                  confirmLabel: 'Mark as a live deal',
                  reasonLabel: "The group buy's id, from the end of its page address",
                }
              : null
          }
          onClose={() => setConfirmConverted(false)}
          onConfirm={(offerId) => void post(url, { action: 'converted', offerId }, `${prospect.businessName} marked as a live deal.`)}
        />
        {!['UNSUBSCRIBED', 'SKIPPED'].includes(prospect.status) && (
          <button className={danger} disabled={busy} onClick={() => post(url, { action: 'doNotEmail' }, `We won't email ${prospect.businessName}.`)}>Do not email</button>
        )}
      </div>
    </div>
  );
}

function ItemCard({ item, categories, busy, post }: { item: ItemRow; categories: Category[]; busy: boolean; post: Post }) {
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [area, setArea] = useState('');
  const [maxEmails, setMaxEmails] = useState('10');
  const [category, setCategory] = useState(item.categoryKey);
  const url = '/api/admin/outreach/items';
  const keys = { profileId: item.profileId, productId: item.productId };
  const price = item.price;
  const openSearch = item.campaign && ['PROPOSED', 'ACTIVE', 'PAUSED'].includes(item.campaign.status) ? item.campaign : null;
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.03] p-4" aria-label={`Product idea ${item.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Package className="mt-0.5 h-4 w-4 text-emerald-200" />
          <div>
            <p className="font-semibold text-white">{item.name}</p>
            <p className="text-xs text-slate-400">
              {item.brand} · {item.category} · for {item.profileName}{item.coopId ? ` (${item.coopId})` : ' (not linked to a Commons yet)'} · fit {item.fitScore}/100
            </p>
          </div>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200" data-testid="item-status">
          {item.status === 'APPROVED' ? 'Approved' : 'Needs review'}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-300">{item.purpose}</p>
      <p className="mt-1 text-xs text-slate-500">Why it fits: {item.fitReason}</p>
      {price ? (
        <div className="mt-2 text-sm text-slate-200">
          <span className="text-slate-500 line-through">{money(price.regularPriceCents)}</span>{' '}
          <span className="font-semibold text-white">{money(price.bulkShareCents)} each</span> for {price.memberShare} when {price.peopleNeeded} people buy together
          <span className="block text-xs text-slate-500">
            Price from <a className="underline" href={price.sourceUrl} target="_blank" rel="noreferrer">{item.supplierName}</a> on {date(price.observedAt)}
            {price.comparisonUrl ? <> · <a className="underline" href={price.comparisonUrl} target="_blank" rel="noreferrer">regular price</a></> : null}
            {price.expired ? ' · out of date' : ''}
          </span>
          {price.verifiedFacts.length > 0 && <span className="block text-xs text-slate-400">Checked: {price.verifiedFacts.join(' · ')}</span>}
          {price.risks.length > 0 && <span className="block text-xs text-amber-200">Not checked: {price.risks.join(' · ')}</span>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-200">No price yet.</p>
      )}
      {item.suggestion && (
        <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-2 text-xs text-slate-300" data-testid="item-suggestion">
          <p>
            Suggested deal: <span className="font-semibold text-white">{money(item.suggestion.memberPriceCents)}</span> for {item.suggestion.packLabel}
            {' '}(save {item.suggestion.savingsPercent}%), {item.suggestion.membersNeeded} households to unlock.
          </p>
          <p className="text-slate-400">
            Vendor {money(item.suggestion.vendorPayoutCents)} · Commons{' '}
            {money(item.suggestion.commonsCents)} · Cahootz {money(item.suggestion.cahootzCents)}
          </p>
          {!item.suggestion.qualifies && (
            <p className="text-amber-200">Card fees eat most of the savings on this one, so Sage won&apos;t ask about it. You can still find a seller and set the price yourself.</p>
          )}
        </div>
      )}

      {item.status === 'CANDIDATE' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={primary} disabled={busy} onClick={() => post(url, { action: 'review', ...keys, decision: 'approve' }, `${item.name} approved for ${item.profileName}.`)}>
            Approve
          </button>
          <button className={quiet} disabled={busy} onClick={() => post(url, { action: 'review', ...keys, decision: 'reject' }, `${item.name} turned down for ${item.profileName}.`)}>
            Not for this Commons
          </button>
          <button
            className={danger}
            disabled={busy}
            onClick={() => setConfirmEverywhere(true)}
          >
            Turn down everywhere
          </button>
          <ConfirmDialog
            request={confirmEverywhere ? { title: `Turn down ${item.name} for every Commons?`, description: "The bot won't suggest it again.", confirmLabel: 'Turn down everywhere', danger: true } : null}
            onClose={() => setConfirmEverywhere(false)}
            onConfirm={() => void post(url, { action: 'review', ...keys, decision: 'reject', everywhere: true }, `${item.name} turned down everywhere.`)}
          />
        </div>
      )}

      {item.status === 'APPROVED' && item.coopId && (
        openSearch ? (
          <p className="mt-3 text-xs text-emerald-200">Seller search {openSearch.status.toLowerCase()}. See it under Campaigns.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {item.campaign?.endReason && (
              <p className="text-xs text-amber-200 md:col-span-3" data-testid="item-no-sellers">
                The last seller search found no sellers: {NO_SELLERS_SHORT[item.campaign.endReason]} Try again below, maybe with a bigger area.
              </p>
            )}
            <label className="text-xs text-slate-300">
              Search near (city or area)
              <input className={input} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Atlanta, GA" />
            </label>
            <label className="text-xs text-slate-300">
              Most emails to send
              <input className={input} inputMode="numeric" value={maxEmails} onChange={(e) => setMaxEmails(e.target.value)} />
            </label>
            <label className="text-xs text-slate-300">
              Kind of seller
              <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 md:col-span-3">
              <button
                className={primary}
                disabled={busy}
                onClick={() => post(url, { action: 'findSeller', ...keys, area, maxEmails: Number(maxEmails) || undefined, category }, `Sage will look for a seller of ${item.name} within the hour.`)}
              >
                Find a seller
              </button>
              <Link className={quiet} href={`/portal/admin/commons/${item.coopId}/offers?item=${item.productId}`}>
                Already have a seller? Set up the group buy
              </Link>
            </div>
          </div>
        )
      )}
    </div>
  );
}

const PRICING_FIELDS: { key: keyof Pricing; label: string; unit: 'percent' | 'dollars' }[] = [
  { key: 'itemMarginBps', label: 'Share of the savings kept for the Commons and Cahootz', unit: 'percent' },
  { key: 'minShareCents', label: 'Least the Commons and Cahootz each get per unit', unit: 'dollars' },
  { key: 'itemMinOrderCents', label: 'Smallest payment (cheap items come in packs)', unit: 'dollars' },
  { key: 'itemMinSavingsBps', label: 'Members must save at least (percent)', unit: 'percent' },
  { key: 'itemMinSavingsCents', label: 'Members must save at least (dollars)', unit: 'dollars' },
];

/** Platform admins set the Group Buy pricing rules. Every offer, item suggestion and Sage question uses them. */
function PricingSettings({ pricing, busy, post }: { pricing: Pricing; busy: boolean; post: Post }) {
  const toField = (key: keyof Pricing, unit: 'percent' | 'dollars') => (unit === 'percent' ? String(pricing[key] / 100) : (pricing[key] / 100).toFixed(2));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(PRICING_FIELDS.map((f) => [f.key, toField(f.key, f.unit)])));
  return (
    <section className="rounded-[10px] border border-white/10 bg-white/[0.03] p-4" aria-label="Group Buy pricing">
      <p className="font-semibold text-white">Group Buy pricing</p>
      <p className="mt-1 text-xs text-slate-400">
        The vendor gets their amount, Stripe&apos;s fee comes out next, and what&apos;s left is split between the Commons and Cahootz. No deal can be
        saved or published if either one could get less than the minimum, even with a pricier card.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-5">
        {PRICING_FIELDS.map((field) => (
          <label key={field.key} className="text-xs text-slate-300">
            {field.label} ({field.unit === 'percent' ? '%' : '$'})
            <input className={input} inputMode="decimal" value={values[field.key]} onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))} />
          </label>
        ))}
      </div>
      <button
        className={`${primary} mt-3`}
        disabled={busy}
        onClick={() =>
          post(
            '/api/admin/outreach/settings',
            Object.fromEntries(PRICING_FIELDS.map((f) => [f.key, Math.round(Number.parseFloat(values[f.key] || '0') * 100)])),
            'Pricing saved. New suggestions and deals use it now.',
          )
        }
      >
        Save pricing
      </button>
    </section>
  );
}

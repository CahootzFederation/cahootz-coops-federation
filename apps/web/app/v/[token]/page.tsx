'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

interface ReplyPage {
  businessName: string;
  categoryLabel: string;
  area: string | null;
  offerType: 'MEMBER_DEAL' | 'GROUP_BUY';
  answered: 'YES' | 'NOT_NOW' | 'UNSUBSCRIBE' | null;
}

type Interest = 'YES' | 'NOT_NOW' | 'UNSUBSCRIBE';

const DONE: Record<Interest, { title: string; body: string }> = {
  YES: { title: 'Thank you!', body: "Someone from our team will reach out soon to talk it through. There's nothing else you need to do right now." },
  NOT_NOW: { title: 'No problem.', body: "Thanks for letting us know. We won't reach out again for at least six months." },
  UNSUBSCRIBE: { title: "You're unsubscribed.", body: "We won't email you again. Sorry for the bother." },
};

/** Where a business answers an outreach email. No sign-in; the link itself is the key. */
export default function VendorReplyPage() {
  return (
    <Suspense>
      <VendorReply />
    </Suspense>
  );
}

function VendorReply() {
  const { token } = useParams<{ token: string }>();
  const wantsUnsubscribe = useSearchParams().get('unsubscribe') === '1';
  const [page, setPage] = useState<ReplyPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Interest | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ contactName: '', bestContact: '', offerIdea: '' });

  useEffect(() => {
    fetch(`/api/vendor-reply/${token}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This link doesn't work anymore.");
        setPage(data);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This link doesn't work anymore."));
  }, [token]);

  async function answer(interest: Interest) {
    setBusy(true);
    setError(null);
    try {
      const response =
        interest === 'UNSUBSCRIBE'
          ? await fetch(`/api/vendor-reply/${token}/unsubscribe`, { method: 'POST' })
          : await fetch(`/api/vendor-reply/${token}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ interest, ...form }),
            });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That didn't go through. Please try again.");
      setDone(interest);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-[#faf6ef] px-4 py-10 text-[#1f1d1a]">
      <div className="mx-auto max-w-xl rounded-2xl border border-[#e8dfd1] bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#b45309]">Cahootz Commons</p>
        {children}
      </div>
    </main>
  );

  if (error && !page) return shell(<p className="mt-4 text-base">{error}</p>);
  if (!page) return shell(<p className="mt-4 text-base text-[#77706a]">Loading…</p>);

  // An unsubscribe link always offers unsubscribing, unless that's already done.
  const finished = done ?? (wantsUnsubscribe && page.answered !== 'UNSUBSCRIBE' ? null : page.answered);
  if (finished) {
    return shell(
      <>
        <h1 className="mt-3 text-2xl font-bold">{DONE[finished].title}</h1>
        <p className="mt-3 text-base leading-relaxed">{DONE[finished].body}</p>
      </>,
    );
  }

  if (wantsUnsubscribe) {
    return shell(
      <>
        <h1 className="mt-3 text-2xl font-bold">Stop emails to {page.businessName}?</h1>
        <p className="mt-3 text-base leading-relaxed">We&apos;ll take you off our list right away.</p>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <button type="button" disabled={busy} onClick={() => answer('UNSUBSCRIBE')} className="mt-6 w-full rounded-xl bg-[#1f1d1a] px-4 py-3 font-semibold text-white disabled:opacity-60">
          Unsubscribe
        </button>
      </>,
    );
  }

  const input = 'mt-1 w-full rounded-lg border border-[#e8dfd1] px-3 py-2 text-base focus:border-[#b45309] focus:outline-none';
  return shell(
    <>
      <h1 className="mt-3 text-2xl font-bold">Hi {page.businessName}</h1>
      <p className="mt-3 text-base leading-relaxed">
        Households in a community{page.area ? ` near ${page.area}` : ''} want to buy {page.categoryLabel} together, and they&apos;d love
        to buy from a local business like yours.
      </p>

      <h2 className="mt-6 text-lg font-bold">How it works</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-base leading-relaxed">
        {page.offerType === 'GROUP_BUY' ? (
          <li>Members commit to buy together. Once enough commit and you confirm you can fill the order, they pay.</li>
        ) : (
          <li>Members of the community get a member price from you, any time during the deal.</li>
        )}
        <li>You set the member price and how much you get for each item. That amount is yours, with no fees taken out of it.</li>
        <li>Members pay through Cahootz Commons, and we send your amount to your account.</li>
        <li>Nobody pays anything until an order is confirmed with you, and you can say no to any order you can&apos;t fill.</li>
      </ul>

      <h2 className="mt-6 text-lg font-bold">Interested?</h2>
      <p className="mt-1 text-sm text-[#77706a]">Tell us how to reach you and we&apos;ll set up a quick call. No commitment.</p>
      <label className="mt-3 block text-sm font-semibold">
        Your name
        <input className={input} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
      </label>
      <label className="mt-3 block text-sm font-semibold">
        Best phone or email
        <input className={input} value={form.bestContact} onChange={(e) => setForm({ ...form, bestContact: e.target.value })} />
      </label>
      <label className="mt-3 block text-sm font-semibold">
        Anything you&apos;d like to offer? (optional)
        <textarea className={input} rows={3} value={form.offerIdea} onChange={(e) => setForm({ ...form, offerIdea: e.target.value })} />
      </label>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => answer('YES')} className="mt-5 w-full rounded-xl bg-[#b45309] px-4 py-3 font-semibold text-white disabled:opacity-60">
        Yes, I&apos;m interested
      </button>
      <button type="button" disabled={busy} onClick={() => answer('NOT_NOW')} className="mt-3 w-full rounded-xl border border-[#e8dfd1] px-4 py-3 font-semibold disabled:opacity-60">
        Not right now
      </button>
      <button type="button" disabled={busy} onClick={() => answer('UNSUBSCRIBE')} className="mt-4 w-full text-sm text-[#77706a] underline">
        Don&apos;t email me again
      </button>
    </>,
  );
}

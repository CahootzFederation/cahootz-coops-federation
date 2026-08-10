import type { Metadata } from "next";
import { ArrowLeft, Mail, MessageCircle, Send } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ContactForm } from "@/components/contact-form";

export const metadata: Metadata = {
  title: "Contact Cahootz",
  description:
    "Reach the Cahootz team about commons launches, business partnerships, support, or community-owned economy tools.",
  alternates: {
    canonical: "https://cahootz.coop/contact",
  },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[#111111] text-white">
      <header className="border-b border-white/10 bg-[#111111]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/cahootz-coops-eggs.svg"
              alt=""
              width={48}
              height={40}
              className="h-10 w-12 object-contain"
              priority
            />
            <div className="flex flex-col">
              <span className="text-xl font-bold leading-tight tracking-tight">Cahootz</span>
              <span className="text-xs leading-tight text-slate-400">Commons network</span>
            </div>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b border-white/10 px-5 py-16 sm:px-6 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-[#f0975b]/30 bg-[#f0975b]/10 px-3 py-1.5 text-sm font-medium text-[#ffb36f]">
                <MessageCircle className="h-4 w-4" />
                Talk with Cahootz
              </div>
              <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.04] tracking-tight md:text-6xl">
                Bring us the thing you are trying to coordinate.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Questions about launching a commons, bringing in businesses, member support,
                partnerships, or the product itself all land with the team.
              </p>

              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-lg border border-white/10 bg-[#1b1b1b] p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f0975b]/15 text-[#ffb36f]">
                    <Mail className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-bold">Email delivery</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Every message is sent to team@cahootzcoops.com.
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-[#1b1b1b] p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f0975b]/15 text-[#ffb36f]">
                    <Send className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-bold">Team alert</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    The same details are posted to Slack so the right person can follow up.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#171717] p-5 shadow-2xl shadow-black/30 sm:p-7">
              <ContactForm />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

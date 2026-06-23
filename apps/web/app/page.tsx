import type { Metadata } from "next";
import type React from "react";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  Globe,
  Landmark,
  MessageSquare,
  Newspaper,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
  Vote,
  Wallet,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { Suspense } from "react";

import { BusinessSignupForm } from "@/components/business-signup-form";
import { BlogCard } from "@/components/blog/blog-card";
import { MemberApplicationFlow } from "@/components/member-application-flow";
import { TreasuryContributionCalculator } from "@/components/treasury-contribution-calculator";
import { WaitlistSignupForm } from "@/components/waitlist-signup-form";
import { env } from "@/env";
import { getFeaturedBlogPosts } from "@/lib/blog";

interface CoopOption {
  coopId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  isLive: boolean;
  hasPublishedPublicPage: boolean;
}

async function getActiveCoops(): Promise<CoopOption[]> {
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const response = await fetch(`${apiUrl}/trpc/coopConfig.listActiveCoops`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.result.data as CoopOption[];
  } catch {
    return [];
  }
}

const CARD_GRADIENTS = [
  "from-[#f0975b]/25 to-[#0f766e]/20",
  "from-[#22c55e]/20 to-[#0ea5e9]/15",
  "from-[#ef4444]/20 to-[#f0975b]/20",
  "from-[#14b8a6]/20 to-[#64748b]/20",
  "from-[#ffb36f]/20 to-[#dc2626]/20",
];

export const metadata: Metadata = {
  title: "Cahootz | The App for Community-Owned Economies",
  description:
    "Join a co-op, support local businesses, earn participation rewards, vote on proposals, and fund the tools your community needs.",
  alternates: {
    canonical: "https://cahootz.coop",
  },
};

const proofPoints = [
  {
    icon: <Store className="h-5 w-5" />,
    value: "Shop local",
    label: "Find businesses in your co-op network and keep spending close to home.",
  },
  {
    icon: <Vote className="h-5 w-5" />,
    value: "Vote on proposals",
    label: "Help decide which projects, businesses, and community needs get funded.",
  },
  {
    icon: <Landmark className="h-5 w-5" />,
    value: "Fund new tools",
    label: "Use proposals to back vendors, features, and projects members actually need.",
  },
];

interface Feature {
  icon: React.ReactNode;
  label: string;
  title: string;
  description: string;
  status: "live" | "coming-soon";
}

const features: Feature[] = [
  {
    icon: <Smartphone className="h-6 w-6" />,
    label: "Member App",
    title: "Your co-op in your pocket",
    description:
      "Join a network, see activity, manage your profile, and stay connected to the people and businesses building with you.",
    status: "live",
  },
  {
    icon: <Store className="h-6 w-6" />,
    label: "Local Commerce",
    title: "Spend where it comes back",
    description:
      "Discover community businesses, buy from the network, and turn everyday transactions into shared momentum.",
    status: "live",
  },
  {
    icon: <Vote className="h-6 w-6" />,
    label: "Governance",
    title: "Real decisions, not suggestion boxes",
    description:
      "Submit proposals, discuss tradeoffs, vote, and see why decisions were approved or rejected.",
    status: "live",
  },
  {
    icon: <Wallet className="h-6 w-6" />,
    label: "SoulCoin & Rewards",
    title: "Membership people can verify",
    description:
      "SoulCoin represents co-op membership, reputation, and governance rights without tying the page to one specific co-op token.",
    status: "live",
  },
  {
    icon: <Globe className="h-6 w-6" />,
    label: "Public Co-op Pages",
    title: "A front door people can share",
    description:
      "Each co-op can publish its mission, stores, products, and join path so neighbors know where to plug in.",
    status: "live",
  },
  {
    icon: <Zap className="h-6 w-6" />,
    label: "Vendor Roadmap",
    title: "Fund features like a startup",
    description:
      "Members can approve budgets for vendors to build new tools, integrations, pages, and workflows the co-op needs next.",
    status: "coming-soon",
  },
];

const memberBenefits = [
  "Find co-op businesses and community activity in one place",
  "Earn rewards for spending and participating in the network",
  "Vote on proposals that can fund real local projects and new features",
  "Follow decisions, treasury activity, and member updates",
  "Help grow a system built for ownership instead of extraction",
];

const businessBenefits = [
  "Reach members already looking for local places to support",
  "Accept community-powered payments and rewards",
  "Show up on your co-op's public page and marketplace",
  "Build customer loyalty around ownership, not coupons",
  "Request support or paid feature work through transparent member proposals",
];

const faqs = [
  {
    q: "What does Cahootz actually do?",
    a: "Cahootz is the app layer for a cooperative economy. Members use it to join a co-op, find local businesses, earn participation rewards, submit and vote on proposals, and help fund the tools, vendors, and shared resources the co-op needs.",
  },
  {
    q: "Is this just a loyalty app?",
    a: "No. Rewards are only one part. The important difference is that the network also has membership, governance, a shared treasury, public co-op pages, and a way for members to fund vendors who can build useful features for the co-op.",
  },
  {
    q: "What is SoulCoin?",
    a: "SoulCoin is the membership and governance token model for a co-op. Each co-op can use its own SoulCoin to represent membership, reputation, and voting rights.",
  },
  {
    q: "Can a co-op fund new software or services?",
    a: "Yes. A co-op can use proposals to define what it needs, vote on the budget, and hire vendors to build features, integrations, public pages, internal tools, events, or services that help the co-op grow like a member-owned startup.",
  },
  {
    q: "Does AI control the money?",
    a: "No. The AI helps evaluate proposals against rules the co-op sets. Members still define the rules, change the rules, and make the governing decisions.",
  },
  {
    q: "Why would a business join?",
    a: "A business gets discovered by people who want to buy local, can build loyalty around a larger mission, and can request community support through proposals instead of relying only on banks or ads.",
  },
  {
    q: "How do I start?",
    a: "Join the waitlist as a member or add your business. If your co-op is already live, you can visit its public page and start there.",
  },
];

export default async function HomePage() {
  const coops = await getActiveCoops();
  const featuredPosts = getFeaturedBlogPosts(3);

  return (
    <div className="min-h-screen bg-[#111111] text-white">
      
      <Script
        async
        src="https://www.usetina.com/tina.js"
        data-site-key="tina_dCbAoHEO1ISRi3XI_Hg9MG_Y"
        strategy="afterInteractive"
      />
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#111111]/90 backdrop-blur">
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
              <span className="text-xs leading-tight text-slate-400">Cooperative network</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm md:flex">
            <Link href="#how-it-works" className="text-slate-400 transition hover:text-white">
              How it works
            </Link>
            <Link href="#features" className="text-slate-400 transition hover:text-white">
              Features
            </Link>
            <Link href="/blog" className="text-slate-400 transition hover:text-white">
              Blog
            </Link>
            <Link href="#join" className="text-slate-400 transition hover:text-white">
              Join
            </Link>
          </nav>

          <a
            href="#join"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#111111] transition hover:bg-[#f0975b]"
          >
            Apply now
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </header>

      <main>
        <section
          className="relative overflow-hidden border-b border-white/10 px-5 py-16 sm:px-6 md:py-24"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 12%, rgba(245,158,11,0.16), transparent 34%), radial-gradient(circle at 88% 8%, rgba(20,184,166,0.12), transparent 30%), linear-gradient(135deg, #111111 0%, #161616 48%, #0f1413 100%)",
          }}
        >
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-[#f0975b]/30 bg-[#f0975b]/10 px-3 py-1.5 text-sm font-medium text-[#ffb36f]">
                <Zap className="h-4 w-4" />
                For groups that want to keep more of what they build
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.03] tracking-tight sm:text-6xl md:text-7xl">
                One place to spend together, earn more, and own what you build.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200 md:text-xl">
              Bring your people into one system where you can organize what you’re doing, make decisions together, and fund what comes next.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="#join"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#f0975b] px-5 py-3 text-base font-semibold text-[#111111] transition hover:bg-[#ffb36f]"
                >
                  Join the community
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <Link
                  href="#business-form"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-5 py-3 text-base font-semibold transition hover:bg-white/10"
                >
                  Add your business
                </Link>
              </div>
            </div>

            <div className="mx-auto w-full max-w-md lg:ml-auto">
              <div className="rounded-lg border border-white/15 bg-[#181818]/95 p-4 shadow-2xl shadow-black/40">
                <div className="rounded-lg border border-[#f0975b]/25 bg-[#121212] p-4 text-white">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-[#ffb36f]">Today in your co-op</p>
                      <h2 className="mt-1 text-xl font-black">Artist Co-op</h2>
                    </div>
                    <div className="rounded-lg bg-[#f0975b] px-3 py-1 text-xs font-bold text-[#111111]">LIVE</div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      ["12", "Projects"],
                      ["7", "Studios"],
                      ["420", "Members"],
                    ].map(([value, label]) => (
                      <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-center">
                        <p className="text-2xl font-black">{value}</p>
                        <p className="mt-1 text-[11px] font-medium text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 space-y-3">
                    {[
                      {
                        icon: <Store className="h-4 w-4" />,
                        title: "Book a member studio day",
                        detail: "Use shared space, tools, and production support.",
                      },
                      {
                        icon: <MessageSquare className="h-4 w-4" />,
                        title: "Vote on the equipment library",
                        detail: "Members are choosing what tools get funded next.",
                      },
                      {
                        icon: <ShieldCheck className="h-4 w-4" />,
                        title: "Local distribution route approved",
                        detail: "More member work can reach shops, events, and buyers.",
                      },
                    ].map((item) => (
                      <div key={item.title} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f0975b]/15 text-[#ffb36f]">
                          {item.icon}
                        </div>
                        <div>
                          <p className="text-sm font-bold">{item.title}</p>
                          <p className="mt-0.5 text-xs leading-5 text-slate-400">{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-b border-white/10 bg-[#161616] px-5 py-14 text-white sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-4 md:grid-cols-3">
              {proofPoints.map((point) => (
                <div key={point.value} className="rounded-lg border border-white/10 bg-[#111111] p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f0975b]/15 text-[#ffb36f]">
                    {point.icon}
                  </div>
                  <h2 className="mt-5 text-2xl font-black">{point.value}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{point.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="px-5 py-20 sm:px-6 md:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-widest text-[#ffb36f]">What people use it for</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
                One app for the work a co-op already has to do.
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-400">
                Cahootz is where members, businesses, proposals, purchases, and public
                trust all meet, so people can move from interest to action quickly.
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <div key={feature.label} className="rounded-lg border border-white/10 bg-[#1b1b1b] p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#f0975b]/10 text-[#ffb36f]">
                      {feature.icon}
                    </div>
                    {feature.status === "coming-soon" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-xs font-medium text-slate-400">
                        <Clock className="h-3 w-3" />
                        Soon
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                        <BadgeCheck className="h-3 w-3" />
                        Live
                      </span>
                    )}
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-widest text-slate-500">{feature.label}</p>
                  <h3 className="mt-2 text-lg font-bold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-[#1b1b1b] px-5 py-20 sm:px-6 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-[#ffb36f]">Why it matters</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
                The money loop is the message.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-400">
                Right now, you do the work, bring the customers, and someone else owns the system.
                Cahootz is designed so the activity of the network strengthens the network:
                members support businesses, businesses serve members, and the co-op treasury
                funds vendors, tools, and projects the community can see and govern.
              </p>
              <Link
                href="#join"
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 font-semibold text-[#111111] transition hover:bg-[#f0975b]"
              >
                Submit an application
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["1", "Join", "Members join a co-op and get a clear place to participate."],
                ["2", "Spend", "Local purchases and business activity happen inside the network."],
                ["3", "Decide", "Members propose, debate, and vote on what should be funded."],
                ["4", "Build", "The treasury can pay vendors to ship features, services, and projects."],
              ].map(([step, title, body]) => (
                <div key={step} className="rounded-lg border border-white/10 bg-[#111111] p-6">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f0975b] text-sm font-black text-[#111111]">
                    {step}
                  </div>
                  <h3 className="mt-5 text-xl font-black">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="governance" className="px-5 py-20 sm:px-6 md:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-lg border border-[#f0975b]/30 bg-[#f0975b]/10 px-3 py-1.5 text-sm font-medium text-[#ffb36f]">
                  <Vote className="h-4 w-4" />
                  Member-led governance
                </div>
                <h2 className="mt-5 text-3xl font-black tracking-tight md:text-5xl">
                  You write the rules. The AI follows them.
                </h2>
                <p className="mt-5 text-lg leading-8 text-slate-400">
                  AI helps screen proposals against the co-op's charter, budget, and reserve
                  rules. It does not replace members. It makes the reasoning visible so people
                  can make better decisions faster.
                </p>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#1b1b1b] p-6">
                <h3 className="text-lg font-bold">What members can do</h3>
                <ul className="mt-6 space-y-4">
                  {[
                    "Submit funding proposals with budget and impact details",
                    "Comment before a vote so objections are visible early",
                    "Hire vendors to build member-approved tools and services",
                    "Vote according to the co-op's membership rules",
                    "Review AI scoring, charter alignment, and decision history",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <Check className="mt-1 h-5 w-5 shrink-0 text-[#ffb36f]" />
                      <span className="text-slate-300">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-[#161616] px-5 py-20 text-white sm:px-6 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#111111] p-7">
              <div className="inline-flex items-center gap-2 rounded-lg border border-[#f0975b]/20 bg-[#f0975b]/10 px-3 py-1.5 text-sm font-bold text-[#ffb36f]">
                <Users className="h-4 w-4" />
                For Members
              </div>
              <h2 className="mt-5 text-3xl font-black">Use the app to help build what you want to live in.</h2>
              <ul className="mt-8 space-y-4">
                {memberBenefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3">
                    <Check className="mt-1 h-5 w-5 shrink-0 text-[#ffb36f]" />
                    <span className="text-slate-300">{benefit}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#join"
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#f0975b] px-5 py-3 font-semibold text-[#111111] transition hover:bg-[#ffb36f]"
              >
                Submit an application
                <ArrowRight className="h-5 w-5" />
              </a>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#111111] p-7">
              <div className="inline-flex items-center gap-2 rounded-lg border border-[#f0975b]/20 bg-[#f0975b]/10 px-3 py-1.5 text-sm font-bold text-[#ffb36f]">
                <Store className="h-4 w-4" />
                For Businesses
              </div>
              <h2 className="mt-5 text-3xl font-black">Turn customers into a community that comes back.</h2>
              <ul className="mt-8 space-y-4">
                {businessBenefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3">
                    <Check className="mt-1 h-5 w-5 shrink-0 text-[#ffb36f]" />
                    <span className="text-slate-300">{benefit}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="#business-form"
                className="mt-8 inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-3 font-semibold transition hover:bg-white/10"
              >
                Apply as a business
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </section>

        {coops.length > 0 && (
          <section className="border-b border-white/10 bg-[#1b1b1b] px-5 py-20 sm:px-6 md:py-24">
            <div className="mx-auto max-w-7xl">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                <div>
                  <p className="text-sm font-bold uppercase tracking-widest text-[#ffb36f]">Active networks</p>
                  <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Visit a live co-op.</h2>
                </div>
                <p className="max-w-xl text-slate-400">
                  Apply to join any active co-op. When a co-op has published its public page,
                  you can also visit its marketplace.
                </p>
              </div>

              <div className="mt-10 grid gap-4 md:grid-cols-3">
                {coops.map((coop, i) => (
                  <article
                    key={coop.coopId}
                    className="group overflow-hidden rounded-lg border border-white/10 bg-[#111111] transition hover:-translate-y-0.5 hover:border-[#f0975b]/50"
                  >
                    <div className={`h-36 bg-gradient-to-br ${CARD_GRADIENTS[i % CARD_GRADIENTS.length]}`} />
                    <div className="p-5">
                      <h3 className="text-lg font-bold group-hover:text-[#ffb36f]">{coop.name}</h3>
                      {coop.tagline && <p className="mt-1 text-sm text-slate-400">{coop.tagline}</p>}
                      {coop.description && (
                        <p className="mt-3 line-clamp-4 text-xs leading-6 text-slate-500">{coop.description}</p>
                      )}
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row md:flex-col xl:flex-row">
                        <Link
                          href={`/${coop.coopId}/application`}
                          className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md bg-[#f0975b] px-4 py-2 text-sm font-bold text-[#111111] transition hover:bg-[#ffb36f]"
                        >
                          Apply
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                        {coop.hasPublishedPublicPage && (
                          <Link
                            href={`/c/${coop.coopId}`}
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white transition hover:border-[#f0975b]/60 hover:bg-white/10"
                          >
                            Marketplace
                            <Store className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {featuredPosts.length > 0 && (
          <section id="blog" className="border-b border-white/10 bg-[#161616] px-5 py-20 sm:px-6 md:py-24">
            <div className="mx-auto max-w-7xl">
              <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-lg border border-[#f0975b]/30 bg-[#f0975b]/10 px-3 py-1.5 text-sm font-medium text-[#ffb36f]">
                    <Newspaper className="h-4 w-4" />
                    Latest from the blog
                  </div>
                  <h2 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">
                    Notes from the work of building Cahootz.
                  </h2>
                  <p className="mt-4 text-lg leading-8 text-slate-400">
                    Product updates, co-op playbooks, and practical thinking about
                    community-owned economies. Draft in Notion, publish on the site.
                  </p>
                </div>

                <Link
                  href="/blog"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 py-3 font-semibold transition hover:border-[#f0975b]/60 hover:bg-white/10"
                >
                  View all posts
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </div>

              <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {featuredPosts.map((post, index) => (
                  <BlogCard key={post.slug} post={post} priority={index === 0} />
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="px-5 py-20 sm:px-6 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.7fr_1fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-[#ffb36f]">Real talk</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Questions people ask before they join.</h2>
            </div>

            <div className="space-y-4">
              {faqs.map(({ q, a }) => (
                <div key={q} className="rounded-lg border border-white/10 bg-[#1b1b1b] p-6">
                  <h3 className="text-lg font-bold">{q}</h3>
                  <p className="mt-3 leading-7 text-slate-400">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <TreasuryContributionCalculator />

        <section id="join" className="border-t border-white/10 bg-[#f0975b] px-5 py-20 text-[#111111] sm:px-6 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 xl:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="text-sm font-black uppercase tracking-widest text-[#111111]/70">Join Cahootz</p>
              <h2 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
                Apply to a co-op from the website.
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#111111]/75">
                Pick a live co-op, answer the questions that community configured,
                and get a real application reference for your records. If your co-op
                is not live yet, the waitlist can capture the one you want to create.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                {[
                  "Choose a co-op",
                  "Answer its questions",
                  "Submit for review",
                ].map((step) => (
                  <div key={step} className="rounded-lg border border-[#111111]/10 bg-white/30 p-4">
                    <p className="text-sm font-black uppercase tracking-widest text-[#111111]/60">
                      {step}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <Suspense fallback={<div className="h-[36rem] animate-pulse rounded-lg bg-white/40" />}>
                <MemberApplicationFlow />
              </Suspense>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-lg border border-[#111111]/10 bg-white/35 p-6">
                  <h3 className="text-2xl font-black">Not seeing your co-op?</h3>
                  <p className="mt-2 text-sm leading-6 text-[#111111]/70">
                    Join the list and tell us the co-op you want to join or create next.
                  </p>
                  <div className="mt-5">
                    <Suspense fallback={<div className="h-80 animate-pulse rounded-lg bg-white/30" />}>
                      <WaitlistSignupForm coops={coops} />
                    </Suspense>
                  </div>
                </div>

                <div id="business-form">
                  <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-white/30" />}>
                    <BusinessSignupForm coops={coops} />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#111111] px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 md:flex-row">
          <div className="flex items-center gap-3">
            <Image
              src="/cahootz-coops-mark.svg"
              alt=""
              width={44}
              height={36}
              className="h-9 w-11 object-contain"
            />
            <span className="font-bold">Cahootz</span>
          </div>
          <p className="text-center text-sm text-slate-400 md:text-right">
            The community platform for co-ops that want local spending, governance, and ownership in one loop.
          </p>
        </div>
      </footer>
    </div>
  );
}

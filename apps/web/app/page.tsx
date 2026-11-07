import type { CommonsCatalog } from "@/components/group-buy-product-calculator";
import type { Metadata } from "next";
import type { OfferPricingSettings } from "@repo/validators/marketplace-offers";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { BusinessSignupForm } from "@/components/business-signup-form";
import { GroupBuyProductCalculator } from "@/components/group-buy-product-calculator";
import { SharedPurchaseCalculator } from "@/components/shared-purchase-calculator";
import { WaitlistSignupForm } from "@/components/waitlist-signup-form";
import { env } from "@/env";
import { MEMBER_APP_STORE_URL } from "@/lib/member-app";
import {
  DEFAULT_OFFER_PRICING,
  OFFER_PRICING_LIMITS,
} from "@repo/validators/marketplace-offers";
import { ArrowDownRight, ArrowRight, Github, MoveUpRight } from "lucide-react";

import "./landing.css";
import "./group-buy-homepage.css";

interface CoopOption {
  coopId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  isLive: boolean;
  hasPublishedPublicPage: boolean;
}

// Every API call on this page gives up after 3 seconds, so a slow or missing API
// shows an empty list or the sample products instead of holding up the page.
async function getActiveCoops(): Promise<CoopOption[]> {
  try {
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/trpc/coopConfig.listActiveCoops`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.result.data as CoopOption[];
  } catch {
    return [];
  }
}

async function getHomepageProductCatalogs(): Promise<CommonsCatalog[]> {
  try {
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/trpc/productDiscovery.homepageCatalogs`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as { result?: { data?: unknown } };
    return Array.isArray(data.result?.data)
      ? (data.result.data as CommonsCatalog[])
      : [];
  } catch {
    return [];
  }
}

/**
 * The Group Buy pricing rules a platform admin set, so the homepage matches
 * real offers. Falls back to the defaults when there's no API (as in CI builds)
 * or it doesn't answer within 3 seconds, so it can never hold up the page.
 */
async function getHomepagePricing(): Promise<OfferPricingSettings> {
  if (!env.NEXT_PUBLIC_API_URL) return DEFAULT_OFFER_PRICING;
  try {
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/trpc/productDiscovery.homepagePricing`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return DEFAULT_OFFER_PRICING;
    const data = (await response.json()) as {
      result?: { data?: Partial<Record<keyof OfferPricingSettings, unknown>> };
    };
    const received = data.result?.data ?? {};
    // Keep only whole numbers inside the allowed range; anything else uses the default.
    return Object.fromEntries(
      (Object.keys(DEFAULT_OFFER_PRICING) as (keyof OfferPricingSettings)[]).map((key) => {
        const value = received[key];
        const { min, max } = OFFER_PRICING_LIMITS[key];
        return [
          key,
          typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
            ? value
            : DEFAULT_OFFER_PRICING[key],
        ];
      }),
    ) as unknown as OfferPricingSettings;
  } catch {
    return DEFAULT_OFFER_PRICING;
  }
}

const DESCRIPTION =
  "Cahootz turns your neighborhood, family, church, or club into a street you can walk. Help each other out, buy together for better prices, keep your money close to home, and decide together what comes next.";

export const metadata: Metadata = {
  title: "Cahootz | Your people, on one street",
  description: DESCRIPTION,
  alternates: { canonical: "https://cahootzcommons.com" },
  openGraph: {
    title: "Cahootz | Your people, on one street",
    description: DESCRIPTION,
    url: "https://cahootzcommons.com",
    siteName: "Cahootz",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cahootz | Your people, on one street",
    description: DESCRIPTION,
  },
};

const GITHUB_REPOSITORY_URL =
  "https://github.com/CahootzFederation/cahootz-coops-federation";

const features = [
  {
    id: "group-deals",
    label: "Group deals",
    title: "Buy together. Pay less.",
    body: "Sage notices what lots of your neighbors already buy, like coffee or diapers, and finds a seller who'll give you a better price. When enough people join, everyone saves, and a share goes back to your commons.",
    points: [
      "You see the price, what you save, and what your commons gets before you join.",
      "You're only charged if the deal hits its goal.",
    ],
    screen: {
      src: "/app-screens/group-deal.webp",
      alt: "A group deal for a 2 lb bag of coffee: $24 instead of $34, with 5 of 10 neighbors committed",
    },
  },
  {
    id: "sage",
    label: "Sage, your community guide",
    title: "Ask once. Sage finds who can help.",
    body: "Need a ride, a tutor, or a hand moving? Good at something your neighbors need? Tell Sage. It matches people who can help each other, makes the intro, and thanks the helpers by name.",
    points: [
      "Sage turns your commons' goals into ideas and puts them up for a vote.",
      "Sage connects people. Your commons makes the calls.",
    ],
    screen: {
      src: "/app-screens/sage-chat.webp",
      alt: "A chat where Sage introduces a parent to a neighbor who tutors algebra",
    },
  },
];

const extras = [
  {
    title: "Your street",
    body: "Every member gets a house. Make it yours, see who's out, and step into Circle Hall to find your circles.",
  },
  {
    title: "Keep your money close to home",
    body: "Link your bank if you want to and see where your money leaves your community. Only you and Sage see your spending. Your commons only sees totals with no names.",
  },
  {
    title: "Earn your commons' coin",
    body: "Every commons has its own coin, with a name it picks. Earn it when you shop at member businesses, and spend it inside your commons.",
  },
  {
    title: "Decide together",
    body: "Anyone can put an idea up for a vote. When it passes, it takes effect on its own. No one person holds the keys.",
  },
  {
    title: "Families",
    body: "A private commons just for your family. Share news, plan get-togethers, and look out for each other without the group chat chaos.",
  },
  {
    title: "Community Board",
    body: "Post an ask, an offer, or good news where everyone in your commons will see it.",
  },
];

const faqs = [
  {
    q: "What is a commons?",
    a: "A commons is your community on Cahootz: a neighborhood, a family, a congregation, a club, or a co-op. Each one sets its own rules.",
  },
  {
    q: "How do I join?",
    a: "Get an invite from someone who's already in, then download the app and sign in. No invite yet? Join the waitlist below and we'll email you when your commons opens up.",
  },
  {
    q: "Is there an Android app?",
    a: "Not yet. Cahootz Commons is on iPhone today, and we're getting the Android app ready now. Join the waitlist and we'll tell you when it's out.",
  },
  {
    q: "Is all of this in the app today?",
    a: "Most of it. The street, circles, families, Sage, and group deals are in the iPhone app now. We're still building the rest, like linking your bank. Join the waitlist and we'll tell you as new pieces arrive.",
  },
  {
    q: "How do group deals work?",
    a: "Your commons picks something lots of people already buy. When enough people join, everyone gets the lower price. You save your card when you join, and you're only charged if the deal reaches its goal. Each deal shows the price, what you save, and the share that goes to your commons before you join.",
  },
  {
    q: "Who is Sage, and does it make decisions for us?",
    a: "Sage is the AI community guide built into every commons. It connects people who can help each other and keeps good ideas moving. It can handle small things inside limits your commons sets, but bigger decisions go to a member vote.",
  },
  {
    q: "Do I need to own a business to join?",
    a: "No. Most members just want to stay close to their people. If you do run a business, or you'd like to offer a group deal, use the business form below.",
  },
];

function PhoneScreen({
  src,
  alt,
  priority = false,
  sizes,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  sizes: string;
}) {
  return (
    <div className="phone-frame">
      <Image
        src={src}
        alt={alt}
        width={780}
        height={1688}
        sizes={sizes}
        priority={priority}
      />
    </div>
  );
}

export default async function HomePage() {
  const [coops, productCatalogs, pricing] = await Promise.all([
    getActiveCoops(),
    getHomepageProductCatalogs(),
    getHomepagePricing(),
  ]);
  const shownCatalogs = productCatalogs.length > 0 ? productCatalogs : undefined;

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-shell header-inner">
          <Link href="/" className="brand" aria-label="Cahootz home">
            <Image
              src="/cahootz-coops-mark.svg"
              alt=""
              width={46}
              height={40}
              priority
            />
            <span>Cahootz</span>
          </Link>
          <nav aria-label="Main navigation" className="header-nav">
            <a href="#what-you-can-do">What you can do</a>
            <a href="#get-in">How to get in</a>
            <a href="#questions">Questions</a>
            <Link href="/blog">Blog</Link>
          </nav>
          <a className="header-action" href="#join">
            Join the waitlist <ArrowRight size={16} />
          </a>
        </div>
      </header>

      <main>
        <section className="hero street-hero" aria-labelledby="hero-title">
          <div className="landing-shell street-hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">Cahootz Commons · free on iPhone</p>
              <h1 id="hero-title">
                Your people, all on <span>one street.</span>
              </h1>
              <p className="hero-description">
                Cahootz turns your neighborhood, family, church, or club into a
                street you can walk. Help each other out, buy together for
                better prices, and decide together what comes next.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href="#join">
                  Join the waitlist <ArrowDownRight size={18} />
                </a>
                <a
                  className="button button-secondary"
                  href={MEMBER_APP_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Have an invite? Get the iPhone app <MoveUpRight size={18} />
                </a>
              </div>
              <p className="hero-note">
                Commons open by invite. The waitlist is how you get one.
              </p>
            </div>
            <figure className="street-hero-phone">
              <PhoneScreen
                src="/app-screens/street.webp"
                alt="The Commons tab: a walkable street with each member's house, neighbors strolling, and the Community Board in the middle"
                sizes="(max-width: 700px) 78vw, 360px"
                priority
              />
              <figcaption>
                A sample commons with made-up neighbors.
              </figcaption>
            </figure>
          </div>
        </section>

        <section
          className="features-section"
          id="what-you-can-do"
          aria-labelledby="features-title"
        >
          <div className="landing-shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">What you can do</p>
                <h2 id="features-title">Everything your people need, together.</h2>
              </div>
              <p>
                Look out for each other, save money together, and build
                something that belongs to all of you.
              </p>
            </div>

            {features.map((feature, index) => (
              <article
                className={`feature-row${index % 2 === 1 ? " feature-row-flip" : ""}`}
                id={feature.id}
                key={feature.id}
              >
                <div className="feature-copy">
                  <p className="eyebrow">{feature.label}</p>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                  <ul>
                    {feature.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
                <div className="feature-phone">
                  <PhoneScreen
                    src={feature.screen.src}
                    alt={feature.screen.alt}
                    sizes="(max-width: 700px) 70vw, 300px"
                  />
                </div>
              </article>
            ))}

            <ul className="feature-extras" aria-label="More in your commons">
              {extras.map((extra) => (
                <li key={extra.title}>
                  <strong>{extra.title}</strong>
                  <p>{extra.body}</p>
                </li>
              ))}
            </ul>

            <details className="treasury-disclosure deal-math" id="deal-math">
              <summary>See the savings math on real products</summary>
              <p className="deal-math-intro">
                Pick a commons and a product to see what you&apos;d pay, what
                you&apos;d save, how many people it takes, and what goes back to
                the commons.
              </p>
              <GroupBuyProductCalculator
                catalogs={shownCatalogs}
                pricing={pricing}
              />
              <SharedPurchaseCalculator
                catalogs={shownCatalogs}
                pricing={pricing}
              />
            </details>
          </div>
        </section>

        <section className="get-in-section" id="get-in">
          <div className="landing-shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">How to get in</p>
                <h2>Three steps to your people.</h2>
              </div>
              <p>
                Commons grow through people who already know each other.
                Members and guides can invite you directly.
              </p>
            </div>
            <ol className="get-in-steps">
              <li>
                <span>01</span>
                <strong>Get an invite.</strong>
                <p>
                  A member or guide invites you. No invite yet? Join the
                  waitlist for a commons below.
                </p>
              </li>
              <li>
                <span>02</span>
                <strong>Download the app.</strong>
                <p>
                  Get the free Cahootz Commons app on your iPhone and sign
                  in.
                </p>
                <a
                  className="text-link"
                  href={MEMBER_APP_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get it on the App Store <MoveUpRight size={16} />
                </a>
              </li>
              <li>
                <span>03</span>
                <strong>Walk your street.</strong>
                <p>
                  Your commons, its circles, and Sage are waiting. Say hello.
                </p>
              </li>
            </ol>

            <div className="find-commons" id="find-a-commons">
              <h3>Find a commons to join.</h3>
              <p>
                Pick the one that feels like yours and join its waitlist.
                We&apos;ll let you know when it opens up.
              </p>
              {coops.length > 0 ? (
                <div className="commons-list">
                  {coops.map((coop) => (
                    <article className="commons-row" key={coop.coopId}>
                      <div className="commons-row-mark" aria-hidden="true">
                        ✳
                      </div>
                      <div>
                        <h4>{coop.name}</h4>
                        <p>
                          {coop.tagline ||
                            coop.description ||
                            "Explore this commons and its community."}
                        </p>
                      </div>
                      <div className="commons-row-actions">
                        <Link
                          href={`/?commons=${encodeURIComponent(coop.coopId)}#join`}
                          aria-label={`Join the waitlist for ${coop.name}`}
                        >
                          Join the waitlist <ArrowRight size={17} />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="commons-empty">
                  Don&apos;t see your community?{" "}
                  <a href="#join">
                    Tell us where you want to start one <ArrowRight size={16} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="faq-section" id="questions">
          <div className="landing-shell faq-inner">
            <div>
              <p className="eyebrow">A few questions</p>
              <h2>Good to know before you join.</h2>
            </div>
            <div className="faq-list">
              {faqs.map(({ q, a }) => (
                <details key={q}>
                  <summary>
                    {q}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="join-section" id="join">
          <div className="landing-shell join-inner">
            <div className="join-intro">
              <p className="eyebrow">Your next step</p>
              <h2>There&apos;s a place for you in this.</h2>
              <p>
                We&apos;re letting people in a few at a time. Join the
                waitlist and tell us which commons you&apos;re interested in.
                If yours isn&apos;t listed yet, tell us where you want to start
                one.
              </p>
            </div>
            <div className="join-forms">
              <div className="waitlist-panel" id="waitlist">
                <h3>Join the waitlist</h3>
                <p>It takes a minute.</p>
                <Suspense fallback={<div className="form-loading" />}>
                  <WaitlistSignupForm coops={coops} />
                </Suspense>
              </div>
              <div className="join-secondary">
                <details className="join-disclosure" id="business-form">
                  <summary>Bring your business to Cahootz</summary>
                  <Suspense fallback={<div className="form-loading" />}>
                    <BusinessSignupForm coops={coops} />
                  </Suspense>
                </details>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-shell footer-inner">
          <div>
            <Link className="brand" href="/">
              <Image
                src="/cahootz-coops-mark.svg"
                alt=""
                width={46}
                height={40}
              />
              <span>Cahootz</span>
            </Link>
            <p>A place for communities to move together.</p>
          </div>
          <div className="footer-links">
            <Link href="/blog">Blog</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
              GitHub <Github aria-hidden="true" size={15} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

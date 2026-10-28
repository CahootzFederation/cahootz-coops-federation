import type { CommonsCatalog } from "@/components/group-buy-product-calculator";
import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { BlogCard } from "@/components/blog/blog-card";
import { BusinessSignupForm } from "@/components/business-signup-form";
import { GroupBuyProductCalculator } from "@/components/group-buy-product-calculator";
import { HomepageExperimentTracker } from "@/components/homepage-experiment-tracker";
import { MemberApplicationFlow } from "@/components/member-application-flow";
import { SharedPurchaseCalculator } from "@/components/shared-purchase-calculator";
import { WaitlistSignupForm } from "@/components/waitlist-signup-form";
import { env } from "@/env";
import { getFeaturedBlogPosts } from "@/lib/blog";
import { ArrowDownRight, ArrowRight, Github, MoveUpRight } from "lucide-react";

import "../landing.css";
import "../group-buy-homepage.css";

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
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/trpc/coopConfig.listActiveCoops`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
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
      },
    );
    if (!response.ok) return [];

    const data = (await response.json()) as {
      result?: { data?: unknown };
    };
    return Array.isArray(data.result?.data)
      ? (data.result.data as CommonsCatalog[])
      : [];
  } catch {
    return [];
  }
}

export const metadata: Metadata = {
  title: "Cahootz | A place for your commons to move together",
  description:
    "Cahootz connects members, community businesses, shared-price offers, and decisions so a commons can move together.",
  alternates: { canonical: "https://cahootzcommons.com" },
  openGraph: {
    title: "Cahootz | Buy together. Keep more in your commons.",
    description:
      "See what members save and what their commons receives when people unlock a shared price together.",
    url: "https://cahootzcommons.com",
    siteName: "Cahootz",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cahootz | Buy together. Keep more in your commons.",
    description:
      "See what members save and what their commons receives when people unlock a shared price together.",
  },
};

const GITHUB_REPOSITORY_URL =
  "https://github.com/CahootzFederation/cahootz-coops-federation";
const MEMBER_APP_URL = "https://app.cahootz.coop";

const pathways = [
  {
    index: "01",
    label: "Find your people",
    title: "A home for the conversation and the work.",
    body: "Join a commons, find member spaces and circles, and follow the activity that matters to you. The Commons AI Agent can summarize conversations and surface needs or resources so useful signals do not get lost.",
    details: ["Member spaces", "Group activity", "Community updates"],
    className: "pathway-community",
  },
  {
    index: "02",
    label: "Support what matters",
    title: "Make everyday spending useful to your commons.",
    body: "Discover community businesses and products your commons supports, then make purchases through the member app. Each offer shows the price, your savings, and the share that supports the commons before you commit.",
    details: ["Community businesses", "Products and offers", "Member savings"],
    className: "pathway-commerce",
  },
  {
    index: "03",
    label: "Buy together",
    title: "Unlock a better price together.",
    body: "A buying circle combines enough everyday demand to reach a lower supplier price. Every shared-price offer shows the households needed, member savings, Commons share, and Cahootz share before anyone commits.",
    details: ["Shared-price offers", "Clear savings", "Visible shares"],
    className: "pathway-governance",
  },
];

const faqs = [
  {
    q: "What is a commons?",
    a: "A commons is a community that organizes people, businesses, and shared resources around a common purpose. Each commons sets its own membership and decision rules.",
  },
  {
    q: "Do I need to own a business to join?",
    a: "No. Members can join community spaces, support participating businesses, take part in shared-price offers, and help make decisions. Businesses have a separate interest form below.",
  },
  {
    q: "How does buying together work?",
    a: "A buying circle chooses a useful product and combines enough demand to reach a lower supplier price. Each offer shows the required households, delivery terms, member savings, Commons share, and Cahootz share before members commit.",
  },
  {
    q: "Are the sample prices live offers?",
    a: "Not yet. The examples use public prices to show how the split could work. Supplier confirmation, availability, shipping, tax, deadlines, and refund terms would be disclosed before a real offer opens.",
  },
  {
    q: "Can a business offer a shared price?",
    a: "Yes. Community businesses and suppliers can use the business interest form below to tell Cahootz what they sell and what order volume would make a shared-price offer possible.",
  },
  {
    q: "Does the Commons AI Agent make decisions for members?",
    a: "Only within limits the commons sets. The agent can compare proposals with the commons’ charter and rules, show its scores and reasons, and handle qualifying requests below an automatic approval limit. Larger decisions go to members or a council vote.",
  },
  {
    q: "What if my commons is not listed?",
    a: "Join the interest list and tell us which commons you want to join or start. We will use that to understand where a new network could grow.",
  },
];

export default async function HomePage() {
  const [coops, productCatalogs] = await Promise.all([
    getActiveCoops(),
    getHomepageProductCatalogs(),
  ]);
  const featuredPosts = getFeaturedBlogPosts(3);

  return (
    <div className="landing group-buy-homepage">
      <HomepageExperimentTracker variant="group-buy" />
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
            <a href="#how-it-works">How it works</a>
            <a href="#find-a-commons">Find a commons</a>
            <Link href="/blog">Journal</Link>
          </nav>
          <a className="header-action" href="#join">
            Join a commons <ArrowRight size={16} />
          </a>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="landing-shell hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">
                A place for the people building what comes next
              </p>
              <h1 id="hero-title">
                A community is more powerful when it can{" "}
                <span>move together.</span>
              </h1>
              <p className="hero-description">
                Cahootz brings the people, places, businesses, and decisions in
                a commons together. Find your people, support local businesses,
                and help decide what your community does next.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href={MEMBER_APP_URL}>
                  Open the member app <MoveUpRight size={18} />
                </a>
                <a className="text-link" href="#how-it-works">
                  See how it works <ArrowDownRight size={18} />
                </a>
              </div>
            </div>

            <div
              className="commons-map"
              aria-label="Members, spaces, local businesses, and decisions connect through a commons"
            >
              <div className="map-caption">
                ONE COMMONS, MANY WAYS TO PARTICIPATE
              </div>
              <div className="map-center">
                <Image
                  src="/cahootz-coops-mark.svg"
                  alt=""
                  width={54}
                  height={48}
                />
                <strong>Your commons</strong>
                <span>People working together</span>
              </div>
              <div className="map-node map-members">
                <span className="node-kicker">PEOPLE</span>
                <strong>Members</strong>
                <small>Meet, share, organize</small>
              </div>
              <div className="map-node map-spaces">
                <span className="node-kicker">PLACE</span>
                <strong>Spaces &amp; circles</strong>
                <small>Find where you belong</small>
              </div>
              <div className="map-node map-business">
                <span className="node-kicker">ECONOMY</span>
                <strong>Local businesses</strong>
                <small>Buy and build nearby</small>
              </div>
              <div className="map-node map-decisions">
                <span className="node-kicker">DIRECTION</span>
                <strong>Decisions</strong>
                <small>Ideas, reviews, votes</small>
              </div>
            </div>
          </div>
          <div className="hero-footer landing-shell">
            <span>Built for the work communities already do.</span>
            <span>Scroll to explore ↓</span>
          </div>
        </section>

        <section className="intro-band" id="how-it-works">
          <div className="landing-shell intro-inner">
            <p className="eyebrow">THE IDEA</p>
            <h2>
              Belong somewhere.
              <br />
              Do something together.
            </h2>
            <p>
              A commons becomes real through everyday participation. Cahootz
              connects the conversations, commerce, and decisions that usually
              happen in separate places.
            </p>
          </div>
        </section>

        <section
          className="pathways landing-shell"
          aria-label="Ways to participate"
        >
          {pathways.map((pathway) => (
            <article
              className={`pathway ${pathway.className}`}
              key={pathway.index}
            >
              <div className="pathway-index">
                <span>{pathway.index}</span>
                <span>{pathway.label}</span>
              </div>
              <div className="pathway-main">
                <h3>{pathway.title}</h3>
                <p>{pathway.body}</p>
                <div className="pathway-tags">
                  {pathway.details.map((detail) => (
                    <span key={detail}>{detail}</span>
                  ))}
                </div>
                {pathway.index === "02" && (
                  <div className="pathway-links">
                    <a className="text-link pathway-link" href={MEMBER_APP_URL}>
                      Open the member app <MoveUpRight size={17} />
                    </a>
                    <a className="text-link pathway-link" href="#business-form">
                      Bring your business into the commons{" "}
                      <ArrowRight size={17} />
                    </a>
                  </div>
                )}
              </div>
              <div className="pathway-symbol" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </article>
          ))}
        </section>

        <section
          className="commons-section group-buy-products-section"
          id="planet-buy"
          aria-labelledby="planet-buy-title"
        >
          <div className="landing-shell">
            <div className="section-heading">
              <div>
                <h2 id="planet-buy-title">
                  See how a shared-price offer works.
                </h2>
              </div>
              <p>
                Choose a Commons, then pick a product to see how many people are
                needed, what you pay, what you save, and the exact Commons and
                Cahootz shares.
              </p>
            </div>
            <GroupBuyProductCalculator
              catalogs={
                productCatalogs.length > 0 ? productCatalogs : undefined
              }
            />
            <SharedPurchaseCalculator />
          </div>
        </section>

        <section className="decision-section" id="shared-decisions">
          <div className="landing-shell decision-inner">
            <div>
              <p className="eyebrow">SHARED DECISIONS</p>
              <h2>Choose what your commons supports.</h2>
            </div>
            <div>
              <p>
                Members decide which products, businesses, and purposes their
                commons will support. They can set standards for what appears,
                compare proposed offers, and decide how the Commons share is
                used.
              </p>
              <p>
                The Commons AI Agent can summarize needs, compare proposals with
                the commons&apos; charter and rules, and surface tradeoffs.
                Members set the direction, see the reasons behind a review, and
                send larger decisions to a council vote.
              </p>
              <p>
                That keeps the immediate benefit clear without separating it
                from the rest of community life: members can save on useful
                purchases while building resources their commons controls.
              </p>
              <a className="text-link" href="#join">
                Get involved <MoveUpRight size={18} />
              </a>
            </div>
          </div>
        </section>

        <section className="commons-section" id="find-a-commons">
          <div className="landing-shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">OPEN DOORS</p>
                <h2>Find a commons to join.</h2>
              </div>
              <p>
                Each commons has its own purpose and application. Start with the
                one that feels like yours.
              </p>
            </div>
            {coops.length > 0 ? (
              <div className="commons-list">
                {coops.map((coop) => (
                  <article className="commons-row" key={coop.coopId}>
                    <div className="commons-row-mark" aria-hidden="true">
                      ✳
                    </div>
                    <div>
                      <h3>{coop.name}</h3>
                      <p>
                        {coop.tagline ||
                          coop.description ||
                          "Explore this commons and its community."}
                      </p>
                    </div>
                    <div className="commons-row-actions">
                      <Link href={`/${coop.coopId}/application`}>
                        Apply <ArrowRight size={17} />
                      </Link>
                      {coop.hasPublishedPublicPage && (
                        <Link href={`/c/${coop.coopId}`}>
                          Explore page <MoveUpRight size={17} />
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="commons-empty">
                Looking for a commons in your area?{" "}
                <a href="#join">
                  Tell us where you want to build <ArrowRight size={16} />
                </a>
              </div>
            )}
          </div>
        </section>

        <section className="join-section" id="join">
          <div className="landing-shell join-inner">
            <div className="join-intro">
              <p className="eyebrow">YOUR NEXT STEP</p>
              <h2>There is a place for you in this.</h2>
              <p>
                Choose a live commons and apply with the questions that
                community has set. If yours is still taking shape, tell us where
                you want to build.
              </p>
              <div className="join-aside">
                <span>FOR MEMBERS</span>
                <strong>Find your people and start participating.</strong>
              </div>
            </div>
            <div className="join-forms">
              <Suspense fallback={<div className="form-loading" />}>
                <MemberApplicationFlow />
              </Suspense>
              <div className="join-secondary">
                <div className="waitlist-panel">
                  <h3>Don&apos;t see your commons?</h3>
                  <p>Tell us what community you want to join or create.</p>
                  <Suspense fallback={<div className="form-loading" />}>
                    <WaitlistSignupForm coops={coops} />
                  </Suspense>
                </div>
                <div id="business-form">
                  <Suspense fallback={<div className="form-loading" />}>
                    <BusinessSignupForm coops={coops} />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        </section>

        {featuredPosts.length > 0 && (
          <section className="journal-section">
            <div className="landing-shell">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">FROM THE JOURNAL</p>
                  <h2>Notes from building Cahootz.</h2>
                </div>
                <Link className="text-link" href="/blog">
                  Read the journal <ArrowRight size={18} />
                </Link>
              </div>
              <div className="journal-grid">
                {featuredPosts.map((post, index) => (
                  <BlogCard
                    key={post.slug}
                    post={post}
                    priority={index === 0}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="faq-section" id="questions">
          <div className="landing-shell faq-inner">
            <div>
              <p className="eyebrow">A FEW QUESTIONS</p>
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
            <Link href="/blog">Journal</Link>
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

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { BlogCard } from "@/components/blog/blog-card";
import { BusinessSignupForm } from "@/components/business-signup-form";
import { MemberApplicationFlow } from "@/components/member-application-flow";
import { TreasuryContributionCalculator } from "@/components/treasury-contribution-calculator";
import { WaitlistSignupForm } from "@/components/waitlist-signup-form";
import { env } from "@/env";
import { getFeaturedBlogPosts } from "@/lib/blog";
import {
  ArrowDownRight,
  ArrowRight,
  Github,
  MoveUpRight,
  Smartphone,
} from "lucide-react";

import "./landing.css";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/cahootz-commons/id6772781102";

function AppStoreButton({
  children = "Download on the App Store",
  className = "button button-primary",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a className={className} href={APP_STORE_URL} target="_blank" rel="noreferrer">
      <Smartphone size={18} /> {children}
    </a>
  );
}

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

export const metadata: Metadata = {
  title: "Cahootz Commons | Your people, all in one place",
  description:
    "Cahootz Commons is the iPhone app for the communities you belong to. Post and react in your commons, talk in circles, organize your family, and let Sage introduce you to the members who can help.",
  alternates: { canonical: "https://cahootzcommons.com" },
};

const GITHUB_REPOSITORY_URL =
  "https://github.com/CahootzFederation/cahootz-coops-federation";

const pathways = [
  {
    index: "01",
    label: "Find your people",
    title: "A home for the conversation and the work.",
    body: "Post to your commons, react with any emoji, @mention a neighbor, and talk in smaller circles. Families get a private commons with shared goals.",
    details: ["Commons feed", "Circles", "Family commons"],
    className: "pathway-community",
  },
  {
    index: "02",
    label: "Keep it local",
    title: "Make the local economy visible.",
    body: "Discover businesses in your network, explore what they offer, and make purchases through the member app. Participation connects the people doing business to the people building the commons.",
    details: ["Stores and products", "Payments", "Member rewards"],
    className: "pathway-commerce",
  },
  {
    index: "03",
    label: "Decide together",
    title: "Turn a shared need into a shared decision.",
    body: "When a need becomes a plan, members propose it, talk it through, and vote. Sage reviews each proposal against your commons' charter and shows its reasons. Larger requests always go to a council vote.",
    details: ["Proposals", "Discussion", "Voting"],
    className: "pathway-governance",
  },
];

const faqs = [
  {
    q: "What is a commons?",
    a: "A commons is a community that shares a purpose: a neighborhood, a family, a congregation, a club, or a co-op. Each commons sets its own membership rules, charter, and goals.",
  },
  {
    q: "How do I join?",
    a: "Most people join through an invite from a member or guide. Download the app, sign in with your phone number, and you land in the commons and circles you were invited to. You can also apply to a live commons below.",
  },
  {
    q: "Is there an Android app?",
    a: "Not yet. Cahootz Commons is on iPhone today and Android is in preparation. Join the interest list below and we will tell you when it is ready.",
  },
  {
    q: "What is Sage?",
    a: "Sage is your commons' helper. It answers questions from your commons' own charter, introduces members who can help each other when both agree, notices needs and offers in the feed, and follows up so things don't slip.",
  },
  {
    q: "What won't Sage do?",
    a: "Sage never votes, spends money, changes membership or roles, or amends a charter on its own. Those need the right people to approve them. Each commons sets limits on Sage's monthly AI spending, and private circles stay private.",
  },
  {
    q: "Does Sage make decisions for members?",
    a: "Only small ones, within limits the commons sets. Sage reviews proposals for mission fit, feasibility, and risk and shows its scores and reasons. It can approve a qualifying request below the commons' automatic approval limit or ask for changes; larger requests go to a council vote. Sage can still be wrong or reflect bias, so the reasons stay visible.",
  },
  {
    q: "Do I need to own a business to join?",
    a: "No. Members can take part in circles, support local businesses, and help decide what the commons does. Businesses have a separate interest form below.",
  },
];

export default async function HomePage() {
  const coops = await getActiveCoops();
  const featuredPosts = getFeaturedBlogPosts(3);

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
            <a href="#how-it-works">How it works</a>
            <a href="#sage">Meet Sage</a>
            <a href="#get-in">How to get in</a>
            <a href="#find-a-commons">Find a commons</a>
            <Link href="/blog">Journal</Link>
          </nav>
          <a
            className="header-action"
            href={APP_STORE_URL}
            target="_blank"
            rel="noreferrer"
          >
            Get the app <ArrowRight size={16} />
          </a>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="landing-shell hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">
                The app for the communities you actually belong to
              </p>
              <h1 id="hero-title">
                Your people, <span>all in one place.</span>
              </h1>
              <p className="hero-description">
                Join your commons, talk in circles, plan with your family, and
                let Sage introduce you to the members who can help, or who
                need you.
              </p>
              <div className="hero-actions">
                <AppStoreButton />
                <a className="button button-secondary" href="#get-in">
                  Have an invite? <ArrowRight size={18} />
                </a>
                <a className="text-link" href="#how-it-works">
                  See how it works <ArrowDownRight size={18} />
                </a>
              </div>
              <p className="hero-note">
                Free on iPhone. Android is coming soon.
              </p>
            </div>
            <div
              className="commons-map"
              aria-label="Your feed, circles, families, Sage, and local stores connect through a commons"
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
                <span className="node-kicker">FEED</span>
                <strong>Posts & reactions</strong>
                <small>Share, mention, react</small>
              </div>
              <div className="map-node map-spaces">
                <span className="node-kicker">CIRCLES</span>
                <strong>Circles & families</strong>
                <small>Smaller rooms for your people</small>
              </div>
              <div className="map-node map-business">
                <span className="node-kicker">ECONOMY</span>
                <strong>Local businesses</strong>
                <small>Buy and build nearby</small>
              </div>
              <div className="map-node map-decisions">
                <span className="node-kicker">SAGE</span>
                <strong>Sage</strong>
                <small>Introductions & follow-ups</small>
              </div>
            </div>
          </div>
          <div className="hero-footer landing-shell">
            <span>For neighborhoods, families, clubs, and co-ops.</span>
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
                  <a className="text-link pathway-link" href="#business-form">
                    Bring your business into the commons{" "}
                    <ArrowRight size={17} />
                  </a>
                )}
              </div>
              <div className="pathway-symbol" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </article>
          ))}
          <div className="section-cta">
            <span>See your commons in the app.</span>
            <AppStoreButton />
          </div>
        </section>

        <section className="decision-section" id="sage">
          <div className="landing-shell decision-inner">
            <div>
              <p className="eyebrow">MEET SAGE</p>
              <h2>A helper that knows your commons.</h2>
              <div className="sage-limits">
                <strong>What Sage won&apos;t do</strong>
                <p>
                  Sage never votes, spends money, changes who is a member, or
                  amends your charter on its own. People decide. Each commons
                  caps what Sage can spend on AI each month, and private
                  circles stay private.
                </p>
              </div>
            </div>
            <div>
              <ul className="sage-list">
                <li>
                  <strong>Introduces people who can help each other.</strong>{" "}
                  Someone needs a ride Saturday and someone else is driving.
                  Sage asks the person with the need first and only connects
                  you when both of you agree.
                </li>
                <li>
                  <strong>Notices needs and offers.</strong> When someone
                  posts that they can fix bikes or need a babysitter, Sage
                  can list it as a resource so the right people find it.
                </li>
                <li>
                  <strong>Answers from your own charter.</strong> Ask how
                  your commons does things and Sage answers from your
                  commons&apos; rules, not generic advice.
                </li>
                <li>
                  <strong>Follows up.</strong> Sage checks back on
                  suggestions nobody answered, so good ideas don&apos;t slip.
                </li>
                <li>
                  <strong>Shows its reasons.</strong> When members propose
                  a plan, Sage reviews it against the charter and shows its
                  scores and reasons. Larger requests always go to a council
                  vote.
                </li>
              </ul>
              <AppStoreButton>Meet Sage in the app</AppStoreButton>
            </div>
          </div>
        </section>

        <section className="get-in-section" id="get-in">
          <div className="landing-shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">HOW TO GET IN</p>
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
                  A member or guide invites you, or you apply to a commons
                  below. Family commons invites are approved by a steward.
                </p>
              </li>
              <li>
                <span>02</span>
                <strong>Sign in with your phone.</strong>
                <p>
                  Download Cahootz Commons and sign in with your phone number.
                  No password to remember.
                </p>
              </li>
              <li>
                <span>03</span>
                <strong>You&apos;re in your circles.</strong>
                <p>
                  Your commons, its circles, and Sage are waiting. Say hello.
                </p>
              </li>
            </ol>
            <div className="get-in-actions">
              <AppStoreButton />
              <a className="text-link" href="#join">
                No invite? Apply or start a commons <ArrowRight size={18} />
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
                <strong>Already invited? Get the app and sign in.</strong>
                <AppStoreButton className="button button-secondary" />
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

        <TreasuryContributionCalculator />

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

        <section className="faq-section">
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
        <section className="final-cta">
          <div className="landing-shell final-cta-inner">
            <h2>Your community is already here.</h2>
            <AppStoreButton>Download Cahootz Commons for iPhone</AppStoreButton>
            <a className="text-link" href="#join">
              On Android? Tell us and we&apos;ll let you know{" "}
              <ArrowRight size={18} />
            </a>
          </div>
        </section>
      </main>

      <div className="sticky-app-bar">
        <span>Cahootz Commons for iPhone</span>
        <AppStoreButton>Get the app</AppStoreButton>
      </div>

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
            <p>Your people, all in one place.</p>
          </div>
          <div className="footer-links">
            <Link href="/blog">Journal</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
              GitHub <Github size={15} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

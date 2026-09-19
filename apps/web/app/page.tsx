import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { BlogCard } from "@/components/blog/blog-card";
import { BusinessSignupForm } from "@/components/business-signup-form";
import { MemberApplicationFlow } from "@/components/member-application-flow";
import { TreasuryContributionCalculator } from "@/components/treasury-contribution-calculator";
import { WaitlistSignupForm } from "@/components/waitlist-signup-form";
import { env } from "@/env";
import { getFeaturedBlogPosts } from "@/lib/blog";
import { ArrowDownRight, ArrowRight, Github, MoveUpRight } from "lucide-react";

import "./landing.css";

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
  title: "Cahootz | A place for your commons to move together",
  description:
    "Cahootz connects members, local businesses, and shared decisions, with AI that helps coordinate the commons and evaluates proposals against community-set rules.",
  alternates: { canonical: "https://cahootz.coop" },
};

const GITHUB_REPOSITORY_URL =
  "https://github.com/CahootzFederation/cahootz-coops-federation";

const pathways = [
  {
    index: "01",
    label: "Find your people",
    title: "A home for the conversation and the work.",
    body: "Join a commons, find member spaces and circles, and follow the activity that matters to you. AI can summarize conversations and surface needs or resources so useful signals do not get lost.",
    details: ["Member spaces", "Group activity", "Community updates"],
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
    body: "Members can bring forward proposals and discuss tradeoffs. AI reviews each idea against the commons' rules and explains its reasoning. Qualifying small requests can be approved automatically; larger ones go to a council vote.",
    details: ["Proposals", "Discussion", "Voting"],
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
    a: "No. Members can take part in community spaces, support local businesses, and participate in decisions. Businesses have a separate interest form below.",
  },
  {
    q: "Does AI make decisions for members?",
    a: "Yes, within limits the commons sets. AI evaluates proposals against the commons' mission and rules. It can approve qualifying proposals below that commons' small-spending limit, ask for revisions, or keep a proposal from advancing. Proposals above the automatic approval limit go to a council vote.",
  },
  {
    q: "How is AI used elsewhere in the commons?",
    a: "AI can help summarize circle activity, identify needs and resources in posts, recommend relevant commons, and answer questions using a commons' charter and mission. These uses are designed to serve the commons and its members. Each commons sets the rules for its decisions; Cahootz currently runs the underlying AI service across commons.",
  },
  {
    q: "Will each commons own its own AI?",
    a: "That is the direction we are building toward: an AI owned by each commons, isolated for that commons, and used only to serve it. Today, each commons controls the charter, goals, and limits that guide its AI decisions, while Cahootz runs a shared AI service. Separate ownership and isolation are not in place yet.",
  },
  {
    q: "How do you work toward fair AI decisions?",
    a: "Each commons sets the goals, scoring weights, and spending limits that guide proposal reviews. Cahootz records scores and reasons so people can see how a proposal was judged. That is a way to make decisions more consistent and open to scrutiny, but AI can still make mistakes or reflect bias.",
  },
  {
    q: "What if my commons is not listed?",
    a: "Join the interest list and tell us which commons you want to join or start. We will use that to understand where a new network could grow.",
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
                <a className="button button-primary" href="#join">
                  Find your commons <ArrowRight size={18} />
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
                <strong>Spaces & circles</strong>
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
        </section>

        <section className="decision-section" id="ai-role">
          <div className="landing-shell decision-inner">
            <div>
              <p className="eyebrow">SHARED DECISIONS</p>
              <h2>From an idea to a decision.</h2>
            </div>
            <div>
              <p>
                AI serves the commons whose decisions it helps make. Each
                commons sets its own charter, goals, and spending limits. AI
                uses those rules to check proposals for mission fit,
                feasibility, risk, and accountability, then shows its scores
                and reasons.
              </p>
              <p>
                AI can approve a qualifying request below the commons&apos;
                automatic approval limit. Larger requests go to a council vote.
                If an idea needs work, AI can ask for revisions or keep it from
                advancing.
              </p>
              <p>
                Applying the same rules openly can support fairer decisions,
                though AI can still be wrong or biased. The community controls
                the rules and can see how each proposal was judged.
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
              GitHub <Github size={15} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

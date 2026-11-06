import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { BlogCard } from "@/components/blog/blog-card";
import { BusinessSignupForm } from "@/components/business-signup-form";
import { HomepageExperimentTracker } from "@/components/homepage-experiment-tracker";
import { TreasuryContributionCalculator } from "@/components/treasury-contribution-calculator";
import { WaitlistSignupForm } from "@/components/waitlist-signup-form";
import { env } from "@/env";
import { getFeaturedBlogPosts } from "@/lib/blog";
import { MEMBER_APP_STORE_URL } from "@/lib/member-app";
import {
  ArrowDownRight,
  ArrowRight,
  Github,
} from "lucide-react";

import "./landing.css";

function WaitlistButton({
  children = "Join the waitlist",
  className = "button button-primary",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a className={className} href="#join">
      {children} <ArrowDownRight size={18} />
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
  title: "Cahootz | A place for communities to move together",
  description:
    "Cahootz Commons is the iPhone app for the communities you belong to. Walk your commons street, talk in circles, organize your family, buy together for better prices, and let Sage introduce you to the members who can help.",
  alternates: { canonical: "https://cahootzcommons.com" },
};

const GITHUB_REPOSITORY_URL =
  "https://github.com/CahootzFederation/cahootz-coops-federation";

const pathways = [
  {
    index: "01",
    label: "Belong",
    title: "Know the people around you.",
    body: "See what your neighbors, family, and friends are up to, celebrate each other's wins, and jump into the conversations that matter to you. It feels like the group chat, the town square, and the kitchen table in one place.",
    className: "pathway-community",
  },
  {
    index: "02",
    label: "Show up",
    title: "Help each other without having to ask twice.",
    body: "Need a hand moving, a recommendation, or someone to watch the kids? Ask once and the people who can help will see it. When you can help, you'll know.",
    className: "pathway-commerce",
  },
  {
    index: "03",
    label: "Build",
    title: "Make things happen together.",
    body: "Spend with the businesses your people run, pool ideas into plans, and watch your community get stronger because you're part of it.",
    className: "pathway-governance",
  },
];

const insideApp = [
  {
    label: "Group deals",
    title: "Buy together, pay less.",
    body: "Join a deal with your commons and everyone gets a better price. You won't be charged unless the deal reaches its goal.",
  },
  {
    label: "Your street",
    title: "Your commons is a street you can walk.",
    body: "Pick your look, see who's out, and step into Circle Hall to find the circles you're part of.",
  },
  {
    label: "Families",
    title: "A commons just for your family.",
    body: "Share news, plan get-togethers, and keep everyone in the loop, without the group chat chaos.",
  },
  {
    label: "Sage",
    title: "Text Sage like you'd text a friend.",
    body: "Ask for help or offer what you're good at. Sage finds the people who fit and makes the intro.",
  },
];

const appScreens = [
  {
    src: "/app-screens/street.webp",
    alt: "The Commons tab: a walkable street with each member's house, neighbors strolling, and the Community Board in the middle",
    caption: "Walk your street and see who's out.",
  },
  {
    src: "/app-screens/group-deal.webp",
    alt: "A group deal for a 2 lb bag of coffee: $24 instead of $34, with 5 of 10 neighbors committed",
    caption: "Join a group deal and save.",
  },
  {
    src: "/app-screens/sage-chat.webp",
    alt: "A chat where Sage introduces a parent to a neighbor who tutors algebra",
    caption: "Ask Sage, and meet the neighbor who can help.",
  },
];

const faqs = [
  {
    q: "What is a commons?",
    a: "A commons is your community on Cahootz: a neighborhood, a family, a congregation, a club, or a co-op. Each one sets its own way of doing things.",
  },
  {
    q: "How do I join?",
    a: "Get an invite from someone already in, or join the waitlist for a commons below. Then download the app and sign in.",
  },
  {
    q: "Is there an Android app?",
    a: "Not yet. Cahootz Commons is on iPhone today, and we're getting the Android app ready now. Join the waitlist below and we'll tell you when it's out.",
  },
  {
    q: "How do group deals work?",
    a: "Your commons picks something lots of people already buy. When enough people join, everyone gets the lower price. You save your card when you join, and you're only charged if the deal reaches its goal.",
  },
  {
    q: "Who is Sage?",
    a: "Sage is the AI Community Guide built into every commons. It connects people who can help each other and keeps good ideas moving. People still make the decisions.",
  },
  {
    q: "Do I need to own a business to join?",
    a: "No. Most members just want to stay close to their people. If you do run a business, there's a separate form below.",
  },
];

export default async function HomePage() {
  const coops = await getActiveCoops();
  const featuredPosts = getFeaturedBlogPosts(3);

  return (
    <div className="landing">
      <HomepageExperimentTracker variant="community" />
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
            <a href="#inside">What&apos;s inside</a>
            <a href="#sage">Meet Sage</a>
            <a href="#get-in">How to get in</a>
            <a href="#find-a-commons">Find a commons</a>
            <Link href="/blog">Journal</Link>
          </nav>
          <a className="header-action" href="#join">
            Join the waitlist <ArrowRight size={16} />
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
                A community is more powerful when it can{" "}
                <span>move together.</span>
              </h1>
              <p className="hero-description">
                Stay close to the people who matter, find help when you need
                it, and be the help someone else is looking for. Cahootz is
                where your community comes together, every day.
              </p>
              <div className="hero-actions">
                <WaitlistButton />
                <a className="button button-secondary" href="#get-in">
                  Have an invite? <ArrowRight size={18} />
                </a>
                <a className="text-link" href="#how-it-works">
                  See how it works <ArrowDownRight size={18} />
                </a>
              </div>
            </div>
            <div
              className="commons-map"
              aria-label="Your people, help, group deals, and Sage connect through a commons"
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
                <span className="node-kicker">CONNECT</span>
                <strong>Stay close</strong>
                <small>See what your people are up to</small>
              </div>
              <div className="map-node map-spaces">
                <span className="node-kicker">SUPPORT</span>
                <strong>Get help</strong>
                <small>Ask once, the right people see it</small>
              </div>
              <div className="map-node map-business">
                <span className="node-kicker">GROUP DEALS</span>
                <strong>Buy together</strong>
                <small>Better prices when you team up</small>
              </div>
              <div className="map-node map-decisions">
                <span className="node-kicker">AI COMMUNITY GUIDE</span>
                <strong>Sage</strong>
                <small>Connects you with people who can help</small>
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
              Life is better when you're not doing it alone. Cahootz keeps you
              close to your people, so the asks, the offers, the good news, and
              the plans all land in the same place.
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
                {pathway.index === "03" && (
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
            <span>Your people are already there.</span>
            <WaitlistButton />
          </div>
        </section>

        <section className="inside-section" id="inside">
          <div className="landing-shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">WHAT&apos;S INSIDE</p>
                <h2>What you can do today.</h2>
              </div>
              <p>
                These are live in the Cahootz Commons app right now, not
                someday.
              </p>
            </div>
            <div className="app-screens" aria-label="Screens from the Cahootz Commons app">
              {appScreens.map((screen) => (
                <figure className="app-screen" key={screen.src}>
                  <div className="phone-frame">
                    <Image
                      src={screen.src}
                      alt={screen.alt}
                      width={780}
                      height={1688}
                      sizes="(max-width: 700px) 70vw, 280px"
                    />
                  </div>
                  <figcaption>{screen.caption}</figcaption>
                </figure>
              ))}
            </div>
            <p className="app-screens-note">
              Screens show a sample commons with made-up neighbors.
            </p>
            <ul className="inside-grid">
              {insideApp.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="decision-section" id="sage">
          <div className="landing-shell decision-inner">
            <div>
              <p className="eyebrow">MEET SAGE</p>
              <h2>Someone always looking out for you.</h2>
              <p className="sage-intro">
                Sage is your AI Community Guide. Ask it anything, and it
                connects you with people who can help.
              </p>
            </div>
            <div>
              <ul className="sage-list">
                <li>
                  <strong>The right people find each other.</strong> When
                  someone posts that they can fix bikes or need a babysitter,
                  Sage can list it as a resource so the right people find it.
                </li>
                <li>
                  <strong>Nothing falls through the cracks.</strong> Good
                  ideas and open asks get a nudge, so they turn into plans
                  instead of getting buried.
                </li>
                <li>
                  <strong>Answers when you&apos;re new.</strong> Ask how your
                  community does things and get an answer right away, without
                  feeling like you&apos;re bothering anyone.
                </li>
              </ul>
              <WaitlistButton>Join the waitlist to meet Sage</WaitlistButton>
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
                  A member or guide invites you, or you join the waitlist for
                  a commons below.
                </p>
              </li>
              <li>
                <span>02</span>
                <strong>Download the app.</strong>
                <p>
                  When your commons opens up, get the free Cahootz Commons
                  app and sign in.
                </p>
                <a
                  className="text-link"
                  href={MEMBER_APP_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Have an invite? Get the iPhone app{" "}
                  <ArrowRight size={16} />
                </a>
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
              <WaitlistButton />
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
                Each commons has its own purpose. Pick the one that feels like
                yours and join its waitlist. We&apos;ll let you know when it
                opens up.
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
                We&apos;re letting people in a few at a time. Join the
                waitlist and tell us which commons you&apos;re interested in.
                If yours isn&apos;t listed yet, tell us where you want to build.
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

        <div className="landing-shell">
          <details className="treasury-disclosure">
            <summary>How purchases support your community</summary>
            <TreasuryContributionCalculator />
          </details>
        </div>

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
            <WaitlistButton />
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

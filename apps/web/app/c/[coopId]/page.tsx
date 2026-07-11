import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle,
  HeartHandshake,
  Landmark,
  Megaphone,
  Newspaper,
  Store,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FallbackImage } from "@/components/ui/fallback-image";
import { FeaturedProducts } from "./components/featured-products";
import { TrackPageView } from "./components/track-page-view";
import {
  communityTypeLabels,
  getCommunityPostSlug,
  normalizeCommunityPosts,
  normalizePreviewOverrides,
  withDevSampleCommunityPosts,
} from "./newsletter-posts";
import { env } from "@/env";

const TEMP_PUBLIC_MEMBER_COUNT_FALLBACK = 320;

interface PublicFeature {
  title: string;
  description: string;
}

interface PublicFAQ {
  question: string;
  answer: string;
}

function normalizeFeatures(value: unknown): PublicFeature[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((feature): feature is PublicFeature => {
      return (
        typeof feature === "object" &&
        feature !== null &&
        "title" in feature &&
        "description" in feature &&
        typeof feature.title === "string" &&
        typeof feature.description === "string" &&
        feature.title.trim().length > 0
      );
    })
    .map((feature) => ({
      title: feature.title.trim(),
      description: feature.description.trim(),
    }));
}

function normalizeFaqs(value: unknown): PublicFAQ[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((faq): faq is PublicFAQ => {
      return (
        typeof faq === "object" &&
        faq !== null &&
        "question" in faq &&
        "answer" in faq &&
        typeof faq.question === "string" &&
        typeof faq.answer === "string" &&
        faq.question.trim().length > 0 &&
        faq.answer.trim().length > 0
      );
    })
    .map((faq) => ({
      question: faq.question.trim(),
      answer: faq.answer.trim(),
    }));
}

async function getPublicCoopInfo(coopId: string) {
  if(!coopId) {
    return null;
  }
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const input = JSON.stringify({ coopId });
    const url = `${apiUrl}/publicCoopInfo.getByCoopId?input=${encodeURIComponent(input)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.result.data;
  } catch (error) {
    console.error('Error fetching public coop info:', error);
    return null;
  }
}

async function getCoopConfig(coopId: string) {
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const input = JSON.stringify({ coopId });
    const url = `${apiUrl}/coopConfig.getActive?input=${encodeURIComponent(input)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.result.data;
  } catch (error) {
    console.error('Error fetching coop config:', error);
    return null;
  }
}

async function getPreviewData(coopId: string, previewMode: 'live' | 'curated' | 'hybrid') {
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const input = JSON.stringify({ coopId, previewMode });
    const url = `${apiUrl}/publicCoopInfo.getPreviewData?input=${encodeURIComponent(input)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.result.data;
  } catch (error) {
    console.error('Error fetching preview data:', error);
    return null;
  }
}

async function getFeaturedProducts(coopId: string) {
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const input = JSON.stringify({ coopId, limit: 8 });
    const url = `${apiUrl}/store.getProducts?input=${encodeURIComponent(input)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const products: any[] = data.result.data.products || [];

    // Prefer products explicitly marked as featured, but fall back to the
    // most recent products so the section is never empty when products exist.
    const featured = products.filter((p: any) => p.isFeatured);
    return featured.length > 0 ? featured : products;
  } catch (error) {
    console.error('Error fetching featured products:', error);
    return [];
  }
}





interface PageProps {
  params: Promise<{ coopId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { coopId } = await params;
  const publicInfo = await getPublicCoopInfo(coopId);

  if (!publicInfo) {
    return {
      title: "Coop Not Found",
    };
  }

  const name = publicInfo.name || coopId;
  const title = publicInfo.heroTitle || publicInfo.tagline || name;
  const description = publicInfo.heroSubtitle || publicInfo.tagline || '';

  return {
    title: `${name} | ${title}`,
    description,
    alternates: {
      canonical: `/c/${coopId}`,
    },
    openGraph: {
      title: `${name} | ${title}`,
      description,
      url: `/c/${coopId}`,
      siteName: name,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} | ${title}`,
      description,
    },
  };
}

export default async function CoopPublicPage({ params }: PageProps) {
  const { coopId } = await params;
  
  const publicInfo = await getPublicCoopInfo(coopId);
  
  if (!publicInfo) {
    notFound();
  }

  // Fetch coop config for colors and other settings
  const coopConfig = await getCoopConfig(coopId);

  // Fetch preview data (stores and proposals)
  const previewData = await getPreviewData(coopId, publicInfo.previewMode as 'live' | 'curated' | 'hybrid');
  
  // Fetch featured products for this coop
  const featuredProducts = await getFeaturedProducts(coopId);
  const liveStats = previewData?.stats ?? {};
  const liveMemberCount = Number(liveStats.memberCount ?? 0);
  const liveProductCount = Number(liveStats.productCount ?? 0);
  
  // Colors are stored as hex values like "#16a34a"
  // Create gradient from primary and accent colors
  const primaryColorHex = coopConfig?.bgColor || publicInfo.primaryColor || '#ea580c';
  const accentColorHex = coopConfig?.accentColor || publicInfo.accentColor || '#d97706';
  const applicationUrl = publicInfo.primaryCtaUrl || `/${coopId}/application`;
  const recruitmentFeatures = normalizeFeatures(coopConfig?.displayFeatures);
  const faqs = normalizeFaqs(publicInfo.faqs);
  const aboutBody = publicInfo.aboutBody || '';
  const eligibilityTitle = publicInfo.eligibilityTitle || '';
  const eligibilityBody = publicInfo.eligibilityBody || '';
  const previewOverrides = normalizePreviewOverrides(publicInfo.previewOverrides);
  const communityPosts = withDevSampleCommunityPosts(
    coopId,
    normalizeCommunityPosts(previewOverrides.communityPosts)
  );

  // Transform publicInfo to match expected coop structure
  const coop = {
    name: publicInfo.name || coopId,
    title: publicInfo.heroTitle || publicInfo.tagline || publicInfo.name || coopId,
    tagline: publicInfo.heroSubtitle || publicInfo.tagline || '',
    bgColor: primaryColorHex,
    primaryCtaLabel: publicInfo.primaryCtaLabel || "Apply to Join",
    // Temporary public display floor while early member data is still being
    // backfilled. Remove once live membership numbers are ready to show.
    memberCount: Math.max(liveMemberCount, TEMP_PUBLIC_MEMBER_COUNT_FALLBACK),
    storeCount: Number(liveStats.storeCount ?? previewData?.stores?.length ?? 0),
    totalProducts: liveProductCount || featuredProducts.length,
  };
  const newsletterTitle =
    typeof previewOverrides.newspaperTitle === "string" && previewOverrides.newspaperTitle.trim()
      ? previewOverrides.newspaperTitle.trim()
      : `${coop.name} Newsletter`;
  const newsletterIntro =
    typeof previewOverrides.newspaperIntro === "string" ? previewOverrides.newspaperIntro.trim() : "";
  const leadPost = communityPosts[0];
  const secondaryPosts = communityPosts
    .slice(1)
    .filter((post) => post.type !== "event" && post.type !== "business")
    .slice(0, 4);
  const eventPosts = communityPosts.filter((post) => post.type === "event").slice(0, 3);
  const businessPosts = communityPosts.filter((post) => post.type === "business").slice(0, 3);
  const hasStoryPosts = secondaryPosts.length > 0;
  const updatePosts = communityPosts.slice(1, 7);
  const issueIntro =
    newsletterIntro ||
    coop.tagline ||
    aboutBody ||
    `Stories, events, classifieds, and business updates from ${coop.name}.`;
  const getPostHref = (post: (typeof communityPosts)[number]) => {
    const index = communityPosts.indexOf(post);
    return `/c/${coopId}/articles/${getCommunityPostSlug(post, index >= 0 ? index : 0)}`;
  };

  // Map featured (or fallback recent) products for the homepage grid.
  const products = featuredProducts.map((product: any) => ({
    id: product.id,
    name: product.name,
    description: product.description || '',
    priceUSD: product.priceUSD,
    imageUrl: product.imageUrl || '',
    images: product.images || [],
    storeName: product.store?.name || '',
    category: product.category || 'OTHER',
    productType: 'PHYSICAL', // Default to PHYSICAL since productType doesn't exist in schema
  }));

  return (
    <div
      className="min-h-screen bg-[var(--newsletter-paper)] text-[color:var(--newsletter-ink)]"
      style={
        {
          "--coop-primary": primaryColorHex,
          "--coop-accent": accentColorHex,
          "--newsletter-paper": "#f8fafc",
          "--newsletter-panel": "#ffffff",
          "--newsletter-soft": "#eef2f7",
          "--newsletter-ink": "#101828",
          "--newsletter-muted": "#475467",
          "--newsletter-rule": "#cbd5e1",
          "--newsletter-kicker": primaryColorHex,
        } as CSSProperties
      }
    >
      <TrackPageView event="coop_landing_viewed" properties={{ coop_id: coopId, coop_name: coop.name }} />
      <section className="border-b-2 border-[color:var(--newsletter-ink)] bg-[var(--newsletter-panel)] px-4 pt-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--newsletter-ink)] px-3 py-2 text-xs font-black uppercase tracking-[0.22em] text-white">
            <span className="inline-flex items-center gap-2">
              <Newspaper className="h-4 w-4" />
              Community Magazine
            </span>
            <span>{coop.name}</span>
            <Link
              href={applicationUrl}
              className="inline-flex items-center gap-1 text-white no-underline hover:text-[color:var(--coop-accent)] hover:no-underline"
            >
              {coop.primaryCtaLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="py-7 text-center md:py-10">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-[color:var(--newsletter-kicker)]">
              Public Issue
            </p>
            <h1 className="mt-2 text-5xl font-black leading-none tracking-normal md:text-8xl">
              {newsletterTitle}
            </h1>
            <p className="mx-auto mt-4 max-w-4xl text-base leading-7 text-[color:var(--newsletter-muted)] md:text-lg">
              {issueIntro}
            </p>
          </div>

          <nav className="flex gap-5 overflow-x-auto border-t-2 border-[color:var(--newsletter-ink)] py-3 text-xs font-black uppercase tracking-[0.18em] text-[color:var(--newsletter-ink)]">
            <a href="#cover" className="shrink-0 no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">Cover</a>
            <a href="#stories" className="shrink-0 no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">Stories</a>
            <a href="#events" className="shrink-0 no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">Events</a>
            <a href="#classifieds" className="shrink-0 no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">Classifieds</a>
            <a href="#apply" className="shrink-0 no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">Apply</a>
          </nav>
        </div>
      </section>

      <section id="cover" className="border-b-2 border-[color:var(--newsletter-ink)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          {leadPost ? (
            <article className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(260px,0.7fr)]">
              {leadPost.imageUrl && (
                <Link
                  href={getPostHref(leadPost)}
                  className="relative block min-h-[360px] overflow-hidden bg-[var(--newsletter-soft)] no-underline hover:no-underline md:min-h-[520px]"
                >
                  <FallbackImage
                    src={leadPost.imageUrl}
                    alt={leadPost.title}
                    fill
                    sizes="(min-width: 1024px) 55vw, 100vw"
                    className="object-cover transition duration-500 hover:scale-[1.02]"
                    priority
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-5 text-white md:p-8">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[color:var(--coop-accent)]">
                      Cover Story
                    </p>
                    <h2 className="mt-2 text-3xl font-black leading-tight md:text-5xl">
                      {leadPost.title}
                    </h2>
                  </div>
                </Link>
              )}

              <div className="flex flex-col justify-between border-y-2 border-[color:var(--newsletter-ink)] py-5 lg:border-y-0 lg:border-r-2 lg:pr-6">
                <div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-black uppercase tracking-[0.18em] text-[color:var(--newsletter-kicker)]">
                    <span>{communityTypeLabels[leadPost.type]}</span>
                    {leadPost.date && <span>{leadPost.date}</span>}
                    {leadPost.byline && <span>{leadPost.byline}</span>}
                  </div>
                  {!leadPost.imageUrl && (
                    <h2 className="mt-3 text-4xl font-black leading-tight md:text-6xl">
                      <Link href={getPostHref(leadPost)} className="no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">
                        {leadPost.title}
                      </Link>
                    </h2>
                  )}
                  <p className="mt-4 text-lg leading-8 text-[color:var(--newsletter-muted)]">
                    {leadPost.summary}
                  </p>
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:flex-col">
                  <Button
                    asChild
                    size="lg"
                    style={{ backgroundColor: coop.bgColor }}
                    className="no-underline hover:no-underline"
                  >
                    <Link href={getPostHref(leadPost)}>
                      Read full article
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="border-[color:var(--newsletter-ink)] bg-transparent no-underline hover:border-[color:var(--coop-accent)] hover:text-[color:var(--coop-accent)] hover:no-underline"
                  >
                    <Link href={applicationUrl}>{coop.primaryCtaLabel}</Link>
                  </Button>
                </div>
              </div>
            </article>
          ) : (
            <article className="border-r-0 border-[color:var(--newsletter-ink)] pb-6 lg:border-r-2 lg:pr-6">
              <div className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--newsletter-kicker)]">
                Cover Story
              </div>
              <h2 className="mt-3 text-4xl font-black leading-tight md:text-6xl">
                {coop.title}
              </h2>
              <p className="mt-4 max-w-3xl text-lg leading-8 text-[color:var(--newsletter-muted)]">
                {aboutBody || coop.tagline || `Stories, events, and updates from ${coop.name} are coming soon.`}
              </p>
            </article>
          )}

          <aside className="grid gap-6">
            <div className="border-b-2 border-[color:var(--newsletter-ink)] pb-6">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--newsletter-kicker)]">
                The Mission
              </p>
              <h2 className="mt-3 text-3xl font-black leading-tight">
                {coop.title}
              </h2>
              {coop.tagline && (
                <p className="mt-3 text-base font-semibold leading-7 text-[color:var(--newsletter-muted)]">
                  {coop.tagline}
                </p>
              )}
              {aboutBody && (
                <p className="mt-3 text-sm leading-6 text-[color:var(--newsletter-muted)]">
                  {aboutBody}
                </p>
              )}
            </div>

          </aside>
        </div>
      </section>

      {(secondaryPosts.length > 0 || eventPosts.length > 0 || businessPosts.length > 0) && (
        <section id="stories" className="border-b-2 border-[color:var(--newsletter-ink)] bg-[var(--newsletter-panel)] px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-6 flex flex-col justify-between gap-3 border-b-2 border-[color:var(--newsletter-ink)] pb-3 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--newsletter-kicker)]">
                  Latest
                </p>
                <h2 className="mt-1 text-3xl font-black tracking-normal md:text-5xl">
                  {hasStoryPosts ? "Stories from the co-op." : "Latest from the co-op."}
                </h2>
                {!hasStoryPosts && (
                  <p className="mt-3 max-w-3xl text-base leading-7 text-[color:var(--newsletter-muted)] md:text-lg">
                    Events, business notes, notices, and community updates are the heartbeat of this issue.
                  </p>
                )}
              </div>
              <Link
                href={applicationUrl}
                className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-[color:var(--newsletter-kicker)] no-underline hover:text-[color:var(--newsletter-ink)] hover:no-underline"
              >
                Join the story
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className={hasStoryPosts ? "grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]" : "grid gap-8"}>
              {hasStoryPosts && (
                <div className="grid gap-5 sm:grid-cols-2">
                  {secondaryPosts.map((post, index) => (
                    <article key={`${post.title}-secondary-${index}`} className="border-b border-[color:var(--newsletter-rule)] pb-5">
                      {post.imageUrl && (
                        <Link href={getPostHref(post)} className="relative block aspect-[4/3] overflow-hidden bg-[var(--newsletter-soft)] no-underline hover:no-underline">
                          <FallbackImage
                            src={post.imageUrl}
                            alt={post.title}
                            fill
                            sizes="(min-width: 1024px) 33vw, 100vw"
                            className="object-cover"
                          />
                        </Link>
                      )}
                      <p className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-[color:var(--newsletter-kicker)]">
                        {communityTypeLabels[post.type]}
                      </p>
                      <h3 className="mt-2 text-2xl font-black leading-tight">
                        <Link href={getPostHref(post)} className="no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">
                          {post.title}
                        </Link>
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-[color:var(--newsletter-muted)]">{post.summary}</p>
                    </article>
                  ))}
                </div>
              )}

              {!hasStoryPosts && (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {updatePosts.map((post, index) => (
                    <article
                      key={`${post.title}-update-${index}`}
                      id={index === 0 && eventPosts.length > 0 ? "events" : undefined}
                      className="group border-b-2 border-[color:var(--newsletter-ink)] pb-6"
                    >
                      {post.imageUrl ? (
                        <Link href={getPostHref(post)} className="relative block aspect-[16/10] overflow-hidden bg-[var(--newsletter-soft)] no-underline hover:no-underline">
                          <FallbackImage
                            src={post.imageUrl}
                            alt={post.title}
                            fill
                            sizes="(min-width: 1024px) 33vw, 100vw"
                            className="object-cover transition duration-500 group-hover:scale-[1.02]"
                          />
                        </Link>
                      ) : (
                        <Link href={getPostHref(post)} className="flex aspect-[16/10] items-end bg-[var(--newsletter-ink)] p-5 text-white no-underline hover:no-underline">
                          <span className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--coop-accent)]">
                            {communityTypeLabels[post.type]}
                          </span>
                        </Link>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-black uppercase tracking-[0.16em] text-[color:var(--newsletter-kicker)]">
                        <span>{communityTypeLabels[post.type]}</span>
                        {post.date && <span>{post.date}</span>}
                      </div>
                      <h3 className="mt-2 text-2xl font-black leading-tight md:text-3xl">
                        <Link href={getPostHref(post)} className="no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">
                          {post.title}
                        </Link>
                      </h3>
                      <p className="mt-3 text-base leading-7 text-[color:var(--newsletter-muted)]">
                        {post.summary}
                      </p>
                      <Link
                        href={getPostHref(post)}
                        className="mt-4 inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-[color:var(--newsletter-kicker)] no-underline hover:text-[color:var(--newsletter-ink)] hover:no-underline"
                      >
                        Read update
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </article>
                  ))}
                </div>
              )}

	              {hasStoryPosts && (
	                <aside className="grid gap-8">
	                  {eventPosts.length > 0 && (
	                    <div id="events">
	                      <div className="flex items-center gap-2 border-b-2 border-[color:var(--newsletter-ink)] pb-2 text-sm font-black uppercase tracking-[0.14em]">
	                        <CalendarDays className="h-4 w-4 text-[color:var(--newsletter-kicker)]" />
	                        Events
	                      </div>
	                      <div className="mt-4 grid gap-4">
	                        {eventPosts.map((post, index) => (
	                          <article key={`${post.title}-event-${index}`} className="grid grid-cols-[88px_1fr] gap-3 border-b border-[color:var(--newsletter-rule)] pb-4 last:border-b-0">
	                            {post.imageUrl ? (
	                              <Link href={getPostHref(post)} className="relative block aspect-square overflow-hidden bg-[var(--newsletter-soft)] no-underline hover:no-underline">
	                                <FallbackImage
	                                  src={post.imageUrl}
	                                  alt={post.title}
	                                  fill
	                                  sizes="88px"
	                                  className="object-cover"
	                                />
	                              </Link>
	                            ) : (
	                              <div className="aspect-square bg-[var(--newsletter-soft)]" />
	                            )}
	                            <div>
	                              <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--newsletter-kicker)]">
	                                {post.date || "Upcoming"}
	                              </p>
	                              <h4 className="mt-1 font-black leading-tight">
	                                <Link href={getPostHref(post)} className="no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">
	                                  {post.title}
	                                </Link>
	                              </h4>
	                              <p className="mt-1 text-sm leading-5 text-[color:var(--newsletter-muted)]">{post.summary}</p>
	                            </div>
	                          </article>
	                        ))}
	                      </div>
	                    </div>
	                  )}

	                  {businessPosts.length > 0 && (
	                    <div>
	                      <div className="flex items-center gap-2 border-b-2 border-[color:var(--newsletter-ink)] pb-2 text-sm font-black uppercase tracking-[0.14em]">
	                        <Store className="h-4 w-4 text-[color:var(--newsletter-kicker)]" />
	                        Business Notes
	                      </div>
	                      <div className="mt-4 grid gap-4">
	                        {businessPosts.map((post, index) => (
	                          <article key={`${post.title}-business-${index}`} className="border-b border-[color:var(--newsletter-rule)] pb-4 last:border-b-0">
	                            <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--newsletter-kicker)]">
	                              Business
	                            </p>
	                            <h4 className="mt-1 text-lg font-black leading-tight">
	                              <Link href={getPostHref(post)} className="no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline">
	                                {post.title}
	                              </Link>
	                            </h4>
	                            <p className="mt-2 text-sm leading-5 text-[color:var(--newsletter-muted)]">{post.summary}</p>
	                          </article>
	                        ))}
	                      </div>
	                    </div>
	                  )}
	                </aside>
	              )}
            </div>
          </div>
        </section>
      )}

      {/* Classifieds */}
      <section id="classifieds" className="border-t bg-[var(--newsletter-soft)] py-12 text-[color:var(--newsletter-ink)] md:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 border-y-2 border-[color:var(--newsletter-ink)] py-4 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-[color:var(--newsletter-kicker)]">
              <Megaphone className="h-4 w-4" />
              Classifieds
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-normal md:text-5xl">
              Classifieds
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-[color:var(--newsletter-muted)] md:text-base">
              Member businesses, offers, goods, and services circulating through {coop.name}.
            </p>
          </div>

          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-2xl font-black tracking-tight md:text-3xl">
                Classifieds
              </h3>
              <p className="mt-1 text-sm text-[color:var(--newsletter-muted)]">
                Things to buy, book, support, or share from the co-op marketplace.
              </p>
            </div>
            <Button variant="outline" asChild className="border-[color:var(--newsletter-rule)] bg-transparent no-underline transition-colors hover:border-[color:var(--coop-accent)] hover:text-[color:var(--coop-accent)] hover:no-underline">
              <Link href={`/c/${coopId}/products`}>
                All Classifieds
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[color:var(--newsletter-rule)] bg-[var(--newsletter-panel)] py-10 text-center">
              <Megaphone className="h-9 w-9 text-[color:var(--newsletter-muted)]" />
              <h4 className="mt-3 text-lg font-black">No classifieds yet</h4>
              <p className="mt-2 max-w-md text-sm text-[color:var(--newsletter-muted)]">
                Products, services, and offers from co-op businesses will appear here.
              </p>
            </div>
          ) : (
            <FeaturedProducts products={products} coopSlug={coopId} />
          )}
        </div>
      </section>

      {faqs.length > 0 && (
        <section className="border-t py-12 md:py-16">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Questions Before You Apply
              </h2>
            </div>
            <div className="mt-8 grid gap-4">
              {faqs.map((faq, index) => (
                <div key={`${faq.question}-${index}`} className="rounded-lg border bg-card p-5">
                  <h3 className="font-semibold text-foreground">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="apply" className="border-t-2 border-[color:var(--newsletter-ink)] bg-[var(--newsletter-panel)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-7 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--newsletter-kicker)]">
                Membership Desk
              </div>
              <h2 className="mt-3 text-3xl font-black tracking-normal md:text-4xl">
                Become a {coop.name} Member
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--newsletter-muted)] md:text-lg">
                {eligibilityBody ||
                  "Apply to join the co-op, help shape what gets built, and stay connected to the people and businesses moving the community forward."}
              </p>
              {recruitmentFeatures.length > 0 && (
                <div className="mt-6 border-t-2 border-[color:var(--newsletter-ink)] pt-5">
                  <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em]">
                    <Sparkles className="h-4 w-4 text-[color:var(--newsletter-kicker)]" />
                    Why Apply
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {recruitmentFeatures.slice(0, 4).map((feature, index) => {
                      const icons = [Landmark, HeartHandshake, BadgeCheck, CheckCircle];
                      const Icon = icons[index] || CheckCircle;
                      return (
                        <div key={`${feature.title}-apply-${index}`} className="grid grid-cols-[auto_1fr] gap-3">
                          <Icon className="mt-1 h-4 w-4 text-[color:var(--newsletter-kicker)]" />
                          <div>
                            <h3 className="font-black">{feature.title}</h3>
                            <p className="mt-1 text-sm leading-5 text-[color:var(--newsletter-muted)]">{feature.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="border-2 border-[color:var(--newsletter-ink)] bg-[var(--newsletter-panel)] p-5 shadow-[6px_6px_0_var(--newsletter-ink)]">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-[color:var(--newsletter-kicker)]">
                {eligibilityTitle || "Who Should Apply"}
              </p>
              <h3 className="mt-3 text-xl font-black md:text-2xl">Ready to build with us?</h3>
              <p className="mt-3 text-sm leading-6 text-[color:var(--newsletter-muted)]">
                The application takes a few minutes. Tell the co-op who you are, why you want in, and how you want to participate.
              </p>
              <Button
                className="mt-6 w-full no-underline hover:no-underline"
                size="lg"
                asChild
                style={{ backgroundColor: coop.bgColor }}
              >
                <Link href={applicationUrl}>
                  {coop.primaryCtaLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} {coop.name}. Part of the{" "}
              {coop.name} network.
            </div>
            <div className="flex gap-6">
              <Link
                href={`/c/${coopId}/about`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                About
              </Link>
              <Link
                href={`/c/${coopId}/stores`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Stores
              </Link>
              <Link
                href={`/c/${coopId}/products`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Products
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

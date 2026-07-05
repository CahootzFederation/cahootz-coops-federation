import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";

import { FallbackImage } from "@/components/ui/fallback-image";
import { env } from "@/env";
import {
  MarkdownishArticle,
  communityTypeLabels,
  getCommunityPostSlug,
  normalizeCommunityPosts,
  normalizePreviewOverrides,
  withDevSampleCommunityPosts,
} from "../../newsletter-posts";

interface PageProps {
  params: Promise<{ coopId: string; slug: string }>;
}

async function getPublicCoopInfo(coopId: string) {
  if (!coopId) return null;

  try {
    const input = JSON.stringify({ coopId });
    const url = `${env.NEXT_PUBLIC_API_URL}/publicCoopInfo.getByCoopId?input=${encodeURIComponent(input)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.result.data;
  } catch (error) {
    console.error("Error fetching public coop info:", error);
    return null;
  }
}

async function getCoopConfig(coopId: string) {
  try {
    const input = JSON.stringify({ coopId });
    const url = `${env.NEXT_PUBLIC_API_URL}/coopConfig.getActive?input=${encodeURIComponent(input)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.result.data;
  } catch (error) {
    console.error("Error fetching coop config:", error);
    return null;
  }
}

function getNewsletterPosts(coopId: string, publicInfo: any) {
  const previewOverrides = normalizePreviewOverrides(publicInfo?.previewOverrides);
  return withDevSampleCommunityPosts(coopId, normalizeCommunityPosts(previewOverrides.communityPosts));
}

function findPostBySlug(posts: ReturnType<typeof getNewsletterPosts>, slug: string) {
  return posts
    .map((post, index) => ({ post, index, slug: getCommunityPostSlug(post, index) }))
    .find((item) => item.slug === slug);
}

function getReadingTime(post: ReturnType<typeof getNewsletterPosts>[number]) {
  const text = [post.title, post.summary, post.contentMarkdown].filter(Boolean).join(" ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 220))} min read`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { coopId, slug } = await params;
  const publicInfo = await getPublicCoopInfo(coopId);

  if (!publicInfo) {
    return { title: "Article not found" };
  }

  const posts = getNewsletterPosts(coopId, publicInfo);
  const match = findPostBySlug(posts, slug);

  if (!match) {
    return { title: "Article not found" };
  }

  const coopName = publicInfo.name || coopId;

  return {
    title: `${match.post.title} | ${coopName}`,
    description: match.post.summary,
    alternates: {
      canonical: `/c/${coopId}/articles/${slug}`,
    },
    openGraph: {
      type: "article",
      title: match.post.title,
      description: match.post.summary,
      url: `/c/${coopId}/articles/${slug}`,
      siteName: coopName,
      images: match.post.imageUrl ? [{ url: match.post.imageUrl, alt: match.post.title }] : undefined,
    },
    twitter: {
      card: match.post.imageUrl ? "summary_large_image" : "summary",
      title: match.post.title,
      description: match.post.summary,
      images: match.post.imageUrl ? [match.post.imageUrl] : undefined,
    },
  };
}

export default async function NewsletterArticlePage({ params }: PageProps) {
  const { coopId, slug } = await params;
  const publicInfo = await getPublicCoopInfo(coopId);

  if (!publicInfo) {
    notFound();
  }

  const coopConfig = await getCoopConfig(coopId);
  const posts = getNewsletterPosts(coopId, publicInfo);
  const match = findPostBySlug(posts, slug);

  if (!match) {
    notFound();
  }

  const post = match.post;
  const coopName = publicInfo.name || coopId;
  const primaryColorHex = coopConfig?.bgColor || publicInfo.primaryColor || "#ea580c";
  const accentColorHex = coopConfig?.accentColor || publicInfo.accentColor || "#d97706";
  const articleBody = post.contentMarkdown || post.summary;
  const relatedPosts = posts
    .map((item, index) => ({ post: item, index }))
    .filter((item) => item.index !== match.index)
    .slice(0, 2);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.summary,
    image: post.imageUrl,
    author: post.byline
      ? {
          "@type": "Organization",
          name: post.byline,
        }
      : undefined,
    publisher: {
      "@type": "Organization",
      name: coopName,
    },
    mainEntityOfPage: `/c/${coopId}/articles/${slug}`,
  };

  return (
    <main
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
      <article>
        <section className="border-b-2 border-[color:var(--newsletter-ink)] px-4 py-10 sm:px-6 md:py-14 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <Link
              href={`/c/${coopId}`}
              className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-[color:var(--newsletter-muted)] no-underline hover:text-[color:var(--newsletter-kicker)] hover:no-underline"
            >
              <ArrowLeft className="h-4 w-4" />
              {coopName} Newsletter
            </Link>

            <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-[color:var(--newsletter-muted)]">
              <span className="border border-[color:var(--newsletter-rule)] bg-[var(--newsletter-panel)] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[color:var(--newsletter-kicker)]">
                {communityTypeLabels[post.type]}
              </span>
              {post.date && <span>{post.date}</span>}
              {post.byline && <span>{post.byline}</span>}
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {getReadingTime(post)}
              </span>
            </div>

            <h1 className="mt-6 text-4xl font-black leading-tight tracking-normal md:text-6xl">
              {post.title}
            </h1>
            <p className="mt-6 text-xl leading-9 text-[color:var(--newsletter-muted)]">
              {post.summary}
            </p>
          </div>
        </section>

        {post.imageUrl && (
          <div className="relative aspect-[16/7] min-h-72 border-b-2 border-[color:var(--newsletter-ink)] bg-[var(--newsletter-soft)]">
            <FallbackImage
              src={post.imageUrl}
              alt={post.title}
              fill
              sizes="100vw"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
          </div>
        )}

        <section className="px-4 py-10 sm:px-6 md:py-14 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <MarkdownishArticle text={articleBody} />

            {(post.ctaUrl || post.sourceUrl) && (
              <Link
                href={post.ctaUrl || post.sourceUrl || "#"}
                className="mt-8 inline-flex items-center gap-2 border border-[color:var(--newsletter-rule)] bg-[var(--newsletter-panel)] px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-[color:var(--newsletter-kicker)] no-underline hover:border-[color:var(--coop-accent)] hover:text-[color:var(--newsletter-ink)] hover:no-underline"
              >
                {post.ctaLabel || (post.sourceUrl ? "Read source" : "Read more")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
        />
      </article>

      {relatedPosts.length > 0 && (
        <section className="border-t-2 border-[color:var(--newsletter-ink)] bg-[var(--newsletter-soft)] px-4 py-12 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-[color:var(--newsletter-kicker)]">
                  Keep Reading
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-normal md:text-5xl">
                  More from the issue.
                </h2>
              </div>
              <Link
                href={`/c/${coopId}`}
                className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-[color:var(--newsletter-kicker)] no-underline hover:text-[color:var(--newsletter-ink)] hover:no-underline"
              >
                Back to public page
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {relatedPosts.map(({ post: relatedPost, index }) => (
                <article key={`${relatedPost.title}-${index}`} className="overflow-hidden border border-[color:var(--newsletter-rule)] bg-[var(--newsletter-panel)]">
                  <Link href={`/c/${coopId}/articles/${getCommunityPostSlug(relatedPost, index)}`} className="block no-underline hover:no-underline">
                    {relatedPost.imageUrl && (
                      <div className="relative aspect-[16/9] bg-[var(--newsletter-soft)]">
                        <FallbackImage
                          src={relatedPost.imageUrl}
                          alt={relatedPost.title}
                          fill
                          sizes="(min-width: 768px) 50vw, 100vw"
                          className="object-cover"
                        />
                      </div>
                    )}
                    <div className="p-5">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[color:var(--newsletter-kicker)]">
                        {communityTypeLabels[relatedPost.type]}
                      </p>
                      <h3 className="mt-3 text-xl font-black leading-tight">
                        {relatedPost.title}
                      </h3>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-[color:var(--newsletter-muted)]">
                        {relatedPost.summary}
                      </p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

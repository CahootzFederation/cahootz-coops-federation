/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/env";

type CommunityPostType = "article" | "event" | "business" | "announcement";

interface CommunityPost {
  type: CommunityPostType;
  title: string;
  summary: string;
  date?: string;
  byline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  imageUrl?: string;
}

interface PreviewOverrides {
  newspaperTitle?: string;
  newspaperIntro?: string;
  newsletterEmailEnabled?: boolean;
  newsletterEmailSubject?: string;
  newsletterEmailPreheader?: string;
  communityPosts?: unknown;
  [key: string]: unknown;
}

interface PublicCoopInfo {
  name?: string | null;
  tagline?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  primaryCtaLabel?: string | null;
  primaryCtaUrl?: string | null;
  previewMode?: "live" | "curated" | "hybrid" | null;
  previewOverrides?: unknown;
}

interface StoreSummary {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  productCount?: number | null;
}

interface ProductSummary {
  id: string;
  name: string;
  description?: string | null;
  priceUSD?: number | null;
  imageUrl?: string | null;
  images?: string[] | null;
  store?: {
    name?: string | null;
  } | null;
}

interface PageProps {
  params: Promise<{ coopId: string }>;
}

const postTypeLabels: Record<CommunityPostType, string> = {
  article: "Story",
  event: "Event",
  business: "Business",
  announcement: "Notice",
};

export const metadata: Metadata = {
  title: "Newsletter Email Preview",
  robots: {
    index: false,
    follow: false,
  },
};

function normalizePreviewOverrides(value: unknown): PreviewOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PreviewOverrides)
    : {};
}

function normalizeCommunityPosts(value: unknown): CommunityPost[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((post): post is CommunityPost => {
      return (
        typeof post === "object" &&
        post !== null &&
        "title" in post &&
        "summary" in post &&
        typeof post.title === "string" &&
        typeof post.summary === "string" &&
        post.title.trim().length > 0 &&
        post.summary.trim().length > 0
      );
    })
    .map((post) => {
      const type = ["article", "event", "business", "announcement"].includes(post.type)
        ? post.type
        : "article";

      return {
        type,
        title: post.title.trim(),
        summary: post.summary.trim(),
        date: post.date?.trim() || undefined,
        byline: post.byline?.trim() || undefined,
        ctaLabel: post.ctaLabel?.trim() || undefined,
        ctaUrl: post.ctaUrl?.trim() || undefined,
        imageUrl: post.imageUrl?.trim() || undefined,
      };
    });
}

function getSiteOrigin() {
  const configured = env.NEXT_PUBLIC_URI || env.NEXT_PUBLIC_DOMAIN;
  if (!configured) return "http://localhost:3000";
  return configured.startsWith("http") ? configured.replace(/\/$/, "") : `https://${configured}`;
}

function absoluteHref(href: string) {
  if (/^(https?:|mailto:|tel:)/.test(href)) return href;
  const origin = getSiteOrigin();
  return href.startsWith("/") ? `${origin}${href}` : `${origin}/${href}`;
}

function getProductImageUrl(product: ProductSummary) {
  const imageUrl =
    product.imageUrl ||
    product.images?.find((image) => typeof image === "string" && image.trim().length > 0);

  return imageUrl ? absoluteHref(imageUrl) : null;
}

async function trpcGet<T>(path: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const url = `${apiUrl}/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.result?.data ?? null;
  } catch (error) {
    console.error(`Error fetching ${path}:`, error);
    return null;
  }
}

async function getFeaturedProducts(coopId: string) {
  const data = await trpcGet<{ products?: ProductSummary[] }>("store.getProducts", { coopId, limit: 6 });
  const products = data?.products ?? [];
  const featured = products.filter((product) => Boolean((product as ProductSummary & { isFeatured?: boolean }).isFeatured));
  return featured.length > 0 ? featured.slice(0, 4) : products.slice(0, 4);
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main style={{ backgroundColor: "#e5e7eb", padding: "32px 12px", minHeight: "100vh" }}>
      <div style={{ margin: "0 auto", maxWidth: 680 }}>{children}</div>
    </main>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: "0 0 14px", color: "#111827", fontSize: 22, lineHeight: "28px" }}>
      {children}
    </h2>
  );
}

export default async function NewsletterEmailPreviewPage({ params }: PageProps) {
  const { coopId } = await params;
  const publicInfo = await trpcGet<PublicCoopInfo>("publicCoopInfo.getByCoopId", { coopId });

  if (!publicInfo) {
    notFound();
  }

  const name = publicInfo.name || coopId;
  const previewMode = publicInfo.previewMode || "hybrid";
  const previewOverrides = normalizePreviewOverrides(publicInfo.previewOverrides);
  const communityPosts = normalizeCommunityPosts(previewOverrides.communityPosts);
  const previewData = await trpcGet<{ stores?: StoreSummary[] }>("publicCoopInfo.getPreviewData", {
    coopId,
    previewMode,
    storeLimit: 4,
    proposalLimit: 1,
  });
  const products = await getFeaturedProducts(coopId);
  const stores = previewData?.stores?.slice(0, 4) ?? [];

  const emailEnabled = previewOverrides.newsletterEmailEnabled === true;
  const newsletterTitle =
    typeof previewOverrides.newsletterEmailSubject === "string" && previewOverrides.newsletterEmailSubject.trim()
      ? previewOverrides.newsletterEmailSubject.trim()
      : typeof previewOverrides.newspaperTitle === "string" && previewOverrides.newspaperTitle.trim()
        ? previewOverrides.newspaperTitle.trim()
        : `${name} Weekly Newsletter`;
  const preheader =
    typeof previewOverrides.newsletterEmailPreheader === "string" && previewOverrides.newsletterEmailPreheader.trim()
      ? previewOverrides.newsletterEmailPreheader.trim()
      : typeof previewOverrides.newspaperIntro === "string" && previewOverrides.newspaperIntro.trim()
        ? previewOverrides.newspaperIntro.trim()
        : `Stories, events, classifieds, and business notes from ${name}.`;
  const primaryColor = publicInfo.primaryColor || "#f59e0b";
  const accentColor = publicInfo.accentColor || "#ea580c";
  const applicationHref = absoluteHref(publicInfo.primaryCtaUrl || `/${coopId}/application`);
  const ctaLabel = publicInfo.primaryCtaLabel || "Apply to Join";
  const leadPost = communityPosts[0];
  const secondaryPosts = communityPosts.slice(1, 6);

  const cardStyle: CSSProperties = {
    backgroundColor: "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: 18,
  };

  return (
    <Shell>
      {!emailEnabled && (
        <div
          style={{
            marginBottom: 16,
            border: "1px solid #f59e0b",
            borderRadius: 6,
            backgroundColor: "#fffbeb",
            color: "#78350f",
            padding: 14,
            fontFamily: "Arial, sans-serif",
            fontSize: 14,
          }}
        >
          Weekly email is off. Turn it on in the co-op public page settings when this issue is ready to send.
        </div>
      )}

      <article
        style={{
          overflow: "hidden",
          borderRadius: 8,
          backgroundColor: "#ffffff",
          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.16)",
          color: "#111827",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>
          {preheader}
        </div>
        <div
          style={{
            background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
            color: "#ffffff",
            padding: "34px 28px",
            textAlign: "center",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
            Community Newsletter
          </p>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: "40px" }}>{newsletterTitle}</h1>
          <p style={{ margin: "12px auto 0", maxWidth: 520, fontSize: 16, lineHeight: "24px" }}>{preheader}</p>
        </div>

        <div style={{ padding: "28px", backgroundColor: "#f7f0df" }}>
          {leadPost ? (
            <div style={cardStyle}>
              <p style={{ margin: "0 0 8px", color: "#92400e", fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
                {postTypeLabels[leadPost.type]}
                {leadPost.date ? ` | ${leadPost.date}` : ""}
              </p>
              {leadPost.imageUrl && (
                <img
                  src={leadPost.imageUrl}
                  alt={leadPost.title}
                  style={{ display: "block", marginBottom: 16, width: "100%", borderRadius: 6 }}
                />
              )}
              <h2 style={{ margin: "0 0 10px", color: "#111827", fontSize: 28, lineHeight: "34px" }}>
                {leadPost.title}
              </h2>
              {leadPost.byline && (
                <p style={{ margin: "0 0 12px", color: "#6b7280", fontSize: 13 }}>{leadPost.byline}</p>
              )}
              <p style={{ margin: 0, color: "#374151", fontSize: 16, lineHeight: "25px" }}>{leadPost.summary}</p>
              {leadPost.ctaUrl && (
                <p style={{ margin: "18px 0 0" }}>
                  <a href={absoluteHref(leadPost.ctaUrl)} style={{ color: accentColor, fontWeight: 700 }}>
                    {leadPost.ctaLabel || "Read more"}
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div style={cardStyle}>
              <h2 style={{ margin: "0 0 10px", color: "#111827", fontSize: 24 }}>This issue is getting ready</h2>
              <p style={{ margin: 0, color: "#374151", fontSize: 15, lineHeight: "24px" }}>
                Add a story, event, business note, or notice in the portal to build the email version.
              </p>
            </div>
          )}

          {secondaryPosts.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <SectionTitle>More From the Co-op</SectionTitle>
              <div style={{ display: "grid", gap: 12 }}>
                {secondaryPosts.map((post, index) => (
                  <div key={`${post.title}-${index}`} style={cardStyle}>
                    <p style={{ margin: "0 0 6px", color: "#92400e", fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase" }}>
                      {postTypeLabels[post.type]}
                      {post.date ? ` | ${post.date}` : ""}
                    </p>
                    <h3 style={{ margin: "0 0 8px", color: "#111827", fontSize: 18, lineHeight: "24px" }}>{post.title}</h3>
                    <p style={{ margin: 0, color: "#4b5563", fontSize: 14, lineHeight: "22px" }}>{post.summary}</p>
                    {post.ctaUrl && (
                      <p style={{ margin: "12px 0 0" }}>
                        <a href={absoluteHref(post.ctaUrl)} style={{ color: accentColor, fontWeight: 700 }}>
                          {post.ctaLabel || "Read more"}
                        </a>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 22 }}>
            <SectionTitle>Classifieds</SectionTitle>
            {products.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {products.map((product) => {
                  const productImageUrl = getProductImageUrl(product);

                  return (
                    <a
                      key={product.id}
                      href={absoluteHref(`/c/${coopId}/product/${product.id}`)}
                      style={{ ...cardStyle, display: "block", color: "#111827", textDecoration: "none" }}
                    >
                      <table role="presentation" cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse" }}>
                        <tbody>
                          <tr>
                            {productImageUrl && (
                              <td style={{ width: 112, paddingRight: 14, verticalAlign: "top" }}>
                                <img
                                  src={productImageUrl}
                                  alt={product.name}
                                  width={96}
                                  height={96}
                                  style={{
                                    display: "block",
                                    width: 96,
                                    height: 96,
                                    borderRadius: 6,
                                    objectFit: "cover",
                                    border: "1px solid #d1d5db",
                                  }}
                                />
                              </td>
                            )}
                            <td style={{ verticalAlign: "top" }}>
                              <strong style={{ display: "block", fontSize: 17 }}>{product.name}</strong>
                              {product.store?.name && (
                                <span style={{ display: "block", marginTop: 4, color: "#6b7280", fontSize: 13 }}>
                                  {product.store.name}
                                </span>
                              )}
                              {product.description && (
                                <span style={{ display: "block", marginTop: 8, color: "#4b5563", fontSize: 14, lineHeight: "21px" }}>
                                  {product.description}
                                </span>
                              )}
                              {typeof product.priceUSD === "number" && (
                                <span style={{ display: "block", marginTop: 10, color: accentColor, fontWeight: 700 }}>
                                  ${product.priceUSD.toFixed(2)}
                                </span>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p style={{ margin: 0, color: "#4b5563", fontSize: 14, lineHeight: "22px" }}>
                Classifieds from the co-op marketplace will appear here.
              </p>
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <SectionTitle>Business Directory</SectionTitle>
            {stores.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {stores.map((store) => (
                  <a
                    key={store.id}
                    href={absoluteHref(`/c/${coopId}/store/${store.id}`)}
                    style={{ ...cardStyle, display: "block", color: "#111827", textDecoration: "none" }}
                  >
                    <strong style={{ display: "block", fontSize: 17 }}>{store.name}</strong>
                    {store.category && (
                      <span style={{ display: "block", marginTop: 4, color: "#92400e", fontSize: 12, fontWeight: 700 }}>
                        {store.category}
                      </span>
                    )}
                    {store.description && (
                      <span style={{ display: "block", marginTop: 8, color: "#4b5563", fontSize: 14, lineHeight: "21px" }}>
                        {store.description}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: "#4b5563", fontSize: 14, lineHeight: "22px" }}>
                Approved co-op businesses will appear here as the directory grows.
              </p>
            )}
          </div>

          <div style={{ marginTop: 26, textAlign: "center" }}>
            <a
              href={applicationHref}
              style={{
                display: "inline-block",
                borderRadius: 6,
                backgroundColor: accentColor,
                color: "#ffffff",
                fontSize: 16,
                fontWeight: 700,
                padding: "14px 22px",
                textDecoration: "none",
              }}
            >
              {ctaLabel}
            </a>
          </div>
        </div>

        <div style={{ backgroundColor: "#111827", color: "#d1d5db", padding: "18px 28px", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: "18px" }}>
            You are receiving this because you are connected to {name}. Visit the public newsletter at{" "}
            <a href={absoluteHref(`/c/${coopId}`)} style={{ color: "#ffffff" }}>
              {absoluteHref(`/c/${coopId}`)}
            </a>
            .
          </p>
        </div>
      </article>
    </Shell>
  );
}

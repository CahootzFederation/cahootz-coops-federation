import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Building2,
  MapPin,
  Users,
  Store,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FallbackImage } from "@/components/ui/fallback-image";
import { CoopHero } from "./components/coop-hero";
import { StoreCard } from "./components/store-card";
import { FeaturedProducts } from "./components/featured-products";
import { JoinWaitlistForm } from "./components/join-waitlist-form";
import { TrackPageView } from "./components/track-page-view";
import { env } from "@/env";

const TEMP_PUBLIC_MEMBER_COUNT_FALLBACK = 320;
const DEFAULT_PUBLIC_HERO_TITLE = "Build Generative Wealth Together";
const DEFAULT_PUBLIC_HERO_SUBTITLE =
  "A member-owned marketplace for turning local spending into shared economic power.";
const DEFAULT_PUBLIC_HERO_DESCRIPTION =
  "Shop from coop businesses, apply for membership, and help grow a community wealth fund that supports members, stores, and the tools this economy needs.";

function isLegacyPublicHeroCopy(value?: string | null) {
  return Boolean(value?.toLowerCase().includes("cooperative for economic empowerment"));
}

function getPublicHeroSubtitle(value?: string | null) {
  return isLegacyPublicHeroCopy(value) ? DEFAULT_PUBLIC_HERO_SUBTITLE : value || DEFAULT_PUBLIC_HERO_SUBTITLE;
}

function getPublicHeroDescription(value?: string | null) {
  return isLegacyPublicHeroCopy(value)
    ? DEFAULT_PUBLIC_HERO_DESCRIPTION
    : value || DEFAULT_PUBLIC_HERO_DESCRIPTION;
}

async function getPublicCoopInfo(coopId: string) {
  if(!coopId) {
    return null;
  }
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const input = JSON.stringify({ coopId });
    const url = `${apiUrl}/publicCoopInfo.getByCoopIdWithUnpublished?input=${encodeURIComponent(input)}`;
    
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

async function getPublicApps(coopId: string) {
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const input = JSON.stringify({ coopId });
    const url = `${apiUrl}/coopApps.listPublic?input=${encodeURIComponent(input)}`;

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
    return data.result.data || [];
  } catch (error) {
    console.error('Error fetching public apps:', error);
    return [];
  }
}

async function getDirectoryBusinesses(coopId: string) {
  try {
    const apiUrl = env.NEXT_PUBLIC_API_URL;
    const input = JSON.stringify({ coopId, limit: 4 });
    const url = `${apiUrl}/directory.listPublic?input=${encodeURIComponent(input)}`;

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
    return data.result?.data?.businesses || [];
  } catch (error) {
    console.error('Error fetching directory businesses:', error);
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
  const title = publicInfo.heroTitle || publicInfo.tagline || DEFAULT_PUBLIC_HERO_TITLE;
  const description = getPublicHeroSubtitle(publicInfo.heroSubtitle);

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
  const publicApps = await getPublicApps(coopId);
  const directoryEnabled = publicApps.some((app: any) => app.key === 'directory');
  const directoryBusinesses = directoryEnabled ? await getDirectoryBusinesses(coopId) : [];
  const liveStats = previewData?.stats ?? {};
  const liveMemberCount = Number(liveStats.memberCount ?? 0);
  const liveProductCount = Number(liveStats.productCount ?? 0);
  
  // Colors are stored as hex values like "#16a34a"
  // Create gradient from primary and accent colors
  const primaryColorHex = coopConfig?.bgColor || '#ea580c'; // orange-600
  const accentColorHex = coopConfig?.accentColor || '#d97706'; // amber-600
  
  // Create inline style for gradient background
  const gradientStyle = {
    background: `linear-gradient(to bottom right, ${primaryColorHex}, ${accentColorHex})`,
  };
  
  // Transform publicInfo to match expected coop structure
  const coop = {
    id: coopId,
    slug: coopId,
    name: publicInfo.name || coopId,
    title: publicInfo.heroTitle || publicInfo.tagline || DEFAULT_PUBLIC_HERO_TITLE,
    tagline: getPublicHeroSubtitle(publicInfo.heroSubtitle),
    description: getPublicHeroDescription(publicInfo.aboutBody),
    mission: publicInfo.missionBody || '',
    bgColor: primaryColorHex,
    accentColor: accentColorHex,
    gradientStyle, // Inline style object for gradient backgrounds
    features: (publicInfo.features as any[] | null) ?? [],
    // Temporary public display floor while early member data is still being
    // backfilled. Remove once live membership numbers are ready to show.
    memberCount: Math.max(liveMemberCount, TEMP_PUBLIC_MEMBER_COUNT_FALLBACK),
    storeCount: Number(liveStats.storeCount ?? previewData?.stores?.length ?? 0),
    totalProducts: liveProductCount || featuredProducts.length,
    stats: {
      treasurySize: '$0', // TODO: Get from treasury
      proposalsFunded: 0, // TODO: Get from proposals
      averageDiscount: '15%',
    },
  };

  // Use preview data for stores. When no preview data is available (e.g.
  // curated mode or fetch failure), render an empty list rather than crash.
  const stores = (previewData?.stores ?? []).map((store: any) => ({
    id: store.id,
    name: store.name,
    description: store.description || '',
    category: store.category || 'OTHER',
    imageUrl: store.imageUrl || null,
    rating: 0, // TODO: Get from reviews
    reviewCount: 0,
    productCount: Number(store.productCount ?? 0),
    isScVerified: Boolean(store.isScVerified),
    isFeatured: Boolean(store.isFeatured),
  }));

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
    <div className="min-h-screen bg-background">
      <TrackPageView event="coop_landing_viewed" properties={{ coop_id: coopId, coop_name: coop.name }} />
      {/* Hero Section */}
      <CoopHero coop={coop} />

      {/* Stats Bar - conditionally rendered based on showStatsBar */}
      {publicInfo.showStatsBar && (
        <section className="border-b bg-card">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground md:text-3xl">
                  {coop.memberCount.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Members</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground md:text-3xl">
                  {coop.storeCount}
                </div>
                <div className="text-sm text-muted-foreground">Stores</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground md:text-3xl">
                  {coop.totalProducts}
                </div>
                <div className="text-sm text-muted-foreground">Products</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Apps Section */}
      {publicApps.length > 0 && (
        <section className="border-b bg-muted/20 py-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-7">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  Explore {coop.name}
                </h2>
                <p className="mt-1 text-muted-foreground">
                  Open public apps and resources from this cooperative
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-7 gap-y-8 sm:gap-x-9">
              {publicApps.map((app: any) => {
                const href = app.key === 'directory'
                  ? `/c/${coopId}/directory`
                  : `/c/${coopId}/products`;
                const Icon = app.key === 'directory' ? MapPin : Store;
                const iconStyle = app.key === 'directory'
                  ? { background: `linear-gradient(145deg, ${accentColorHex}, ${primaryColorHex})` }
                  : { background: `linear-gradient(145deg, ${primaryColorHex}, ${accentColorHex})` };

                return (
                  <Link
                    key={app.key}
                    href={href}
                    className="group w-24 text-center sm:w-28"
                    aria-label={`Open ${app.name}`}
                  >
                    <div
                      className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.6rem] text-white shadow-lg shadow-black/10 ring-1 ring-white/60 transition-transform group-hover:-translate-y-1 group-hover:shadow-xl sm:h-24 sm:w-24 sm:rounded-[1.85rem]"
                      style={iconStyle}
                    >
                      <Icon className="h-9 w-9 sm:h-10 sm:w-10" strokeWidth={2.25} />
                    </div>
                    <span className="mt-2 block text-sm font-semibold leading-tight text-foreground">
                      {app.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Directory Section */}
      {directoryEnabled && (
        <section className="border-b py-12 md:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                  Local Business Directory
                </h2>
                <p className="mt-1 text-muted-foreground">
                  Businesses and services connected to {coop.name}
                </p>
              </div>
              <Button variant="outline" asChild className="hover:border-[var(--coop-accent)] hover:text-[var(--coop-accent)] transition-colors">
                <Link href={`/c/${coopId}/directory`}>
                  View Directory
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>

            {directoryBusinesses.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 py-12 text-center">
                <Building2 className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">No directory businesses yet</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Local businesses added by coop admins will show up here.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {directoryBusinesses.map((business: any) => (
                  <Link
                    key={business.id}
                    href={`/c/${coopId}/directory`}
                    className="group overflow-hidden rounded-lg border bg-card transition-all hover:border-[var(--coop-accent)] hover:shadow-md"
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Building2 className="h-10 w-10 text-muted-foreground/40" />
                      </div>
                      {business.imageUrl && (
                        <FallbackImage
                          src={business.imageUrl}
                          alt={business.name}
                          fill
                          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                          className="object-cover transition-transform group-hover:scale-105"
                        />
                      )}
                      {business.isFeatured && (
                        <Badge className="absolute left-3 top-3">Featured</Badge>
                      )}
                    </div>
                    <div className="space-y-3 p-4">
                      <div>
                        <h3 className="line-clamp-1 font-semibold text-foreground">{business.name}</h3>
                        {business.category && (
                          <p className="mt-1 text-sm text-muted-foreground">{business.category}</p>
                        )}
                      </div>
                      {business.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {business.description}
                        </p>
                      )}
                      {[business.city, business.state].filter(Boolean).length > 0 && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span className="line-clamp-1">
                            {[business.city, business.state].filter(Boolean).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Featured Products Section */}
      <section className="py-12 md:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Shop {coop.name} Businesses
              </h2>
              <p className="mt-1 text-muted-foreground">
                Products from stores participating in the cooperative marketplace
              </p>
            </div>
            <Button variant="outline" asChild className="hover:border-[var(--coop-accent)] hover:text-[var(--coop-accent)] transition-colors">
              <Link href={`/c/${coopId}/products`}>
                View All
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 py-12 text-center">
              <Store className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold text-foreground">No products yet</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Products from approved marketplace stores will show up here.
              </p>
            </div>
          ) : (
            <FeaturedProducts products={products} coopSlug={coopId} />
          )}
        </div>
      </section>

      {/* Stores Section */}
      <section className="border-t bg-muted/30 py-12 md:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Member Marketplace
              </h2>
              <p className="mt-1 text-muted-foreground">
                Businesses selling through {coop.name} and helping circulate value locally
              </p>
            </div>
            <Button variant="outline" asChild className="hover:border-[var(--coop-accent)] hover:text-[var(--coop-accent)] transition-colors">
              <Link href={`/c/${coopId}/stores`}>
                All Stores
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          {stores.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
              <Store className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold text-foreground">No stores yet</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Approved stores from this co-op will show up here. Check back soon.
              </p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {stores.map((store: any) => (
                <StoreCard key={store.id} store={store} coopSlug={coopId} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Join Section */}
      <section className="py-12 md:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-2xl" style={coop.gradientStyle}>
            <div className="grid items-center gap-8 p-8 md:grid-cols-2 md:p-12">
              <div className="text-white">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                  Become a {coop.name} Member
                </h2>
                <p className="mt-4 text-lg text-white/90">
                  Apply to join {coop.name} and participate in a marketplace
                  built around ownership, rewards, local businesses, and shared
                  decision-making.
                </p>
                {coop.features.length > 0 ? (
                  <ul className="mt-6 space-y-3">
                    {coop.features.map((feature: any, index: number) => (
                      <li key={index} className="flex items-center gap-2">
                        <div className="rounded-full bg-white/20 p-1">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <span>{feature.title}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="mt-6 space-y-3">
                    <li className="flex items-center gap-2">
                      <div className="rounded-full bg-white/20 p-1">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <span>Earn rewards when you shop with coop businesses</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="rounded-full bg-white/20 p-1">
                        <Users className="h-4 w-4" />
                      </div>
                      <span>Vote on proposals that shape the coop</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="rounded-full bg-white/20 p-1">
                        <Store className="h-4 w-4" />
                      </div>
                      <span>Support businesses building community wealth</span>
                    </li>
                  </ul>
                )}
              </div>
              <JoinWaitlistForm coopId={coop.id} coopName={coop.name} primaryColor={coop.bgColor} />
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
              {directoryEnabled && (
                <Link
                  href={`/c/${coopId}/directory`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Directory
                </Link>
              )}
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

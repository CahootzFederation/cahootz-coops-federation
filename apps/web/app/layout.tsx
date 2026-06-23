import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import Script from "next/script";

import "./globals.css";
import { PostHogIdentity } from "@/components/posthog-identity";
import { PostHogProvider } from "@/components/posthog-provider";
import { PostHogPageView } from "@/components/posthog-pageview";
import { TRPCProvider } from "@/lib/trpc/provider";
import { Web3Provider } from "@/lib/web3-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://cahootz.coop"),
  title: "Cahootz | The App for Community-Owned Economies",
  description:
    "Join a co-op, support local businesses, earn participation rewards, vote on proposals, and fund the tools your community needs.",
  keywords: [
    "cooperative economy",
    "community wealth building",
    "cooperative economics",
    "member-owned marketplace",
    "local businesses",
    "co-op membership",
    "community governance",
    "community investment",
    "shared ownership",
  ],
  authors: [{ name: "Cahootz" }],
  creator: "Cahootz",
  publisher: "Cahootz",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://cahootz.coop",
    siteName: "Cahootz",
    title: "Cahootz | The App for Community-Owned Economies",
    description:
      "Join a co-op, support local businesses, earn participation rewards, vote on proposals, and fund the tools your community needs.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cahootz | The App for Community-Owned Economies",
    description:
      "Join a co-op, support local businesses, earn participation rewards, vote on proposals, and fund the tools your community needs.",
  },
  alternates: {
    canonical: "https://cahootz.coop",
  },
  category: "finance",
  classification: "Business",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "theme-color": "#1e293b",
  },
  generator: "v0.dev",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Additional SEO meta tags */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1e293b" />
        <meta name="msapplication-TileColor" content="#1e293b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />

        {/* Structured Data for Rich Snippets */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Cahootz",
              description:
                "A platform for member-owned co-ops that connects applications, local marketplaces, governance, rewards, and shared community investment.",
              url: "https://cahootz.coop",
              logo: "https://cahootz.coop/cahootz-coops-mark.svg",
              foundingDate: "2024",
              sameAs: [],
              contactPoint: {
                "@type": "ContactPoint",
                contactType: "customer service",
                email: "hello@cahootz.coop",
              },
              areaServed: "United States",
              knowsAbout: [
                "Cooperative Economics",
                "Community Wealth Building",
                "Member-Owned Marketplaces",
                "Community Governance",
                "Local Business Networks",
              ],
            }),
          }}
        />

        {/* Preconnect to external domains for performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />

        {/* Favicon and app icons */}
        <link rel="icon" href="/favicon.ico" />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon-16x16.png"
        />
        <link rel="manifest" href="/site.webmanifest" />
      </head>
      <body className={inter.className}>
        <Script
          async
          src="https://www.usetina.com/tina.js"
          data-site-key="tina_dCbAoHEO1ISRi3XI_Hg9MG_Y"
          strategy="afterInteractive"
        />
        <PostHogProvider>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <PostHogIdentity />
          <Web3Provider>
            <TRPCProvider>
              {children}
            </TRPCProvider>
          </Web3Provider>
        </PostHogProvider>
      </body>
    </html>
  );
}

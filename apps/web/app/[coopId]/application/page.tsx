import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, Handshake, Landmark, Route } from "lucide-react";

import { MemberApplicationFlow } from "@/components/member-application-flow";
import { env } from "@/env";

interface PageProps {
  params: Promise<{ coopId: string }>;
}

interface PublicCoopInfo {
  name?: string | null;
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  aboutBody?: string | null;
  missionBody?: string | null;
  features?: unknown;
}

interface CoopConfigInfo {
  coopId: string;
  name?: string | null;
  tagline?: string | null;
  description?: string | null;
  displayMission?: string | null;
  displayFeatures?: unknown;
  eligibility?: string | null;
  bgColor?: string | null;
  accentColor?: string | null;
}

const DEFAULT_CAHOOTZ_DESCRIPTION =
  "Cahootz Commons are member-owned economic communities built to help people create more stability, ownership, and opportunity together. Members support businesses, projects, and services inside their commons while helping fund long-term investments like housing, infrastructure, education, and new businesses. By joining, you become part of a network focused on building shared economic power instead of isolated survival.";

async function fetchTrpc<T>(path: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const url = `${env.NEXT_PUBLIC_API_URL}/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.result.data as T;
  } catch (error) {
    console.error(`Error fetching ${path}:`, error);
    return null;
  }
}

function normalizeFeatures(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((feature): feature is { title: string; description: string } => {
      return (
        typeof feature === "object" &&
        feature !== null &&
        "title" in feature &&
        "description" in feature &&
        typeof feature.title === "string" &&
        typeof feature.description === "string"
      );
    })
    .slice(0, 3);
}

async function getApplicationPageData(coopId: string) {
  const [publicInfo, coopConfig] = await Promise.all([
    fetchTrpc<PublicCoopInfo>("publicCoopInfo.getByCoopIdWithUnpublished", { coopId }),
    fetchTrpc<CoopConfigInfo>("coopConfig.getActive", { coopId }),
  ]);

  return { publicInfo, coopConfig };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { coopId } = await params;
  const { publicInfo, coopConfig } = await getApplicationPageData(coopId);
  const name = publicInfo?.name || coopConfig?.name || coopId;
  const title = `Apply to ${name}`;
  const description = `Membership application for ${name}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/${coopId}/application`,
    },
    openGraph: {
      title,
      description,
      url: `/${coopId}/application`,
      siteName: "Cahootz",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function CoopApplicationPage({ params }: PageProps) {
  const { coopId } = await params;
  const { publicInfo, coopConfig } = await getApplicationPageData(coopId);

  if (!publicInfo && !coopConfig) {
    notFound();
  }

  const name = publicInfo?.name || coopConfig?.name || coopId;
  const tagline =
    publicInfo?.heroSubtitle ||
    coopConfig?.tagline ||
    "Apply for membership in a commons built around shared ownership.";
  const description = publicInfo?.aboutBody || coopConfig?.description || DEFAULT_CAHOOTZ_DESCRIPTION;
  const mission = publicInfo?.missionBody || coopConfig?.displayMission || description;
  const configFeatures = normalizeFeatures(coopConfig?.displayFeatures);
  const features = configFeatures;
  const accentColor = coopConfig?.accentColor?.startsWith("#") ? coopConfig.accentColor : "#d97706";

  const lockedCoop = {
    id: coopId,
    name,
    tagline,
    description,
    mission,
    features,
    eligibility:
      coopConfig?.eligibility ||
      "Open to applicants who align with the commons mission and community standards.",
    bgColor: coopConfig?.bgColor || "#0f766e",
    accentColor,
  };

  return (
    <main className="min-h-screen bg-[#f7f3ea] text-[#121212]">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-8 px-4 py-5 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
        <section className="flex flex-col justify-between gap-8 py-2 lg:py-6">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-bold text-[#121212]/65 transition hover:text-[#121212]"
            >
              <ArrowLeft className="h-4 w-4" />
              Cahootz home
            </Link>

            <div className="mt-10 max-w-xl">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-[#0f766e]">
                Membership application
              </p>
              <h1 className="mt-4 text-4xl font-black leading-[1.02] text-[#121212] sm:text-5xl lg:text-6xl">
                Apply to {name}
              </h1>
              <p className="mt-5 text-lg leading-8 text-[#121212]/72">{tagline}</p>
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-lg border border-[#121212]/10 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-[#a16207]">
                <Handshake className="h-4 w-4" />
                Powered by Cahootz
              </div>
              <p className="mt-3 text-sm leading-6 text-[#121212]/68">{DEFAULT_CAHOOTZ_DESCRIPTION}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                { icon: BadgeCheck, title: "Apply", body: "Share your basic profile and member answers." },
                { icon: Route, title: "Review", body: "Your commons receives it in the application queue." },
                { icon: Landmark, title: "Join", body: "Approved members can participate in the commons economy." },
              ].map((item) => (
                <div key={item.title} className="rounded-lg border border-[#121212]/10 bg-white p-4">
                  <item.icon className="h-5 w-5" style={{ color: accentColor }} />
                  <p className="mt-3 text-sm font-black">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[#121212]/62">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center py-2 lg:py-6">
          <div className="w-full">
            <MemberApplicationFlow
              lockedCoop={lockedCoop}
              lockedCoopId={coopId}
              successRedirectDelayMs={10000}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

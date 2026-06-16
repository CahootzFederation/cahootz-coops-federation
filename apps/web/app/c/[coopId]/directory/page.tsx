import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Building2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { env } from "@/env";
import type { DirectoryBusiness } from "./directory-results";
import { DirectoryResults } from "./directory-results";
import { getPublicCoopDisplayName } from "../public-coop-data";

interface PageProps {
  params: Promise<{ coopId: string }>;
  searchParams: Promise<{ search?: string; category?: string }>;
}

async function getDirectoryBusinesses(coopId: string, search?: string, category?: string) {
  try {
    const input = JSON.stringify({
      coopId,
      search: search || undefined,
      category: category || undefined,
      limit: 100,
    });
    const url = `${env.NEXT_PUBLIC_API_URL}/directory.listPublic?input=${encodeURIComponent(input)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return (data.result?.data?.businesses || []) as DirectoryBusiness[];
  } catch (error) {
    console.error("Error fetching directory businesses:", error);
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { coopId } = await params;
  const coopName = await getPublicCoopDisplayName(coopId);

  return {
    title: `Directory | ${coopName}`,
    description: `Browse local businesses connected to ${coopName}`,
  };
}

export default async function DirectoryPage({ params, searchParams }: PageProps) {
  const { coopId } = await params;
  const { search, category } = await searchParams;
  const coopName = await getPublicCoopDisplayName(coopId);
  const businesses = await getDirectoryBusinesses(coopId, search, category);
  const categories = Array.from(
    new Set<string>(
      businesses
        .map((business: any) => business.category)
        .filter((item: unknown): item is string => typeof item === "string" && item.length > 0),
    ),
  ).sort();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/c/${coopId}`}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Local Business Directory
              </h1>
              <p className="text-muted-foreground">
                {businesses.length} businesses connected to {coopName}
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <form className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="search"
                type="search"
                placeholder="Search businesses..."
                defaultValue={search}
                className="pl-9"
              />
            </div>
            <Input
              name="category"
              placeholder="Category"
              defaultValue={category}
              className="md:w-56"
              list="directory-categories"
            />
            <datalist id="directory-categories">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <Button type="submit">Search</Button>
          </form>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {businesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 text-xl font-semibold">No businesses found</h2>
            <p className="mt-2 max-w-md text-muted-foreground">
              Try a different search, or check back as this directory grows.
            </p>
            <Button variant="outline" asChild className="mt-4">
              <Link href={`/c/${coopId}/directory`}>Clear filters</Link>
            </Button>
          </div>
        ) : (
          <DirectoryResults businesses={businesses} mapboxAccessToken={env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN} />
        )}
      </main>
    </div>
  );
}

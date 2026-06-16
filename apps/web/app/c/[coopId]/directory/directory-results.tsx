"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Building2, Globe, Grid2X2, Mail, Map, MapPin, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FallbackImage } from "@/components/ui/fallback-image";

export interface DirectoryBusiness {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tags: string[];
  isFeatured: boolean;
}

type ViewMode = "grid" | "map";

function hasCoordinates(business: DirectoryBusiness) {
  return (
    typeof business.latitude === "number" &&
    Number.isFinite(business.latitude) &&
    typeof business.longitude === "number" &&
    Number.isFinite(business.longitude)
  );
}

function businessLocation(business: DirectoryBusiness) {
  return (
    business.formattedAddress ||
    [business.address, business.city, business.state, business.zipCode].filter(Boolean).join(", ")
  );
}

function buildMapboxStaticImageUrl(businesses: DirectoryBusiness[], accessToken?: string) {
  if (!accessToken) return null;

  const markers = businesses
    .filter(hasCoordinates)
    .slice(0, 25)
    .map((business, index) => {
      const color = business.isFeatured ? "F59E0B" : "0F766E";
      const label = index < 9 ? index + 1 : undefined;
      const pin = label ? `pin-s-${label}+${color}` : `pin-s+${color}`;
      return `${pin}(${business.longitude},${business.latitude})`;
    });

  if (markers.length === 0) return null;

  const query = new URLSearchParams({
    access_token: accessToken,
    attribution: "true",
    logo: "true",
    padding: "80,80,80,80",
  });

  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${markers.join(",")}/auto/1200x640@2x?${query.toString()}`;
}

function DirectoryCard({ business }: { business: DirectoryBusiness }) {
  const location = businessLocation(business);

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[16/9] bg-muted">
        <div className="absolute inset-0 flex items-center justify-center">
          <Building2 className="h-12 w-12 text-muted-foreground/40" />
        </div>
        {business.imageUrl && (
          <FallbackImage
            src={business.imageUrl}
            alt={business.name}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        )}
      </div>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{business.name}</CardTitle>
            {business.category && (
              <Badge variant="secondary" className="mt-2">
                {business.category}
              </Badge>
            )}
          </div>
          {business.isFeatured && <Badge>Featured</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {business.description && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{business.description}</p>
        )}

        <div className="space-y-2 text-sm text-muted-foreground">
          {location && (
            <div className="flex gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{location}</span>
            </div>
          )}
          {business.phone && (
            <a className="flex gap-2 hover:text-foreground" href={`tel:${business.phone}`}>
              <Phone className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{business.phone}</span>
            </a>
          )}
          {business.email && (
            <a className="flex gap-2 hover:text-foreground" href={`mailto:${business.email}`}>
              <Mail className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{business.email}</span>
            </a>
          )}
          {business.website && (
            <a
              className="flex gap-2 hover:text-foreground"
              href={business.website}
              target="_blank"
              rel="noreferrer"
            >
              <Globe className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Website</span>
            </a>
          )}
        </div>

        {business.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {business.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DirectoryResults({
  businesses,
  mapboxAccessToken,
}: {
  businesses: DirectoryBusiness[];
  mapboxAccessToken?: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const mappedBusinesses = useMemo(() => businesses.filter(hasCoordinates), [businesses]);
  const mapImageUrl = useMemo(
    () => buildMapboxStaticImageUrl(businesses, mapboxAccessToken),
    [businesses, mapboxAccessToken],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {mappedBusinesses.length} of {businesses.length} businesses have map locations
        </p>
        <div className="flex rounded-full border bg-card p-1">
          <Button
            type="button"
            size="sm"
            variant={viewMode === "grid" ? "default" : "ghost"}
            className="rounded-full"
            onClick={() => setViewMode("grid")}
          >
            <Grid2X2 className="mr-2 h-4 w-4" />
            Grid
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "map" ? "default" : "ghost"}
            className="rounded-full"
            onClick={() => setViewMode("map")}
          >
            <Map className="mr-2 h-4 w-4" />
            Map
          </Button>
        </div>
      </div>

      {viewMode === "map" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-hidden rounded-lg border bg-muted">
            {mapImageUrl ? (
              <div className="relative aspect-[15/8] min-h-[320px]">
                <Image
                  src={mapImageUrl}
                  alt="Map of directory businesses"
                  fill
                  unoptimized
                  sizes="(min-width: 1024px) 70vw, 100vw"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                <MapPin className="h-12 w-12 text-muted-foreground/50" />
                <h2 className="mt-4 text-lg font-semibold">Map locations are not ready yet</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Add a Mapbox token and choose suggested addresses for businesses to save coordinates.
                </p>
              </div>
            )}
          </div>
          <div className="space-y-3">
            {(mappedBusinesses.length > 0 ? mappedBusinesses : businesses).map((business, index) => (
              <div key={business.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  <div>
                    <h3 className="font-semibold">{business.name}</h3>
                    {business.category && <p className="text-sm text-muted-foreground">{business.category}</p>}
                    {businessLocation(business) && (
                      <p className="mt-2 text-sm text-muted-foreground">{businessLocation(business)}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {businesses.map((business) => (
            <DirectoryCard key={business.id} business={business} />
          ))}
        </div>
      )}
    </div>
  );
}

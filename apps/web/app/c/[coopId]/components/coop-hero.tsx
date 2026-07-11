"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, ShoppingBag, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CoopHeroProps {
  coop: {
    id: string;
    slug: string;
    name: string;
    title: string;
    tagline: string;
    description: string;
    bgColor: string;
    gradientStyle?: CSSProperties;
    primaryCtaLabel: string;
    primaryCtaUrl: string;
    secondaryCtaLabel: string;
  };
}

export function CoopHero({ coop }: CoopHeroProps) {
  return (
    <section 
      className="relative overflow-hidden" 
      style={coop.gradientStyle}
    >
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <svg
          className="h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern
              id="grid"
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="white" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
            <Users className="h-4 w-4" />
            {coop.name}
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            {coop.title}
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-xl text-white/90">
            {coop.tagline}
          </p>

          <p className="mx-auto mt-6 max-w-3xl text-base text-white/80 leading-relaxed">
            {coop.description}
          </p>

          {/* CTA Buttons */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              size="lg"
              className="bg-white hover:bg-white/90"
              style={{ color: coop.bgColor }}
              asChild
            >
              <Link href={coop.primaryCtaUrl}>
                <Users className="mr-2 h-5 w-5" />
                {coop.primaryCtaLabel}
                <ArrowRight className="ml-1 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20"
              asChild
            >
              <Link href={`/c/${coop.slug}/products`}>
                <ShoppingBag className="mr-2 h-5 w-5" />
                {coop.secondaryCtaLabel}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

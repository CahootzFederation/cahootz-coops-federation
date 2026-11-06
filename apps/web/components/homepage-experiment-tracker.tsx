"use client";

import type { HomepageVariant } from "@/lib/homepage-experiment";
import { useEffect, useRef } from "react";
import { env } from "@/env";
import { HOMEPAGE_EXPERIMENT_FLAG_KEY } from "@/lib/homepage-experiment";
import { usePostHog } from "posthog-js/react";

export type HomepageExperimentVariant = HomepageVariant;

interface HomepageExperimentTrackerProps {
  variant: HomepageExperimentVariant;
}

export function HomepageExperimentTracker({
  variant,
}: HomepageExperimentTrackerProps) {
  const posthog = usePostHog();
  const capturedVariantRef = useRef<HomepageExperimentVariant | null>(null);

  useEffect(() => {
    if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;

    posthog.updateFlags(
      { [HOMEPAGE_EXPERIMENT_FLAG_KEY]: variant },
      undefined,
      { merge: true },
    );

    posthog.register({
      homepage_experiment: HOMEPAGE_EXPERIMENT_FLAG_KEY,
      homepage_experiment_variant: variant,
      [`$feature/${HOMEPAGE_EXPERIMENT_FLAG_KEY}`]: variant,
      $active_feature_flags: [HOMEPAGE_EXPERIMENT_FLAG_KEY],
    });

    if (capturedVariantRef.current === variant) return;

    posthog.capture("homepage_experiment_viewed", {
      experiment: HOMEPAGE_EXPERIMENT_FLAG_KEY,
      variant,
      [`$feature/${HOMEPAGE_EXPERIMENT_FLAG_KEY}`]: variant,
      $active_feature_flags: [HOMEPAGE_EXPERIMENT_FLAG_KEY],
    });
    capturedVariantRef.current = variant;
  }, [posthog, variant]);

  return null;
}

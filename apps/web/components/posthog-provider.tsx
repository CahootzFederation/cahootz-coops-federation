"use client";

import { useEffect } from "react";
import { env } from "@/env";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: "https://stuff.cahootzcoops.com",
        ui_host: "https://us.posthog.com",
        defaults: "2025-05-24",
        capture_pageview: true,
        capture_exceptions: true,
        session_recording: {
          maskAllInputs: false,
          maskInputOptions: {
            password: true,
          },
        },
        loaded: (posthog) => {
          if (typeof window !== "undefined" && env.NODE_ENV === "development") {
            posthog.debug();
            console.log(
              "PostHog loaded. Session recording enabled:",
              posthog.sessionRecordingStarted(),
            );
          }
        },
      });
    }
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

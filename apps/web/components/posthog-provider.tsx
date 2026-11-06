"use client";

import { useEffect } from "react";
import { env } from "@/env";
import { HOMEPAGE_POSTHOG_DISTINCT_ID_COOKIE } from "@/lib/homepage-experiment";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

function readCookie(name: string) {
  if (typeof document === "undefined") return undefined;

  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);

  return value ? decodeURIComponent(value) : undefined;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (env.NEXT_PUBLIC_POSTHOG_KEY) {
      const distinctId = readCookie(HOMEPAGE_POSTHOG_DISTINCT_ID_COOKIE);

      posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: "https://stuff.cahootzcoops.com",
        ui_host: "https://us.posthog.com",
        defaults: "2025-05-24",
        capture_pageview: true,
        capture_exceptions: true,
        bootstrap: distinctId
          ? {
              distinctID: distinctId,
              isIdentifiedID: false,
            }
          : undefined,
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

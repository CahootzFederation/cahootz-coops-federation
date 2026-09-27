import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

import { USER_A_EMAIL, signIn } from "./support/auth";

/**
 * Opt-in check that onboarding and sign-in send PostHog events without PII.
 *
 * Analytics is a no-op unless the web app is built with a key, so this only
 * runs when the app was started with a fake key and host, for example:
 *
 *   EXPO_PUBLIC_POSTHOG_KEY=phc_e2e_fake \
 *   EXPO_PUBLIC_POSTHOG_HOST=https://posthog.e2e.test pnpm -F @cahootz/mobile dev
 *   E2E_ANALYTICS_HOST=https://posthog.e2e.test pnpm test:e2e:mobile -- analytics
 *
 * Every request to that host is intercepted here, so nothing leaves the machine.
 */
const analyticsHost = process.env.E2E_ANALYTICS_HOST;

type CapturedEvent = {
  event: string;
  distinct_id?: string;
  properties?: Record<string, unknown>;
};

test.skip(!analyticsHost, "Set E2E_ANALYTICS_HOST (and start the app with a fake EXPO_PUBLIC_POSTHOG_KEY) to run.");

test("first-time onboarding and sign-in send analytics events without personal data", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const events: CapturedEvent[] = [];
  const rawBodies: string[] = [];

  await context.route(`${analyticsHost}/**`, async (route) => {
    const buffer = route.request().postDataBuffer();
    if (buffer && route.request().url().includes("/batch")) {
      const gzipped = buffer[0] === 0x1f && buffer[1] === 0x8b;
      const text = (gzipped ? gunzipSync(buffer) : buffer).toString("utf8");
      rawBodies.push(text);
      const body = JSON.parse(text) as { batch?: CapturedEvent[] };
      events.push(...(body.batch ?? []));
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  const page = await context.newPage();
  await signIn(page, USER_A_EMAIL);

  // The SDK flushes in batches on a timer, so wait for the last events.
  const names = () => events.map((event) => event.event);
  await expect.poll(names, { timeout: 45_000 }).toEqual(
    expect.arrayContaining([
      "app_opened",
      "onboarding_step_viewed",
      "onboarding_deferred",
      "onboarding_completed",
      "signed_in",
      "$identify",
      "$screen",
    ]),
  );

  const opened = events.find((event) => event.event === "app_opened");
  expect(opened?.properties).toMatchObject({ source: "cold_start", is_first_open: true, signed_in: false });

  const steps = events
    .filter((event) => event.event === "onboarding_step_viewed")
    .map((event) => event.properties?.step);
  expect(steps).toEqual(expect.arrayContaining(["intro", "profile", "circles"]));

  const identifyEvent = events.find((event) => event.event === "$identify");
  expect(identifyEvent?.distinct_id).toBeTruthy();
  expect(identifyEvent?.distinct_id).not.toContain("@");
  const signedIn = events.find((event) => event.event === "signed_in");
  expect(signedIn?.properties?.coop_id).toBe("cahootz");

  const handle = USER_A_EMAIL.split("@")[0];
  const everything = rawBodies.join("\n");
  expect(everything).not.toContain(USER_A_EMAIL);
  expect(everything).not.toContain(handle);
  expect(everything).not.toMatch(/0x[a-fA-F0-9]{40}/);

  await context.close();
});

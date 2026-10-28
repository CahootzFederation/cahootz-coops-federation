import { env } from "@/env";
import { PostHog } from "posthog-node";

// NOTE: This is a Node.js client, so you can use it for sending events from the server
// side to PostHog.
export default function PostHogClient(options?: { requestTimeout?: number }) {
  const posthogClient = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY ?? "", {
    host: "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: options?.requestTimeout,
  });

  return posthogClient;
}

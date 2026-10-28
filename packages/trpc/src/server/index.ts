import { createExpressMiddleware } from "@trpc/server/adapters/express";

import { createContext } from "../context.js";
import { reportTrpcError } from "../lib/error-tracking.js";
import { appRouter } from "../routers/index.js";

export const trpcExpress = createExpressMiddleware({
  router: appRouter,
  createContext: createContext,
  onError: ({ path, type, error, ctx }) => {
    console.error(`\n❌ tRPC Error on path: ${path}`);
    console.error(`Error code: ${error.code}`);
    console.error(`Error message: ${error.message}`);
    if (error.cause) {
      console.error(`Error cause:`, error.cause);
    }
    console.error('\n');
    // Server faults (5xx) go to PostHog error tracking; expected 4xx errors don't.
    reportTrpcError({ error, path, type, userId: ctx?.errorTracking?.userId });
  },
});

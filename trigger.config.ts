import { PrismaInstrumentation } from "@prisma/instrumentation";
import { OpenAIInstrumentation } from "@traceloop/instrumentation-openai";
import { additionalPackages } from "@trigger.dev/build/extensions/core";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { defineConfig } from "@trigger.dev/sdk";
import { resolve } from "node:path";

const workspaceEntries: Record<string, string> = {
  "@repo/db": "packages/db/index.ts",
  "@repo/validators": "packages/validators/src/index.ts",
  "@repo/validators/notification": "packages/validators/src/notification.ts",
};

//@ts-ignore
const project = process.env.TRIGGER_PROJECT_REF ?? 'proj_ftqkgqaijkmjsgrqgegp';
//
if (!project) {
  throw new Error(
    "TRIGGER_PROJECT_REF must be set to deploy Trigger.dev tasks.",
  );
}

export default defineConfig({
  project,
  dirs: ["./apps/api/src/trigger"],
  tsconfig: "./apps/api/tsconfig.json",
  runtime: "node-22",
  maxDuration: 3600,
  build: {
    extensions: [
      esbuildPlugin({
        name: "workspace-package-sources",
        setup(build) {
          build.onResolve({ filter: /^@repo\/(?:db|validators)(?:\/notification)?$/ }, ({ path }) => {
            const entry = workspaceEntries[path];
            return entry ? { path: resolve(process.cwd(), entry) } : undefined;
          });
        },
      }, { placement: "first" }),
      additionalPackages({
        packages: ["zod@3.25.76"],
      }),
      prismaExtension({
        mode: "legacy",
        schema: "packages/db/prisma/schema.prisma",
      }),
    ],
  },
  telemetry: {
    instrumentations: [
      new PrismaInstrumentation(),
      new OpenAIInstrumentation(),
    ],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});

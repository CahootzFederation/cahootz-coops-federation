import { PrismaInstrumentation } from "@prisma/instrumentation";
import { OpenAIInstrumentation } from "@traceloop/instrumentation-openai";
import { additionalPackages } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { defineConfig } from "@trigger.dev/sdk";

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

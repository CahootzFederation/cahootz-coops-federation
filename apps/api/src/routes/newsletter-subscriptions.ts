import { Router } from "express";
import { z } from "zod";
import { db } from "@repo/db";
import {
  sendNewsletterSubscriptionNotification,
  sendSlackNotification,
} from "@repo/trpc/services/slack-notification-service";

import { env } from "../env.js";

interface SentryCaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

interface SentryScope {
  setTag?: (key: string, value: string) => void;
  setExtras?: (extra: Record<string, unknown>) => void;
}

interface SentryLike {
  captureException?: (error: Error, context?: SentryCaptureContext) => void;
  captureMessage?: (message: string, context?: SentryCaptureContext) => void;
  configureScope?: (callback: (scope: SentryScope) => void) => void;
  getCurrentHub?: () => { getClient?: () => unknown };
  init?: (options: { dsn: string }) => void;
}

const router: Router = Router();

const subscriptionSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address").toLowerCase(),
  coopId: z.string().trim().min(1, "Co-op is required"),
  coopName: z.string().trim().optional(),
  name: z.string().trim().optional(),
  source: z.string().trim().optional(),
  applyIntent: z.boolean().optional(),
});

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : "Unknown newsletter subscription error");
}

function formatSlackValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "Unknown";
}

async function reportNewsletterSubscriptionFailure(
  error: unknown,
  context: Record<string, unknown>,
) {
  const normalizedError = normalizeError(error);
  const tags = { area: "newsletter", action: "subscription" };
  const extra = {
    ...context,
    errorMessage: normalizedError.message,
  };

  try {
    await sendSlackNotification({
      text: "⚠️ Newsletter Subscription Failed",
      attachments: [
        {
          color: "danger",
          fields: [
            { title: "Co-op", value: formatSlackValue(context.coopName || context.coopId), short: true },
            { title: "Email", value: formatSlackValue(context.email), short: true },
            { title: "Source", value: formatSlackValue(context.source), short: true },
            { title: "Origin", value: formatSlackValue(context.origin), short: true },
            { title: "Error", value: normalizedError.message.substring(0, 500), short: false },
            { title: "Time", value: new Date().toLocaleString(), short: false },
          ],
        },
      ],
    });
  } catch (slackError) {
    console.error("Slack newsletter subscription failure alert error:", slackError);
  }

  try {
    const captureContext = { tags, extra };
    const globalSentry = (globalThis as { Sentry?: SentryLike }).Sentry;

    if (globalSentry?.captureException) {
      globalSentry.captureException(normalizedError, captureContext);
      return;
    }

    const sentryPackage = "@sentry/node";
    const sentry = (await import(sentryPackage).catch(() => null)) as SentryLike | null;
    const isInitialized = !!sentry?.getCurrentHub?.().getClient?.();

    if (!isInitialized && env.SENTRY_DSN && sentry?.init) {
      sentry.init({ dsn: env.SENTRY_DSN });
    }

    if (sentry?.configureScope) {
      sentry.configureScope((scope) => {
        Object.entries(tags).forEach(([key, value]) => scope.setTag?.(key, value));
        scope.setExtras?.(extra);
      });
    }

    if (sentry?.captureException) {
      sentry.captureException(normalizedError, captureContext);
      return;
    }

    sentry?.captureMessage?.("Newsletter subscription failed", captureContext);
  } catch (sentryError) {
    console.error("Failed to report newsletter subscription failure to Sentry:", sentryError);
  }
}

router.post("/", async (req, res) => {
  let failureContext: Record<string, unknown> = {};

  try {
    const body = subscriptionSchema.parse(req.body);
    const origin = req.headers.origin || req.headers.referer || undefined;
    const source = body.source || "public-newsletter";
    failureContext = {
      coopId: body.coopId,
      coopName: body.coopName,
      email: body.email,
      source,
      origin,
      applyIntent: body.applyIntent ?? false,
    };

    const subscription = await db.newsletterSubscription.upsert({
      where: {
        coopId_email: {
          coopId: body.coopId,
          email: body.email,
        },
      },
      update: {
        name: body.name || null,
        source,
        applyIntent: body.applyIntent ?? false,
      },
      create: {
        email: body.email,
        coopId: body.coopId,
        name: body.name || null,
        source,
        applyIntent: body.applyIntent ?? false,
      },
    });

    try {
      await sendNewsletterSubscriptionNotification({
        coopId: body.coopId,
        coopName: body.coopName,
        subscriberEmail: body.email,
        subscriberName: body.name,
        subscriptionId: subscription.id,
        source: origin ? `${source} (${origin})` : source,
        applyIntent: body.applyIntent,
      });
    } catch (error) {
      console.error("Slack newsletter subscription notification error:", error);
    }

    return res.json({
      success: true,
      message: "You're subscribed. We'll keep you posted.",
    });
  } catch (error) {
    console.error("Newsletter subscription error:", error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: error.issues[0]?.message || "Please check your email and try again.",
      });
    }

    await reportNewsletterSubscriptionFailure(error, failureContext);

    return res.status(500).json({
      success: false,
      message: "We could not subscribe you right now. Please try again.",
    });
  }
});

export default router;

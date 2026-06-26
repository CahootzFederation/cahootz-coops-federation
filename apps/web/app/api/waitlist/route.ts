import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import PostHogClient from "@/lib/posthog";
import z from "zod/v4";

// Create database client directly
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const db = globalForPrisma.prisma ?? new PrismaClient({
  log: ["query", "error", "warn"],
});

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;

interface WaitlistData {
  email: string;
  name?: string;
  source: "hero" | "contact";
  suggestedCoop?: string;
}

const waitlistSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  name: z.string().optional(),
  source: z.enum(["hero", "contact"]),
  suggestedCoop: z.string().optional(),
});

async function sendWaitlistToSlack(data: WaitlistData, origin: string) {
  const slackWebhookUrl = env.SLACK_WEBHOOK_URL;

  if (!slackWebhookUrl) {
    console.log("No Slack webhook configured");
    return false;
  }

  const message = {
    text: `🎉 New Cahootz Waitlist Signup!\n\n*Email:* ${data.email}\n*Name:* ${data.name || "Not provided"}\n*Source:* ${data.source}\n*Interested Coop:* ${data.suggestedCoop || "Not provided"}\n*Website URL:* ${origin}\n*Time:* ${new Date().toLocaleString()}`,
  };

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }

  return true;
}

export async function POST(request: NextRequest) {
  try {
    const body = waitlistSchema.parse(await request.json());
    console.log("waitlist-form request", {
      ...body,
      email: "[redacted]",
    });

    // Capture the origin URL
    const origin = request.headers.get("origin") || request.headers.get("referer") || "Unknown";

    const waitlistData: WaitlistData = {
      email: body.email,
      name: body.name || undefined,
      source: body.source,
      suggestedCoop: body.suggestedCoop?.trim() || undefined,
    };

    // Save to database first so notification failures do not lose signups.
    await db.waitlistEntry.upsert({
      where: { email: waitlistData.email },
      update: {
        name: waitlistData.name,
        source: waitlistData.source,
        coopId: waitlistData.suggestedCoop || undefined,
        notes: waitlistData.suggestedCoop
          ? `Interested coop: ${waitlistData.suggestedCoop}`
          : undefined,
      },
      create: {
        email: waitlistData.email,
        name: waitlistData.name,
        type: "user",
        source: waitlistData.source,
        coopId: waitlistData.suggestedCoop || undefined,
        notes: waitlistData.suggestedCoop
          ? `Interested coop: ${waitlistData.suggestedCoop}`
          : undefined,
      },
    });

    try {
      await sendWaitlistToSlack(waitlistData, origin);
    } catch (error) {
      console.error("Slack waitlist notification error:", error);
    }

    try {
      const apiUrl = (env.NEXT_PUBLIC_API_URL || "http://localhost:3001/trpc").replace(/\/trpc$/, "").replace(/\/$/, "");
      await fetch(`${apiUrl}/trpc/waitlist.sendWelcomeEmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: waitlistData.email, coopId: waitlistData.suggestedCoop }),
      });
    } catch (error) {
      console.error("Waitlist welcome email error:", error);
    }

    // Identify user in PostHog
    try {
      const posthog = PostHogClient();
      posthog.identify({
        distinctId: waitlistData.email,
        properties: {
          email: waitlistData.email,
          name: waitlistData.name,
          source: waitlistData.source,
          suggestedCoop: waitlistData.suggestedCoop,
          signupType: 'waitlist',
        },
      });
      await posthog.shutdown();
    } catch (error) {
      console.error("PostHog identification error:", error);
      // Don't fail the request if PostHog fails
    }

    return NextResponse.json({
      success: true,
      message: "You're on the list! We'll be in touch soon.",
    });
  } catch (error) {
    console.error("Waitlist signup error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: error.issues[0]?.message || "Invalid form data. Please check your input.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Error joining waitlist. Please try again.",
      },
      { status: 500 }
    );
  }
}


import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "@/env";
import z from "zod/v4";

const CONTACT_EMAIL = "team@cahootzcoops.com";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().email("Please enter a valid email address").max(160),
  organization: z.string().trim().max(160).optional(),
  topic: z
    .enum(["general", "start-coop", "business", "support", "partnership"])
    .default("general"),
  message: z.string().trim().min(10, "Please add a little more detail").max(4000),
  website: z.string().optional(),
});

type ContactMessage = z.infer<typeof contactSchema>;

function topicLabel(topic: ContactMessage["topic"]) {
  switch (topic) {
    case "start-coop":
      return "Start a commons";
    case "business":
      return "Business interest";
    case "support":
      return "Support";
    case "partnership":
      return "Partnership";
    case "general":
    default:
      return "General";
  }
}

function buildPlainTextMessage(data: ContactMessage, origin: string) {
  return [
    "New contact message from Cahootz",
    "",
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Organization: ${data.organization || "Not provided"}`,
    `Topic: ${topicLabel(data.topic)}`,
    `Website URL: ${origin}`,
    `Time: ${new Date().toLocaleString()}`,
    "",
    "Message:",
    data.message,
  ].join("\n");
}

async function sendContactEmail(data: ContactMessage, origin: string) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const subject = `Cahootz contact: ${topicLabel(data.topic)} from ${data.name}`;
  const text = buildPlainTextMessage(data, origin);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: CONTACT_EMAIL,
      subject,
      text,
      reply_to: data.email,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Resend contact email failed: ${response.status} ${errorText}`);
  }
}

async function sendContactToSlack(data: ContactMessage, origin: string) {
  if (!env.SLACK_WEBHOOK_URL) {
    throw new Error("SLACK_WEBHOOK_URL is not configured");
  }

  const response = await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "New Cahootz contact message",
      attachments: [
        {
          color: "#f0975b",
          fields: [
            { title: "Name", value: data.name, short: true },
            { title: "Email", value: data.email, short: true },
            {
              title: "Organization",
              value: data.organization || "Not provided",
              short: true,
            },
            { title: "Topic", value: topicLabel(data.topic), short: true },
            { title: "Message", value: data.message, short: false },
            { title: "Website URL", value: origin, short: false },
            { title: "Time", value: new Date().toLocaleString(), short: false },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack contact notification failed: ${response.status}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = contactSchema.parse(await request.json());

    if (body.website) {
      return NextResponse.json({
        success: true,
        message: "Thanks. We received your message.",
      });
    }

    const origin = request.headers.get("origin") || request.headers.get("referer") || "Unknown";
    await Promise.all([
      sendContactEmail(body, origin),
      sendContactToSlack(body, origin),
    ]);

    return NextResponse.json({
      success: true,
      message: "Thanks. We received your message and will get back to you soon.",
    });
  } catch (error) {
    console.error("Contact submission error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: error.issues[0]?.message || "Invalid form data. Please check your input.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "We could not send your message. Please email team@cahootzcoops.com directly.",
      },
      { status: 500 },
    );
  }
}

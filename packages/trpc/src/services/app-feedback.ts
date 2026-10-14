/**
 * In-app feedback: members report a problem, complain, or share an idea from
 * the app, optionally with screenshots. Each report is saved, then posted to
 * the team's Slack channel through an incoming webhook.
 */

export const FEEDBACK_CATEGORIES = ["BUG", "COMPLAINT", "IDEA", "OTHER"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const MAX_FEEDBACK_SCREENSHOTS = 4;

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  BUG: "🐞 Something is broken",
  COMPLAINT: "😤 Complaint",
  IDEA: "💡 Idea",
  OTHER: "💬 Other feedback",
};

/**
 * Screenshots must be files the app uploaded to our blob store under
 * `feedback/`, so a report can't make Slack fetch arbitrary URLs.
 */
export function isFeedbackScreenshotUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".blob.vercel-storage.com") &&
      url.pathname.startsWith("/feedback/")
    );
  } catch {
    return false;
  }
}

/** Member text goes into Slack mrkdwn; escape it so it can't ping or link. */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type FeedbackSlackInput = {
  feedbackId: string;
  category: FeedbackCategory;
  message: string;
  screenshotUrls: string[];
  reporter: { name: string | null; handle: string | null; email: string | null };
  screen?: string | null;
  coopId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
};

export function buildFeedbackSlackMessage(input: FeedbackSlackInput) {
  const reporter =
    input.reporter.name ||
    (input.reporter.handle ? `@${input.reporter.handle}` : null) ||
    "A member";
  const contact = [input.reporter.handle ? `@${input.reporter.handle}` : null, input.reporter.email]
    .filter(Boolean)
    .join(" · ");
  const context = [
    input.platform && input.appVersion
      ? `${input.platform} ${input.appVersion}`
      : input.platform || input.appVersion,
    input.screen ? `Screen: ${input.screen}` : null,
    input.coopId ? `Commons: ${input.coopId}` : null,
    `Ref: ${input.feedbackId}`,
  ].filter((part): part is string => Boolean(part));
  // Slack caps a section's text at 3000 characters.
  const message =
    input.message.length > 2900 ? `${input.message.slice(0, 2900)}…` : input.message;

  return {
    text: `${CATEGORY_LABELS[input.category]} from ${reporter}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: CATEGORY_LABELS[input.category], emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*From:* ${escapeSlackText(reporter)}${contact ? ` (${escapeSlackText(contact)})` : ""}`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `>>> ${escapeSlackText(message)}` },
      },
      ...input.screenshotUrls.map((url, index) => ({
        type: "image",
        image_url: url,
        alt_text: `Screenshot ${index + 1}`,
      })),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: escapeSlackText(context.join(" · ")) }],
      },
    ],
  };
}

/**
 * Posts the report to Slack. Uses SLACK_FEEDBACK_WEBHOOK_URL so feedback can
 * have its own channel, falling back to the general SLACK_WEBHOOK_URL.
 * Returns whether Slack accepted it; never throws.
 */
export async function sendFeedbackToSlack(input: FeedbackSlackInput): Promise<boolean> {
  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("⚠️ Slack feedback webhook not configured, skipping feedback notification");
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildFeedbackSlackMessage(input)),
    });
    if (!response.ok) {
      console.error(`Slack feedback webhook failed: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to send feedback to Slack:", error);
    return false;
  }
}

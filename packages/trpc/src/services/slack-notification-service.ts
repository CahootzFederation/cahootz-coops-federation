/**
 * Slack Notification Service
 * Sends notifications to Slack for important events
 */

export async function sendSlackNotification(message: {
  text: string;
  attachments?: Array<{
    color?: string;
    fields?: Array<{ title: string; value: string; short?: boolean }>;
  }>;
}): Promise<boolean> {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) {
    console.log("⚠️ Slack webhook not configured, skipping notification");
    return false;
  }

  try {
    const response = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`Slack webhook failed: ${response.status}`);
      return false;
    } else {
      console.log("✅ Slack notification sent");
      return true;
    }
  } catch (error) {
    console.error("Failed to send Slack notification:", error);
    return false;
  }
}

export interface AgentOperationalIssue {
  agentId: string;
  state: "OFF" | "GATED" | "BROKEN" | "PAUSED" | "FAILED";
  reason: string;
  coopId?: string;
}

function safeSlackText(value: string, maxLength = 500): string {
  return value
    .slice(0, maxLength)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(channel|here|everyone)/gi, "@$1-disabled");
}

/** Host and database name only, so an alert shows which database it read without leaking credentials. */
export function databaseLabel(url = process.env.DATABASE_URL): string {
  if (!url) return "not set";
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "");
    return `${parsed.hostname}${name ? `/${name}` : ""}`;
  } catch {
    return "unreadable DATABASE_URL";
  }
}

function databaseField(databaseId?: string) {
  const label = databaseLabel();
  return { title: "Database", value: safeSlackText(databaseId ? `${label} · ID ${databaseId}` : label, 200), short: true };
}

/**
 * Every Railway project's Postgres shows up as postgres.railway.internal/railway,
 * so the project and service name is what tells two senders apart.
 */
function railwayServiceField() {
  const project = process.env.RAILWAY_PROJECT_NAME?.trim();
  const service = process.env.RAILWAY_SERVICE_NAME?.trim();
  const value = [project, service].filter(Boolean).join(" / ") || "not on Railway";
  return { title: "Railway project / service", value: safeSlackText(value, 200), short: true };
}

/** Loud, repeatable alert used by the hourly watchdog while an agent is not operational. */
export async function sendAgentOperationalAlert(params: {
  checkedAt: Date;
  issues: AgentOperationalIssue[];
  environment?: string;
  /** Which monitor sent this, e.g. "Trigger.dev watchdog" or "API backup monitor". */
  source?: string;
  /** From getDatabaseId(); shows whether two monitors read the same database. */
  databaseId?: string;
}): Promise<boolean> {
  const issueLines = params.issues.slice(0, 30).map((issue) => {
    const scope = issue.coopId ? ` (${safeSlackText(issue.coopId, 100)})` : "";
    return `• *${issue.state}* — ${safeSlackText(issue.agentId, 100)}${scope}: ${safeSlackText(issue.reason)}`;
  });
  if (params.issues.length > issueLines.length) {
    issueLines.push(`• …and ${params.issues.length - issueLines.length} more issue(s)`);
  }

  return sendSlackNotification({
    text: `<!channel> 🚨🚨🚨 *AGENT SYSTEM NEEDS ATTENTION* 🚨🚨🚨\n${issueLines.join("\n")}`,
    attachments: [{
      color: "danger",
      fields: [
        { title: "Environment", value: process.env.RAILWAY_ENVIRONMENT_NAME ?? params.environment ?? process.env.NODE_ENV ?? "unknown", short: true },
        railwayServiceField(),
        { title: "Issue count", value: String(params.issues.length), short: true },
        { title: "Sent by", value: params.source ?? "unknown", short: true },
        databaseField(params.databaseId),
        { title: "Checked at", value: params.checkedAt.toISOString(), short: false },
        { title: "Alert behavior", value: "This alert repeats every watchdog run until every issue is cleared.", short: false },
      ],
    }],
  });
}

/** Daily proof of who Sage evaluated for outreach and what actually happened. */
export async function sendSageOutreachDailyReport(params: {
  modelConfigured: boolean;
  considered: number;
  due: number;
  sent: number;
  recent: number;
  duplicate: number;
  limited: number;
  failed: number;
  modelFallbacks: number;
  deliveries: Array<{ label: string; status: string; reason?: string }>;
  checkedAt?: Date;
  databaseId?: string;
}): Promise<boolean> {
  const broken = !params.modelConfigured || params.failed > 0 || params.modelFallbacks > 0;
  const recipients = params.deliveries.length
    ? params.deliveries.slice(0, 50).map((delivery) => {
        const reason = delivery.reason ? ` — ${safeSlackText(delivery.reason)}` : "";
        return `• ${safeSlackText(delivery.label, 120)}: *${safeSlackText(delivery.status, 60)}*${reason}`;
      }).join("\n")
    : "• No member was assigned today.";

  return sendSlackNotification({
    text: broken
      ? `<!channel> 🚨🚨🚨 *SAGE OUTREACH IS NOT FULLY OPERATIONAL* 🚨🚨🚨\n${recipients}`
      : `✅ *Daily Sage outreach report*\n${recipients}`,
    attachments: [{
      color: broken ? "danger" : "good",
      fields: [
        { title: "Agent", value: "ON — always enabled", short: true },
        { title: "Model", value: params.modelConfigured ? (params.modelFallbacks ? `FAILED/FALLBACK (${params.modelFallbacks})` : "READY") : "BROKEN — OPENAI_API_KEY missing", short: true },
        { title: "Members checked", value: String(params.considered), short: true },
        { title: "Due / sent", value: `${params.due} / ${params.sent}`, short: true },
        { title: "Skipped", value: `${params.recent} recent, ${params.duplicate} duplicate, ${params.limited} weekly-limit`, short: true },
        { title: "Delivery failures", value: String(params.failed), short: true },
        databaseField(params.databaseId),
        { title: "Checked at", value: (params.checkedAt ?? new Date()).toISOString(), short: false },
      ],
    }],
  });
}

/** What to do about each Expo error code, in plain words. */
const PUSH_FIX_HINTS: Record<string, string> = {
  DeviceNotRegistered: "The app was deleted or the token went stale. We turned that device off; nothing to fix.",
  InvalidCredentials: "Apple/Google push keys are missing or wrong in Expo. Re-upload them with `eas credentials`.",
  MismatchSenderId: "The Android FCM key in Expo doesn't match the app build. Re-upload it with `eas credentials`.",
  UNAUTHORIZED: "Expo push security is on. Set EXPO_ACCESS_TOKEN on the API and Trigger.dev.",
  MessageTooBig: "A push was over 4KB. Shorten the title, body, or data for that notification type.",
  MessageRateExceeded: "We sent too fast to one device. Space out that notification type.",
  PUSH_TOO_MANY_EXPERIENCE_IDS: "Tokens from more than one Expo project were sent together. Check the app's projectId.",
  ReceiptMissing: "Expo never reported back on these. Check status.expo.dev and try again.",
  RequestFailed: "We couldn't reach Expo. Check the API network and status.expo.dev.",
};

/** Posts failed phone pushes to Slack, grouped by error, with what to do about each. */
export async function sendPushDeliveryAlert(params: {
  checkedAt: Date;
  summary: {
    total: number;
    byCode: Array<{ code: string; count: number }>;
    byType: Array<{ type: string; count: number }>;
    byCoop: Array<{ coopId: string; count: number }>;
  };
  delivered: number;
  receiptLookupFailed?: boolean;
}): Promise<boolean> {
  const { summary } = params;
  const codeLines = summary.byCode.slice(0, 10).map(({ code, count }) => {
    const hint = PUSH_FIX_HINTS[code] ?? (code.startsWith("HttpError")
      ? "Expo rejected the request. Check the API logs for [push] Expo HTTP error."
      : "Unrecognized error. Check the API logs for [push] lines.");
    return `• *${safeSlackText(code, 60)}* × ${count} — ${hint}`;
  });
  if (params.receiptLookupFailed)
    codeLines.push("• *Receipt lookup failed* — We couldn't read delivery results from Expo. We'll retry next run.");
  // Dead devices clean themselves up, so only page the channel for something we need to fix.
  const needsFix = params.receiptLookupFailed || summary.byCode.some(({ code }) => code !== "DeviceNotRegistered");
  const list = (rows: Array<{ label: string; count: number }>) =>
    rows.slice(0, 8).map(({ label, count }) => `${safeSlackText(label, 60)}: ${count}`).join("\n") || "none";

  return sendSlackNotification({
    text: `${needsFix ? "<!channel> 🚨 " : "📵 "}*${summary.total} phone push${summary.total === 1 ? "" : "es"} didn't go out*\n${codeLines.join("\n")}`,
    attachments: [{
      color: needsFix ? "danger" : "warning",
      fields: [
        { title: "By notification type", value: list(summary.byType.map((row) => ({ label: row.type, count: row.count }))), short: true },
        { title: "By Commons", value: list(summary.byCoop.map((row) => ({ label: row.coopId, count: row.count }))), short: true },
        { title: "Delivered since last check", value: String(params.delivered), short: true },
        { title: "Environment", value: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "unknown", short: true },
        { title: "Checked at", value: params.checkedAt.toISOString(), short: false },
      ],
    }],
  });
}

export async function sendApplicationSubmittedNotification(params: {
  coopId: string;
  coopName?: string;
  applicantEmail?: string;
  applicantName?: string;
  applicationId: string;
  referenceCode?: string;
}) {
  const { coopId, coopName, applicantEmail, applicantName, applicationId, referenceCode } = params;

  await sendSlackNotification({
    text: `📝 New Membership Application Submitted!`,
    attachments: [
      {
        color: "good",
        fields: [
          {
            title: "Co-op",
            value: coopName || coopId,
            short: true,
          },
          {
            title: "Applicant",
            value: applicantName || applicantEmail || "Unknown",
            short: true,
          },
          {
            title: "Email",
            value: applicantEmail || "Not provided",
            short: true,
          },
          {
            title: "Reference",
            value: referenceCode || "None",
            short: true,
          },
          {
            title: "Application ID",
            value: applicationId,
            short: true,
          },
          {
            title: "Time",
            value: new Date().toLocaleString(),
            short: false,
          },
        ],
      },
    ],
  });
}

export async function sendNewsletterSubscriptionNotification(params: {
  coopId: string;
  coopName?: string;
  subscriberEmail: string;
  subscriberName?: string;
  subscriptionId: string;
  source?: string;
  applyIntent?: boolean;
}) {
  const {
    coopId,
    coopName,
    subscriberEmail,
    subscriberName,
    subscriptionId,
    source,
    applyIntent,
  } = params;

  await sendSlackNotification({
    text: `🗞️ New Newsletter Subscription`,
    attachments: [
      {
        color: "good",
        fields: [
          {
            title: "Co-op",
            value: coopName || coopId,
            short: true,
          },
          {
            title: "Subscriber",
            value: subscriberName || subscriberEmail,
            short: true,
          },
          {
            title: "Email",
            value: subscriberEmail,
            short: true,
          },
          {
            title: "Wants to apply later",
            value: applyIntent ? "Yes" : "Not specified",
            short: true,
          },
          {
            title: "Source",
            value: source || "public-newsletter",
            short: true,
          },
          {
            title: "Subscription ID",
            value: subscriptionId,
            short: true,
          },
          {
            title: "Time",
            value: new Date().toLocaleString(),
            short: false,
          },
        ],
      },
    ],
  });
}

export async function sendCommonsSuggestionNotification(params: {
  suggestionId: string;
  coopId: string;
  commonsName: string;
  reason?: string | null;
  suggestedByEmail: string;
  suggestedByName?: string | null;
}) {
  const { suggestionId, coopId, commonsName, reason, suggestedByEmail, suggestedByName } = params;

  await sendSlackNotification({
    text: "New Commons Suggestion",
    attachments: [
      {
        color: "#F97316",
        fields: [
          {
            title: "Suggested commons",
            value: commonsName,
            short: true,
          },
          {
            title: "Suggested by",
            value: suggestedByName || suggestedByEmail,
            short: true,
          },
          {
            title: "Email",
            value: suggestedByEmail,
            short: true,
          },
          {
            title: "Co-op",
            value: coopId,
            short: true,
          },
          {
            title: "Reason",
            value: reason || "Not provided",
            short: false,
          },
          {
            title: "Suggestion ID",
            value: suggestionId,
            short: false,
          },
          {
            title: "Time",
            value: new Date().toLocaleString(),
            short: false,
          },
        ],
      },
    ],
  });
}

export async function sendApiHealthNotification(params: {
  status: "up" | "down" | "degraded";
  service: "api" | "web" | "database";
  error?: string;
  uptime?: number;
  environment?: string;
}) {
  const { status, service, error, uptime, environment } = params;

  const emoji = status === "up" ? "✅" : status === "down" ? "🔴" : "⚠️";
  const color = status === "up" ? "good" : status === "down" ? "danger" : "warning";
  const statusText = status === "up" ? "Online" : status === "down" ? "Offline" : "Degraded";

  const fields: Array<{ title: string; value: string; short?: boolean }> = [
    {
      title: "Service",
      value: service.toUpperCase(),
      short: true,
    },
    {
      title: "Status",
      value: statusText,
      short: true,
    },
  ];

  if (environment) {
    fields.push({
      title: "Environment",
      value: environment,
      short: true,
    });
  }

  if (uptime !== undefined) {
    fields.push({
      title: "Uptime",
      value: `${Math.floor(uptime / 60)} minutes`,
      short: true,
    });
  }

  if (error) {
    fields.push({
      title: "Error",
      value: error,
      short: false,
    });
  }

  fields.push({
    title: "Time",
    value: new Date().toLocaleString(),
    short: false,
  });

  await sendSlackNotification({
    text: `${emoji} ${service.toUpperCase()} Service ${statusText}`,
    attachments: [
      {
        color,
        fields,
      },
    ],
  });
}

export async function sendApiStartupNotification(params: {
  service: "api" | "web";
  port?: number;
  environment?: string;
  version?: string;
}) {
  const { service, port, environment, version } = params;

  const fields: Array<{ title: string; value: string; short?: boolean }> = [
    {
      title: "Service",
      value: service.toUpperCase(),
      short: true,
    },
    {
      title: "Status",
      value: "Started",
      short: true,
    },
  ];

  if (port) {
    fields.push({
      title: "Port",
      value: port.toString(),
      short: true,
    });
  }

  if (environment) {
    fields.push({
      title: "Environment",
      value: environment,
      short: true,
    });
  }

  if (version) {
    fields.push({
      title: "Version",
      value: version,
      short: true,
    });
  }

  fields.push({
    title: "Time",
    value: new Date().toLocaleString(),
    short: false,
  });

  await sendSlackNotification({
    text: `🚀 ${service.toUpperCase()} Service Started`,
    attachments: [
      {
        color: "good",
        fields,
      },
    ],
  });
}

export async function sendOrderCompletedNotification(params: {
  transactionId: string;
  customerName?: string;
  customerEmail?: string;
  businessName?: string;
  amountUSD: number;
  coopId?: string;
  isGuestCheckout?: boolean;
}) {
  const { transactionId, customerName, customerEmail, businessName, amountUSD, coopId, isGuestCheckout } = params;

  const customerDisplay = customerName || customerEmail || 'Unknown';
  const formattedAmount = `$${amountUSD.toFixed(2)}`;

  await sendSlackNotification({
    text: `🛒 New Order Completed — ${formattedAmount}`,
    attachments: [
      {
        color: "good",
        fields: [
          {
            title: "Amount",
            value: formattedAmount,
            short: true,
          },
          {
            title: "Business",
            value: businessName || "Unknown",
            short: true,
          },
          {
            title: "Customer",
            value: isGuestCheckout ? `${customerDisplay} (guest)` : customerDisplay,
            short: true,
          },
          {
            title: "Co-op",
            value: coopId || "Unknown",
            short: true,
          },
          {
            title: "Transaction ID",
            value: transactionId,
            short: false,
          },
          {
            title: "Time",
            value: new Date().toLocaleString(),
            short: false,
          },
        ],
      },
    ],
  });
}

export async function sendApiErrorNotification(params: {
  service: "api" | "web";
  error: string;
  stack?: string;
  path?: string;
  method?: string;
}) {
  const { service, error, stack, path, method } = params;

  const fields: Array<{ title: string; value: string; short?: boolean }> = [
    {
      title: "Service",
      value: service.toUpperCase(),
      short: true,
    },
    {
      title: "Error Type",
      value: "Uncaught Exception",
      short: true,
    },
  ];

  if (method && path) {
    fields.push({
      title: "Endpoint",
      value: `${method} ${path}`,
      short: false,
    });
  }

  fields.push({
    title: "Error Message",
    value: error.substring(0, 500),
    short: false,
  });

  if (stack) {
    fields.push({
      title: "Stack Trace",
      value: stack.substring(0, 1000),
      short: false,
    });
  }

  fields.push({
    title: "Time",
    value: new Date().toLocaleString(),
    short: false,
  });

  await sendSlackNotification({
    text: `💥 ${service.toUpperCase()} Service Error`,
    attachments: [
      {
        color: "danger",
        fields,
      },
    ],
  });
}

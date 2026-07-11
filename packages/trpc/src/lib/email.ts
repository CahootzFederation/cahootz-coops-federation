import React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render, toPlainText } from "@react-email/render";
import { Resend } from "resend";

import { env } from "../env.js";

type EmailRecipient = string | string[];
const DEFAULT_NETWORK_NAME = "Cahootz Co-ops";
const DEFAULT_FROM_EMAIL = "support@mail.cahootzcoops.com";
const LOGIN_EMAIL_FROM = DEFAULT_FROM_EMAIL;
type SentryCaptureContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};
type SentryScope = {
  setTag?: (key: string, value: string) => void;
  setExtras?: (extras: Record<string, unknown>) => void;
};
type SentryLike = {
  captureException?: (error: Error, context?: SentryCaptureContext) => void;
  configureScope?: (callback: (scope: SentryScope) => void) => void;
  getCurrentHub?: () => { getClient?: () => unknown };
  init?: (options: { dsn: string }) => void;
};

export interface OrderEmailItem {
  productName: string;
  quantity: number;
  priceUSD: number;
  totalUSD: number;
}

export interface OrderEmailData {
  orderId: string;
  coopName?: string | null;
  storeName: string;
  customerName?: string | null;
  customerEmail?: string | null;
  items: OrderEmailItem[];
  subtotalUSD: number;
  discountUSD?: number;
  totalUSD: number;
  totalUC?: number | null;
  paymentMethod?: string | null;
  transactionHash?: string | null;
  shippingAddress?: string | null;
  note?: string | null;
  createdAt?: Date | string | null;
  orderUrl?: string | null;
  manageOrderUrl?: string | null;
}

const h = React.createElement;

const colors = {
  background: "#f6f2ea",
  card: "#fffdf8",
  ink: "#1f2933",
  muted: "#687383",
  line: "#e8ded0",
  brand: "#8b5e34",
  brandDark: "#5f3f22",
  accent: "#23635a",
  softAccent: "#e7f3ef",
  softBrand: "#f3eadf",
};

const styles = {
  body: {
    margin: "0",
    backgroundColor: colors.background,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: colors.ink,
  },
  container: {
    width: "100%",
    maxWidth: "640px",
    margin: "0 auto",
    padding: "28px 18px",
  },
  card: {
    backgroundColor: colors.card,
    border: `1px solid ${colors.line}`,
    borderRadius: "14px",
    padding: "28px",
  },
  eyebrow: {
    color: colors.brand,
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    margin: "0 0 10px",
    textTransform: "uppercase" as const,
  },
  heading: {
    color: colors.ink,
    fontSize: "28px",
    lineHeight: "34px",
    fontWeight: 800,
    margin: "0 0 12px",
  },
  text: {
    color: colors.ink,
    fontSize: "16px",
    lineHeight: "24px",
    margin: "0 0 16px",
  },
  muted: {
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "21px",
    margin: "0",
  },
  pill: {
    display: "inline-block",
    backgroundColor: colors.softAccent,
    color: colors.accent,
    borderRadius: "999px",
    padding: "6px 11px",
    fontSize: "13px",
    fontWeight: 700,
    margin: "0 0 18px",
  },
  summary: {
    backgroundColor: colors.softBrand,
    borderRadius: "12px",
    padding: "18px",
    margin: "20px 0",
  },
  shipToBox: {
    backgroundColor: colors.softAccent,
    border: `1px solid ${colors.accent}`,
    borderRadius: "12px",
    padding: "18px",
    margin: "18px 0 20px",
  },
  missingShipToBox: {
    backgroundColor: colors.softBrand,
    border: `1px solid ${colors.brand}`,
    borderRadius: "12px",
    padding: "18px",
    margin: "18px 0 20px",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    borderBottom: `1px solid ${colors.line}`,
    padding: "12px 0",
  },
  rowLast: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 0 0",
  },
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "14px 0 0",
    marginTop: "4px",
    borderTop: `2px solid ${colors.brand}`,
  },
  itemName: {
    color: colors.ink,
    fontSize: "15px",
    lineHeight: "21px",
    fontWeight: 700,
    margin: "0",
  },
  itemMeta: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "18px",
    margin: "2px 0 0",
  },
  amount: {
    color: colors.ink,
    fontSize: "15px",
    lineHeight: "21px",
    fontWeight: 700,
    margin: "0",
    whiteSpace: "nowrap" as const,
  },
  address: {
    color: colors.ink,
    fontSize: "17px",
    lineHeight: "25px",
    fontWeight: 700,
    margin: "6px 0 0",
    whiteSpace: "pre-line" as const,
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: "10px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "15px",
    fontWeight: 700,
    padding: "13px 18px",
    textDecoration: "none",
  },
  footer: {
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "18px 0 0",
    textAlign: "center" as const,
  },
};

function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(value?: Date | string | null): string {
  if (!value) return new Date().toLocaleString("en-US");
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(-12) : id;
}

function EmailShell({
  brandName = DEFAULT_NETWORK_NAME,
  preview,
  children,
}: {
  brandName?: string | null;
  preview: string;
  children?: React.ReactNode;
}) {
  const displayName = brandName || DEFAULT_NETWORK_NAME;

  return h(
    Html,
    null,
    h(Head),
    h(Preview, null, preview),
    h(
      Body,
      { style: styles.body },
      h(
        Container,
        { style: styles.container },
        h(
          Section,
          { style: styles.card },
          h(Text, { style: styles.eyebrow }, displayName),
          children,
        ),
        h(
          Text,
          { style: styles.footer },
          `${displayName} sends transactional emails for account access and marketplace orders.`,
        ),
      ),
    ),
  );
}

function LoginCodeEmail({
  code,
  coopName,
}: {
  code: string;
  coopName?: string | null;
}) {
  const displayName = coopName || DEFAULT_NETWORK_NAME;

  return h(
    EmailShell,
    { brandName: displayName, preview: `Your ${displayName} login code is ${code}.` },
    h(Heading, { style: styles.heading }, "Your login code"),
    h(
      Text,
      { style: styles.text },
      "Use this code to finish signing in. It expires in 10 minutes.",
    ),
    h(
      Section,
      {
        style: {
          ...styles.summary,
          textAlign: "center" as const,
        },
      },
      h(
        Text,
        {
          style: {
            color: colors.brandDark,
            fontSize: "36px",
            fontWeight: 800,
            letterSpacing: "0.18em",
            lineHeight: "42px",
            margin: "0",
          },
        },
        code,
      ),
    ),
    h(
      Text,
      { style: styles.muted },
      "If you did not request this code, you can ignore this email.",
    ),
  );
}

function OrderItems({ items }: { items: OrderEmailItem[] }) {
  return h(
    Section,
    null,
    ...items.map((item, index) =>
      h(
        Section,
        { key: `${item.productName}-${index}`, style: index === items.length - 1 ? styles.rowLast : styles.row },
        h(
          Section,
          null,
          h(Text, { style: styles.itemName }, item.productName),
          h(
            Text,
            { style: styles.itemMeta },
            `${item.quantity} x ${formatUSD(item.priceUSD)}`,
          ),
        ),
        h(Text, { style: styles.amount }, formatUSD(item.totalUSD)),
      ),
    ),
  );
}

function OrderSummary({ order }: { order: OrderEmailData }) {
  return h(
    Section,
    { style: styles.summary },
    h(OrderItems, { items: order.items }),
    h(
      Section,
      { style: styles.totalRow },
      h(Text, { style: { ...styles.itemName, fontSize: "16px" } }, "Total"),
      h(Text, { style: { ...styles.amount, fontSize: "18px" } }, formatUSD(order.totalUSD)),
    ),
    order.paymentMethod
      ? h(
          Text,
          { style: { ...styles.itemMeta, marginTop: "10px" } },
          `Paid with ${order.paymentMethod.replace(/_/g, " ")}`,
        )
      : null,
  );
}

function OrderConfirmationEmail({ order }: { order: OrderEmailData }) {
  const preview = `Order ${shortId(order.orderId)} confirmed at ${order.storeName}.`;

  return h(
    EmailShell,
    { brandName: order.coopName, preview },
    h(Text, { style: styles.pill }, `Order #${shortId(order.orderId)}`),
    h(Heading, { style: styles.heading }, "Your order is confirmed"),
    h(
      Text,
      { style: styles.text },
      `Thanks${order.customerName ? `, ${order.customerName}` : ""}. ${order.storeName} received your order and will begin preparing it soon.`,
    ),
    h(OrderSummary, { order }),
    order.shippingAddress
      ? h(
          Section,
          null,
          h(Text, { style: styles.itemName }, "Shipping"),
          h(Text, { style: styles.muted }, order.shippingAddress),
        )
      : null,
    order.orderUrl
      ? h(
          Section,
          { style: { marginTop: "22px" } },
          h(Button, { href: order.orderUrl, style: styles.button }, "View order"),
        )
      : null,
    h(Hr, { style: { borderColor: colors.line, margin: "24px 0" } }),
    h(
      Text,
      { style: styles.muted },
      `Placed ${formatDate(order.createdAt)}. Transaction reference: ${shortId(order.transactionHash || order.orderId)}.`,
    ),
  );
}

function NewOrderAlertEmail({ order }: { order: OrderEmailData }) {
  const preview = order.shippingAddress
    ? `New ${formatUSD(order.totalUSD)} order. Ship to: ${order.shippingAddress}`
    : `New ${formatUSD(order.totalUSD)} order from ${order.customerName || order.customerEmail || "a customer"}. Shipping address missing.`;

  return h(
    EmailShell,
    { brandName: order.coopName, preview },
    h(Text, { style: styles.pill }, `New order #${shortId(order.orderId)}`),
    h(Heading, { style: styles.heading }, "You have a new order"),
    h(
      Text,
      { style: styles.text },
      `${order.customerName || order.customerEmail || "A customer"} placed an order with ${order.storeName}.`,
    ),
    order.shippingAddress
      ? h(
          Section,
          { style: styles.shipToBox },
          h(Text, { style: styles.itemName }, "Ship this order to"),
          h(Text, { style: styles.address }, order.shippingAddress),
        )
      : h(
          Section,
          { style: styles.missingShipToBox },
          h(Text, { style: styles.itemName }, "Shipping address missing"),
          h(
            Text,
            { style: styles.muted },
            "Contact the customer before fulfilling this order.",
          ),
        ),
    h(OrderSummary, { order }),
    h(
      Section,
      null,
      h(Text, { style: styles.itemName }, "Customer"),
      h(Text, { style: styles.muted }, order.customerEmail || "No customer email provided"),
    ),
    order.note
      ? h(
          Section,
          { style: { marginTop: "16px" } },
          h(Text, { style: styles.itemName }, "Order note"),
          h(Text, { style: styles.muted }, order.note),
        )
      : null,
    order.manageOrderUrl
      ? h(
          Section,
          { style: { marginTop: "22px" } },
          h(Button, { href: order.manageOrderUrl, style: styles.button }, "Manage order"),
        )
      : null,
  );
}

function ApplicationAcceptedEmail({
  applicantName,
  coopName,
  portalUrl,
}: {
  applicantName?: string | null;
  coopName?: string | null;
  portalUrl?: string | null;
}) {
  const displayName = coopName || DEFAULT_NETWORK_NAME;
  const preview = `Your ${displayName} application was accepted.`;

  return h(
    EmailShell,
    { brandName: displayName, preview },
    h(Text, { style: styles.pill }, "Application accepted"),
    h(Heading, { style: styles.heading }, "Welcome in"),
    h(
      Text,
      { style: styles.text },
      `Good news${applicantName ? `, ${applicantName}` : ""}: your application to join ${displayName} has been approved.`,
    ),
    h(
      Text,
      { style: styles.text },
      "You can now sign in and access your co-op member portal.",
    ),
    portalUrl
      ? h(
          Section,
          { style: { marginTop: "22px" } },
          h(Button, { href: portalUrl, style: styles.button }, "Open member portal"),
        )
      : null,
    h(Hr, { style: { borderColor: colors.line, margin: "24px 0" } }),
    h(
      Text,
      { style: styles.muted },
      "If you have questions about your membership, reply to this email.",
    ),
  );
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : "Unknown email send error");
}

async function captureEmailSendFailure(
  error: unknown,
  context: Record<string, unknown>,
): Promise<void> {
  const normalizedError = normalizeError(error);
  const tags = { area: "email", service: "resend" };
  const extra = {
    ...context,
    service: "resend",
  };
  const captureContext = { tags, extra };

  try {
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
  } catch (captureError) {
    console.error("Failed to report email send failure to Sentry:", captureError);
  }

  console.error("Email send failure:", normalizedError, extra);
}

async function sendEmail({
  to,
  subject,
  react,
  from,
  replyTo,
  reportToSentry = false,
  sentryContext,
}: {
  to: EmailRecipient;
  subject: string;
  react: React.ReactElement;
  from?: string;
  replyTo?: string;
  reportToSentry?: boolean;
  sentryContext?: Record<string, unknown>;
}) {
  const sender = from || env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  const emailContext = {
    to,
    subject,
    from: sender,
    ...sentryContext,
  };

  try {
    if (!isEmailConfigured()) {
      throw new Error("Resend email is not configured");
    }

    const html = await render(react);
    const resend = new Resend(env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: sender,
      to,
      subject,
      html,
      text: toPlainText(html),
      replyTo: replyTo || sender,
    });

    if (result.error) {
      throw new Error(result.error.message);
    }

    if (!result.data) {
      throw new Error("Resend did not return sent email data");
    }

    return result.data;
  } catch (error) {
    if (reportToSentry) {
      await captureEmailSendFailure(error, emailContext);
    }

    throw error;
  }
}

export async function sendLoginCode(
  email: string,
  code: string,
  coopName?: string | null,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Your ${coopName || DEFAULT_NETWORK_NAME} login code`,
    react: h(LoginCodeEmail, { code, coopName }),
    from: LOGIN_EMAIL_FROM,
    replyTo: LOGIN_EMAIL_FROM,
    reportToSentry: true,
    sentryContext: {
      emailType: "login_code",
      coopName: coopName || DEFAULT_NETWORK_NAME,
    },
  });
}

export async function sendOrderConfirmationEmail({
  to,
  order,
}: {
  to: EmailRecipient;
  order: OrderEmailData;
}): Promise<void> {
  await sendEmail({
    to,
    subject: `Order confirmed at ${order.storeName}`,
    react: h(OrderConfirmationEmail, { order }),
  });
}

export async function sendNewOrderAlertEmail({
  to,
  order,
}: {
  to: EmailRecipient;
  order: OrderEmailData;
}): Promise<void> {
  await sendEmail({
    to,
    subject: `New order from ${order.customerName || order.customerEmail || "a customer"}`,
    react: h(NewOrderAlertEmail, { order }),
  });
}

export async function sendApplicationAcceptedEmail({
  to,
  applicantName,
  coopName,
  portalUrl,
}: {
  to: EmailRecipient;
  applicantName?: string | null;
  coopName?: string | null;
  portalUrl?: string | null;
}): Promise<void> {
  await sendEmail({
    to,
    subject: `Your ${coopName || DEFAULT_NETWORK_NAME} application was accepted`,
    react: h(ApplicationAcceptedEmail, { applicantName, coopName, portalUrl }),
  });
}

export async function sendOrderEmails({
  customerEmail,
  merchantEmail,
  order,
}: {
  customerEmail?: string | null;
  merchantEmail?: string | string[] | null;
  order: OrderEmailData;
}): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn("Order emails skipped because RESEND_API_KEY is not configured.", {
      orderId: order.orderId,
    });
    return;
  }

  const sends: Array<Promise<void>> = [];

  if (customerEmail) {
    sends.push(sendOrderConfirmationEmail({ to: customerEmail, order }));
  }

  const merchantRecipients = [
    ...(Array.isArray(merchantEmail) ? merchantEmail : merchantEmail ? [merchantEmail] : []),
    env.RESEND_FROM_EMAIL,
  ].filter((email, index, all) => all.indexOf(email) === index);

  if (merchantRecipients.length > 0) {
    sends.push(sendNewOrderAlertEmail({ to: merchantRecipients, order }));
  }

  await Promise.all(sends);
}

function slugify(str: string): string {
  return str.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function WaitlistWelcomeEmail({ coopId }: { coopId?: string | null }) {
  const slug = coopId ? slugify(coopId) : null;
  const applicationUrl = slug
    ? `https://cahootzcoops.com/${slug}/application`
    : "https://cahootzcoops.com/application";

  return h(
    EmailShell,
    { preview: "Thanks for signing up for the wait list." },
    h(Heading, { style: styles.heading }, "Hey,"),
    h(
      Text,
      { style: styles.text },
      "Thanks for signing up for the wait list. I was wondering if you wanted to fill out an application.",
    ),
    h(Button, { href: applicationUrl, style: styles.button }, applicationUrl),
    h(
      Text,
      { style: styles.text },
      "Also if you're open to it I wanted to interview a few people to get an idea of what they are looking for from their co-op.",
    ),
  );
}

export async function sendWaitlistWelcomeEmail(
  email: string,
  coopId?: string | null,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Thanks for signing up for the wait list",
    react: h(WaitlistWelcomeEmail, { coopId }),
  });
}

export function generateLoginCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function isEmailConfigured(): boolean {
  return !!env.RESEND_API_KEY;
}
